package org.intabtools.intabpdf.scanner.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.intabtools.intabpdf.scanner.imaging.ImageOrientation
import org.intabtools.intabpdf.scanner.imaging.MemoryBudget
import org.intabtools.intabpdf.scanner.imaging.OpenCvRuntime
import org.intabtools.intabpdf.scanner.vision.DetectionMode
import org.intabtools.intabpdf.scanner.vision.DocumentDetector
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import org.json.JSONArray
import org.json.JSONObject
import org.opencv.android.Utils
import org.opencv.core.Mat
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlin.coroutines.coroutineContext
import kotlin.math.max
import kotlin.math.roundToInt

data class GalleryImportSummary(
    val imported: List<ScannedPageSource>,
    val failedCount: Int,
)

/**
 * Persists full-resolution captured and gallery-imported source pages inside an isolated session
 * cache directory alongside EXIF-normalized dimensions and detected document quadrilaterals,
 * preserving originals untouched for non-destructive cropping, rotation, and filtering.
 */
class StillCaptureStore(
    context: Context,
    private val detector: DocumentDetector,
    val sessionId: String = UUID.randomUUID().toString(),
) {
    private val appContext = context.applicationContext
    private val sessionDir = ScannerPaths.sessionDir(appContext, sessionId)
    private val sourcesDir = ScannerPaths.sessionSourcesDir(sessionDir)
    private val manifestFile = File(sessionDir, "session_sources.json")
    private val mutex = Mutex()
    private val pages = mutableListOf<ScannedPageSource>()

    suspend fun saveFullResolutionCapture(
        rawCapturedJpegFile: File,
        fallbackQuad: NormalizedQuad?,
        autoCaptured: Boolean,
        replacePageId: String? = null,
    ): ScannedPageSource = withContext(Dispatchers.IO) {
        persistOrientedCaptureFile(
            rawFile = rawCapturedJpegFile,
            fallbackQuad = fallbackQuad,
            autoCaptured = autoCaptured,
            replacePageId = replacePageId,
        )
    }

    /**
     * Imports multiple gallery URIs sequentially one-by-one so only one decoded bitmap exists in
     * memory at any instant. Unreadable or invalid URIs are skipped without breaking valid imports.
     */
    suspend fun importFromGalleryUris(uris: List<Uri>): GalleryImportSummary = withContext(Dispatchers.IO) {
        if (uris.isEmpty()) return@withContext GalleryImportSummary(emptyList(), 0)
        val imported = mutableListOf<ScannedPageSource>()
        var failed = 0
        for (uri in uris) {
            coroutineContext.ensureActive()
            val rawTemp = newTempRawCaptureFile()
            val copied = copyUriToTempFile(uri, rawTemp)
            if (!copied || !isValidImageHeader(rawTemp)) {
                rawTemp.delete()
                failed++
                continue
            }
            val result = runCatching {
                persistOrientedCaptureFile(
                    rawFile = rawTemp,
                    fallbackQuad = null,
                    autoCaptured = false,
                    replacePageId = null,
                )
            }
            result.onSuccess { imported += it }.onFailure { failed++ }
        }
        GalleryImportSummary(imported = imported, failedCount = failed)
    }

    suspend fun deletePage(pageId: String): Boolean = mutex.withLock {
        val idx = pages.indexOfFirst { it.pageId == pageId }
        if (idx < 0) return@withLock false
        val removed = pages.removeAt(idx)
        runCatching { File(removed.sourceFilePath).delete() }
        writeManifestLocked()
        true
    }

    suspend fun reorderPages(orderedPageIds: List<String>): List<ScannedPageSource> = mutex.withLock {
        val byId = pages.associateBy { it.pageId }
        val reordered = orderedPageIds.mapNotNull { byId[it] }.toMutableList()
        for (existing in pages) {
            if (reordered.none { it.pageId == existing.pageId }) {
                reordered += existing
            }
        }
        pages.clear()
        pages.addAll(reordered)
        writeManifestLocked()
        pages.toList()
    }

    suspend fun currentPages(): List<ScannedPageSource> = mutex.withLock {
        pages.toList()
    }

    suspend fun restoreFromDisk(): List<ScannedPageSource> = withContext(Dispatchers.IO) {
        mutex.withLock {
            if (!manifestFile.exists() || !manifestFile.isFile) return@withLock emptyList()
            val restored = runCatching {
                val root = JSONObject(manifestFile.readText())
                val arr = root.optJSONArray("pages") ?: JSONArray()
                buildList {
                    for (i in 0 until arr.length()) {
                        val obj = arr.optJSONObject(i) ?: continue
                        val pageId = obj.optString("pageId", "")
                        val path = obj.optString("sourceFilePath", "")
                        if (pageId.isBlank() || path.isBlank() || !File(path).exists()) continue
                        val eff = jsonToQuad(obj.optJSONArray("effectiveQuad")) ?: NormalizedQuad.defaultInset()
                        val det = jsonToQuad(obj.optJSONArray("detectedQuad"))
                        add(
                            ScannedPageSource(
                                pageId = pageId,
                                sourceFilePath = path,
                                widthPx = obj.optInt("widthPx", 1).coerceAtLeast(1),
                                heightPx = obj.optInt("heightPx", 1).coerceAtLeast(1),
                                detectedQuad = det,
                                effectiveQuad = eff,
                                detectionConfidence = obj.optDouble("detectionConfidence", 0.0).toFloat(),
                                detectionRecovered = obj.optBoolean("detectionRecovered", det == null),
                                autoCaptured = obj.optBoolean("autoCaptured", false),
                                capturedAtMs = obj.optLong("capturedAtMs", 0L),
                            )
                        )
                    }
                }
            }.getOrDefault(emptyList())
            pages.clear()
            pages.addAll(restored)
            pages.toList()
        }
    }

    fun newTempRawCaptureFile(): File {
        sessionDir.mkdirs()
        return File(sessionDir, "raw_${UUID.randomUUID()}.jpg")
    }

    private suspend fun persistOrientedCaptureFile(
        rawFile: File,
        fallbackQuad: NormalizedQuad?,
        autoCaptured: Boolean,
        replacePageId: String?,
    ): ScannedPageSource {
        try {
            sourcesDir.mkdirs()
            val pageId = UUID.randomUUID().toString()
            val targetSourceFile = ScannerPaths.sourceImageFile(sessionDir, pageId)

            val exifOrientation = readExifOrientation(rawFile)
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(rawFile.absolutePath, bounds)

            val rawWidth = bounds.outWidth.coerceAtLeast(1)
            val rawHeight = bounds.outHeight.coerceAtLeast(1)
            val isPlainJpeg = isJpegFile(bounds.outMimeType)

            val finalDims = if (
                isPlainJpeg &&
                (exifOrientation == ExifInterface.ORIENTATION_NORMAL || exifOrientation == ExifInterface.ORIENTATION_UNDEFINED)
            ) {
                rawFile.copyTo(targetSourceFile, overwrite = true)
                rawWidth to rawHeight
            } else {
                writeUprightFullResJpeg(rawFile, targetSourceFile, exifOrientation, rawWidth, rawHeight)
            }

            // Detect quad at full-still sensitivity on a memory-safe subsampled bitmap
            val detection = detectOnSourceFile(targetSourceFile)
            val resolvedQuad = detection.first ?: fallbackQuad
            val finalQuad = resolvedQuad ?: NormalizedQuad.defaultInset()
            val recovered = resolvedQuad == null

            val entry = ScannedPageSource(
                pageId = pageId,
                sourceFilePath = targetSourceFile.absolutePath,
                widthPx = finalDims.first,
                heightPx = finalDims.second,
                detectedQuad = resolvedQuad,
                effectiveQuad = finalQuad,
                detectionConfidence = detection.second,
                detectionRecovered = recovered,
                autoCaptured = autoCaptured,
                capturedAtMs = System.currentTimeMillis(),
            )

            mutex.withLock {
                if (replacePageId != null) {
                    val replaceIdx = pages.indexOfFirst { it.pageId == replacePageId }
                    if (replaceIdx >= 0) {
                        val old = pages[replaceIdx]
                        pages[replaceIdx] = entry
                        runCatching { File(old.sourceFilePath).delete() }
                    } else {
                        pages += entry
                    }
                } else {
                    pages += entry
                }
                writeManifestLocked()
            }
            return entry
        } finally {
            rawFile.delete()
        }
    }

    private fun copyUriToTempFile(uri: Uri, destFile: File): Boolean {
        return try {
            appContext.contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(destFile).use { output ->
                    input.copyTo(output)
                }
                destFile.length() > 0L
            } ?: false
        } catch (_: Exception) {
            false
        }
    }

    private fun isValidImageHeader(file: File): Boolean {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        return bounds.outWidth > 0 && bounds.outHeight > 0
    }

    private fun isJpegFile(mimeType: String?): Boolean =
        mimeType.equals("image/jpeg", ignoreCase = true) || mimeType.equals("image/jpg", ignoreCase = true)

    private fun readExifOrientation(file: File): Int {
        val exif = runCatching { ExifInterface(file.absolutePath) }.getOrNull() ?: return ExifInterface.ORIENTATION_NORMAL
        return exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    }

    private fun writeUprightFullResJpeg(
        sourceFile: File,
        targetFile: File,
        exifOrientation: Int,
        rawWidth: Int,
        rawHeight: Int,
    ): Pair<Int, Int> {
        val sampleSize = MemoryBudget.calculateInSampleSize(rawWidth, rawHeight, maxDecodePixels = 16_000_000L)
        val opts = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        val decoded = BitmapFactory.decodeFile(sourceFile.absolutePath, opts)
            ?: error("Could not decode image for orientation normalization.")
        var oriented: Bitmap? = null
        try {
            oriented = ImageOrientation.applyExifOrientation(decoded, exifOrientation)
            FileOutputStream(targetFile).use { out ->
                oriented.compress(Bitmap.CompressFormat.JPEG, 95, out)
            }
            return oriented.width to oriented.height
        } finally {
            if (oriented != null && oriented !== decoded) {
                oriented.recycle()
            }
            decoded.recycle()
        }
    }

    private fun detectOnSourceFile(sourceFile: File): Pair<NormalizedQuad?, Float> {
        if (!OpenCvRuntime.ensureInitialized()) {
            return null to 0f
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(sourceFile.absolutePath, bounds)
        val maxDim = max(bounds.outWidth, bounds.outHeight)
        var sampleSize = 1
        while (maxDim / sampleSize > 1280) {
            sampleSize *= 2
        }
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val bitmap = BitmapFactory.decodeFile(sourceFile.absolutePath, opts) ?: return null to 0f
        val mat = Mat()
        try {
            Utils.bitmapToMat(bitmap, mat)
            val result = detector.detect(mat, DetectionMode.STILL_CAPTURE)
            return result.normalizedQuad to result.confidence
        } finally {
            mat.release()
            bitmap.recycle()
        }
    }

    private fun writeManifestLocked() {
        sessionDir.mkdirs()
        val array = JSONArray()
        for (page in pages) {
            val obj = JSONObject().apply {
                put("pageId", page.pageId)
                put("sourceFilePath", page.sourceFilePath)
                put("widthPx", page.widthPx)
                put("heightPx", page.heightPx)
                put("detectionConfidence", page.detectionConfidence.toDouble())
                put("detectionRecovered", page.detectionRecovered)
                put("autoCaptured", page.autoCaptured)
                put("capturedAtMs", page.capturedAtMs)
                put("effectiveQuad", quadToJson(page.effectiveQuad))
                page.detectedQuad?.let { put("detectedQuad", quadToJson(it)) }
            }
            array.put(obj)
        }
        val root = JSONObject().apply {
            put("sessionId", sessionId)
            put("pages", array)
        }
        manifestFile.writeText(root.toString())
    }

    private fun quadToJson(quad: NormalizedQuad): JSONArray = JSONArray().apply {
        for (p in quad.points()) {
            put(JSONObject().put("x", (p.x * 10000f).roundToInt() / 10000.0).put("y", (p.y * 10000f).roundToInt() / 10000.0))
        }
    }

    private fun jsonToQuad(array: JSONArray?): NormalizedQuad? {
        if (array == null || array.length() != 4) return null
        val pts = (0 until 4).mapNotNull { idx ->
            val obj = array.optJSONObject(idx) ?: return@mapNotNull null
            org.intabtools.intabpdf.scanner.vision.NormalizedPoint(
                x = obj.optDouble("x", Double.NaN).toFloat(),
                y = obj.optDouble("y", Double.NaN).toFloat(),
            )
        }
        if (pts.size != 4 || pts.any { !it.x.isFinite() || !it.y.isFinite() }) return null
        return NormalizedQuad(pts[0], pts[1], pts[2], pts[3])
    }
}
