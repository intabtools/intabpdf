package org.intabtools.intabpdf.scanner.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.intabtools.intabpdf.scanner.imaging.DeviceMemoryProfile
import org.intabtools.intabpdf.scanner.imaging.ImageOrientation
import org.intabtools.intabpdf.scanner.imaging.MemoryBudget
import org.intabtools.intabpdf.scanner.imaging.OpenCvRuntime
import org.intabtools.intabpdf.scanner.imaging.PageFilterEngine
import org.intabtools.intabpdf.scanner.imaging.PerspectiveTransform
import org.intabtools.intabpdf.scanner.vision.NormalizedPoint
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import org.json.JSONArray
import org.json.JSONObject
import org.opencv.android.Utils
import org.opencv.core.Mat
import org.opencv.imgcodecs.Imgcodecs
import org.opencv.imgproc.Imgproc
import java.io.File
import java.io.FileOutputStream
import kotlin.coroutines.coroutineContext
import kotlin.math.roundToInt

data class ReversiblePageRecord(
    val pageId: String,
    val sourceFilePath: String,
    val sourceWidthPx: Int,
    val sourceHeightPx: Int,
    val detectedQuad: NormalizedQuad?,
    val userQuad: NormalizedQuad?,
    val quadVersion: Int = 1,
    val rotationDegrees: Int = 0,
    val selectedFilter: ScanFilter = ScanFilter.AUTO,
) {
    val activeQuad: NormalizedQuad
        get() = userQuad ?: detectedQuad ?: NormalizedQuad.defaultInset()
}

data class RenderedPageResult(
    val pageId: String,
    val outputFile: File,
    val effectiveFilter: ScanFilter,
    val isBitonal: Boolean,
    val widthPx: Int,
    val heightPx: Int,
)

/**
 * Coordinates ordered multi-page state and reversible perspective correction, page rotation,
 * and filter rendering off the UI thread while keeping every source capture immutable.
 */
class NonDestructivePagePipeline(
    context: Context,
    private val sessionId: String,
    private val memoryProfile: DeviceMemoryProfile = DeviceMemoryProfile.forContext(context),
) {
    private val appContext = context.applicationContext
    private val sessionDir = ScannerPaths.sessionDir(appContext, sessionId)
    private val renderedDir = File(sessionDir, "rendered")
    private val thumbsDir = File(sessionDir, "thumbnails")
    private val editsManifestFile = File(sessionDir, "session_edits.json")
    private val mutex = Mutex()
    private val pageOrder = mutableListOf<String>()
    private val records = LinkedHashMap<String, ReversiblePageRecord>()

    suspend fun restoreFromSources(sources: List<ScannedPageSource>, defaultFilter: ScanFilter = ScanFilter.AUTO): List<ReversiblePageRecord> =
        mutex.withLock {
            val savedById = mutableMapOf<String, SavedPageEdit>()
            val savedOrder = mutableListOf<String>()
            if (editsManifestFile.exists() && editsManifestFile.isFile) {
                runCatching {
                    val root = JSONObject(editsManifestFile.readText())
                    val orderArr = root.optJSONArray("order") ?: JSONArray()
                    for (i in 0 until orderArr.length()) {
                        savedOrder += orderArr.optString(i)
                    }
                    val editsObj = root.optJSONObject("edits") ?: JSONObject()
                    val keys = editsObj.keys()
                    while (keys.hasNext()) {
                        val key = keys.next()
                        val item = editsObj.optJSONObject(key) ?: continue
                        savedById[key] = SavedPageEdit(
                            userQuad = jsonToQuad(item.optJSONArray("userQuad")),
                            quadVersion = item.optInt("quadVersion", 1).coerceAtLeast(1),
                            rotationDegrees = ImageOrientation.normalizeRotationDegrees(item.optInt("rotationDegrees", 0)),
                            selectedFilter = ScanFilter.fromWireValue(item.optString("selectedFilter", defaultFilter.wireValue)),
                        )
                    }
                }
            }

            records.clear()
            pageOrder.clear()
            val sourcesById = sources.associateBy { it.pageId }
            val orderedSources = buildList {
                for (id in savedOrder) {
                    sourcesById[id]?.let { add(it) }
                }
                for (src in sources) {
                    if (none { it.pageId == src.pageId }) add(src)
                }
            }
            for (src in orderedSources) {
                val edit = savedById[src.pageId]
                val rec = ReversiblePageRecord(
                    pageId = src.pageId,
                    sourceFilePath = src.sourceFilePath,
                    sourceWidthPx = src.widthPx,
                    sourceHeightPx = src.heightPx,
                    detectedQuad = src.detectedQuad,
                    userQuad = edit?.userQuad ?: if (src.detectedQuad != null) null else src.effectiveQuad,
                    quadVersion = edit?.quadVersion ?: 1,
                    rotationDegrees = edit?.rotationDegrees ?: 0,
                    selectedFilter = edit?.selectedFilter ?: defaultFilter,
                )
                pageOrder += rec.pageId
                records[rec.pageId] = rec
            }
            pageOrder.mapNotNull { records[it] }
        }

    suspend fun registerCapturedPage(
        source: ScannedPageSource,
        defaultFilter: ScanFilter = ScanFilter.AUTO,
        replacePageId: String? = null,
    ): ReversiblePageRecord = mutex.withLock {
        val existingReplaced = replacePageId?.let { records[it] }
        val record = ReversiblePageRecord(
            pageId = source.pageId,
            sourceFilePath = source.sourceFilePath,
            sourceWidthPx = source.widthPx,
            sourceHeightPx = source.heightPx,
            detectedQuad = source.detectedQuad,
            userQuad = if (source.detectedQuad != null) null else source.effectiveQuad,
            quadVersion = 1,
            rotationDegrees = existingReplaced?.rotationDegrees ?: 0,
            selectedFilter = existingReplaced?.selectedFilter ?: defaultFilter,
        )

        if (replacePageId != null) {
            val replaceIdx = pageOrder.indexOf(replacePageId)
            records.remove(replacePageId)
            deleteStaleVariants(replacePageId)
            if (replaceIdx >= 0) {
                pageOrder[replaceIdx] = record.pageId
            } else {
                pageOrder += record.pageId
            }
        } else if (!records.containsKey(record.pageId)) {
            pageOrder += record.pageId
        }

        records[record.pageId] = record
        saveEditsManifestLocked()
        record
    }

    suspend fun orderedRecords(): List<ReversiblePageRecord> = mutex.withLock {
        pageOrder.mapNotNull { records[it] }
    }

    suspend fun getRecord(pageId: String): ReversiblePageRecord? = mutex.withLock {
        records[pageId]
    }

    suspend fun deletePage(pageId: String): Boolean = mutex.withLock {
        val removed = records.remove(pageId) ?: return@withLock false
        pageOrder.remove(pageId)
        deleteStaleVariants(pageId)
        runCatching { File(removed.sourceFilePath).delete() }
        saveEditsManifestLocked()
        true
    }

    suspend fun movePage(fromIndex: Int, toIndex: Int): List<ReversiblePageRecord> = mutex.withLock {
        if (fromIndex !in pageOrder.indices || toIndex !in pageOrder.indices || fromIndex == toIndex) {
            return@withLock pageOrder.mapNotNull { records[it] }
        }
        val moved = pageOrder.removeAt(fromIndex)
        pageOrder.add(toIndex, moved)
        saveEditsManifestLocked()
        pageOrder.mapNotNull { records[it] }
    }

    suspend fun reorderPages(orderedPageIds: List<String>): List<ReversiblePageRecord> = mutex.withLock {
        val next = orderedPageIds.filter { records.containsKey(it) }.toMutableList()
        for (id in pageOrder) {
            if (!next.contains(id)) next += id
        }
        pageOrder.clear()
        pageOrder.addAll(next)
        saveEditsManifestLocked()
        pageOrder.mapNotNull { records[it] }
    }

    suspend fun updateCropQuad(pageId: String, newQuad: NormalizedQuad): ReversiblePageRecord = mutex.withLock {
        val current = records[pageId] ?: error("Unknown pageId: $pageId")
        val updated = current.copy(
            userQuad = newQuad,
            quadVersion = current.quadVersion + 1,
        )
        records[pageId] = updated
        deleteStaleVariants(pageId)
        saveEditsManifestLocked()
        updated
    }

    suspend fun resetCropToAuto(pageId: String): ReversiblePageRecord = mutex.withLock {
        val current = records[pageId] ?: error("Unknown pageId: $pageId")
        val autoQuad = current.detectedQuad ?: NormalizedQuad.defaultInset()
        val updated = current.copy(
            userQuad = if (current.detectedQuad != null) null else autoQuad,
            quadVersion = current.quadVersion + 1,
        )
        records[pageId] = updated
        deleteStaleVariants(pageId)
        saveEditsManifestLocked()
        updated
    }

    suspend fun setCropFitAll(pageId: String): ReversiblePageRecord =
        updateCropQuad(pageId, NormalizedQuad.fullFrame())

    suspend fun rotatePage(pageId: String, deltaDegrees: Int): ReversiblePageRecord = mutex.withLock {
        val current = records[pageId] ?: error("Unknown pageId: $pageId")
        val nextRot = ImageOrientation.normalizeRotationDegrees(current.rotationDegrees + deltaDegrees)
        val updated = current.copy(rotationDegrees = nextRot)
        records[pageId] = updated
        deleteStaleVariants(pageId)
        saveEditsManifestLocked()
        updated
    }

    suspend fun setFilter(pageId: String, filter: ScanFilter): ReversiblePageRecord = mutex.withLock {
        val current = records[pageId] ?: error("Unknown pageId: $pageId")
        val updated = current.copy(selectedFilter = filter)
        records[pageId] = updated
        saveEditsManifestLocked()
        updated
    }

    /**
     * Applies [filter] across all ordered pages without overwriting each page's crop quad,
     * rotation, or immutable source capture.
     */
    suspend fun applyFilterToAll(filter: ScanFilter): List<ReversiblePageRecord> = mutex.withLock {
        for (id in pageOrder) {
            val current = records[id] ?: continue
            records[id] = current.copy(selectedFilter = filter)
        }
        saveEditsManifestLocked()
        pageOrder.mapNotNull { records[it] }
    }

    /**
     * Returns an existing cached render for [record] and [quality] if present on disk, avoiding
     * redundant re-processing when flipping between already-rendered pages or filters.
     */
    fun findCachedRender(record: ReversiblePageRecord, quality: ScanQuality): RenderedPageResult? {
        val candidates = if (record.selectedFilter == ScanFilter.AUTO) {
            listOf(ScanFilter.COLOR, ScanFilter.GRAYSCALE)
        } else {
            listOf(record.selectedFilter)
        }
        for (effective in candidates) {
            val isBitonal = effective == ScanFilter.BLACK_AND_WHITE
            val file = renderOutputFile(record, effective, quality, isBitonal)
            if (file.exists() && file.isFile && file.length() > 0L) {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(file.absolutePath, bounds)
                if (bounds.outWidth > 0 && bounds.outHeight > 0) {
                    return RenderedPageResult(
                        pageId = record.pageId,
                        outputFile = file,
                        effectiveFilter = effective,
                        isBitonal = isBitonal,
                        widthPx = bounds.outWidth,
                        heightPx = bounds.outHeight,
                    )
                }
            }
        }
        return null
    }

    /**
     * Renders the active perspective-corrected, filtered, rotated variant of [pageId] on a
     * background dispatcher without modifying `sources/<pageId>.jpg`.
     */
    suspend fun renderPage(
        pageId: String,
        quality: ScanQuality,
    ): RenderedPageResult = withContext(Dispatchers.Default) {
        coroutineContext.ensureActive()
        val record = getRecord(pageId) ?: error("Unknown pageId: $pageId")
        findCachedRender(record, quality)?.let { return@withContext it }

        check(OpenCvRuntime.ensureInitialized()) { "OpenCV native runtime unavailable." }
        val sourceFile = File(record.sourceFilePath)
        check(sourceFile.exists() && sourceFile.isFile) { "Source capture missing for $pageId" }

        renderedDir.mkdirs()

        val sourceMat = decodeSubsampledBgrMat(sourceFile, memoryProfile.maxDecodePixels(quality))
        val targetMaxPixels = memoryProfile.maxRenderedPixels(quality, record.selectedFilter)
        val dims = PerspectiveTransform.estimateWarpedDimensions(
            quad = record.activeQuad,
            sourceWidth = sourceMat.cols(),
            sourceHeight = sourceMat.rows(),
            maxOutputPixels = targetMaxPixels,
        )

        var warped: Mat? = null
        var filteredMat: Mat? = null
        var rotatedMat: Mat? = null
        try {
            coroutineContext.ensureActive()
            warped = PerspectiveTransform.warpDocument(sourceMat, record.activeQuad, dims)
            coroutineContext.ensureActive()
            val filtered = PageFilterEngine.applyFilter(
                warpedBgr = warped,
                requestedFilter = record.selectedFilter,
                isLowRamDevice = memoryProfile.isConstrained,
                targetBwMaxPixels = memoryProfile.maxRenderedPixels(quality, ScanFilter.BLACK_AND_WHITE),
            )
            filteredMat = filtered.mat
            coroutineContext.ensureActive()
            rotatedMat = ImageOrientation.rotateMatInPlaceOrClone(filteredMat, record.rotationDegrees)

            val outFile = renderOutputFile(record, filtered.effectiveFilter, quality, filtered.isBitonal)
            coroutineContext.ensureActive()
            writeProcessedMatAtomically(rotatedMat, outFile, filtered.isBitonal, jpegQuality = jpegQualityFor(quality))

            RenderedPageResult(
                pageId = record.pageId,
                outputFile = outFile,
                effectiveFilter = filtered.effectiveFilter,
                isBitonal = filtered.isBitonal,
                widthPx = rotatedMat.cols(),
                heightPx = rotatedMat.rows(),
            )
        } finally {
            sourceMat.release()
            warped?.release()
            filteredMat?.release()
            rotatedMat?.release()
        }
    }

    /**
     * Generates compact thumbnail previews for all 5 filter modes on a background thread,
     * returning immediately if the versioned thumbnail cache for `(quadVersion, rotationDegrees)`
     * already exists on disk.
     */
    suspend fun generateFilterThumbnails(
        pageId: String,
        maxThumbPixels: Long = 32_000L,
    ): Map<ScanFilter, File> = withContext(Dispatchers.Default) {
        coroutineContext.ensureActive()
        val record = getRecord(pageId) ?: error("Unknown pageId: $pageId")
        findCachedFilterThumbnails(record)?.let { return@withContext it }

        check(OpenCvRuntime.ensureInitialized()) { "OpenCV native runtime unavailable." }
        val sourceFile = File(record.sourceFilePath)
        check(sourceFile.exists() && sourceFile.isFile) { "Source capture missing for $pageId" }

        thumbsDir.mkdirs()
        val sourceMat = decodeSubsampledBgrMat(sourceFile, maxDecodePixels = 1_200_000L)
        val thumbDims = PerspectiveTransform.estimateWarpedDimensions(
            quad = record.activeQuad,
            sourceWidth = sourceMat.cols(),
            sourceHeight = sourceMat.rows(),
            maxOutputPixels = maxThumbPixels,
        )

        var warped: Mat? = null
        val results = LinkedHashMap<ScanFilter, File>()
        try {
            coroutineContext.ensureActive()
            warped = PerspectiveTransform.warpDocument(sourceMat, record.activeQuad, thumbDims)
            for (mode in ScanFilter.entries) {
                coroutineContext.ensureActive()
                val outFile = thumbnailOutputFile(record, mode)
                if (outFile.exists() && outFile.length() > 0L) {
                    results[mode] = outFile
                    continue
                }
                val filtered = PageFilterEngine.applyFilter(
                    warpedBgr = warped,
                    requestedFilter = mode,
                    isLowRamDevice = memoryProfile.isConstrained,
                    targetBwMaxPixels = maxThumbPixels * 2L,
                )
                val rotated = ImageOrientation.rotateMatInPlaceOrClone(filtered.mat, record.rotationDegrees)
                try {
                    coroutineContext.ensureActive()
                    writeProcessedMatAtomically(rotated, outFile, isBitonal = false, jpegQuality = 80)
                    results[mode] = outFile
                } finally {
                    filtered.mat.release()
                    rotated.release()
                }
            }
            results
        } finally {
            sourceMat.release()
            warped?.release()
        }
    }

    fun findCachedFilterThumbnails(record: ReversiblePageRecord): Map<ScanFilter, File>? {
        val cached = LinkedHashMap<ScanFilter, File>(ScanFilter.entries.size)
        for (mode in ScanFilter.entries) {
            val file = thumbnailOutputFile(record, mode)
            if (!file.exists() || !file.isFile || file.length() <= 0L) {
                return null
            }
            cached[mode] = file
        }
        return cached
    }

    private fun renderOutputFile(
        record: ReversiblePageRecord,
        effectiveFilter: ScanFilter,
        quality: ScanQuality,
        isBitonal: Boolean,
    ): File {
        val ext = if (isBitonal) "png" else "jpg"
        return File(
            renderedDir,
            "${record.pageId}_${effectiveFilter.wireValue}_${quality.wireValue}_v${record.quadVersion}_r${record.rotationDegrees}.$ext",
        )
    }

    private fun thumbnailOutputFile(record: ReversiblePageRecord, mode: ScanFilter): File =
        File(
            thumbsDir,
            "${record.pageId}_thumb_${mode.wireValue}_v${record.quadVersion}_r${record.rotationDegrees}.jpg",
        )

    private fun decodeSubsampledBgrMat(file: File, maxDecodePixels: Long): Mat {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        val sampleSize = MemoryBudget.calculateInSampleSize(bounds.outWidth, bounds.outHeight, maxDecodePixels)
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val bitmap = BitmapFactory.decodeFile(file.absolutePath, opts)
            ?: error("Unable to decode image file: ${file.name}")
        val rgba = Mat()
        val bgr = Mat()
        try {
            Utils.bitmapToMat(bitmap, rgba)
            Imgproc.cvtColor(rgba, bgr, Imgproc.COLOR_RGBA2BGR)
            return bgr
        } finally {
            rgba.release()
            bitmap.recycle()
        }
    }

    private fun writeProcessedMatAtomically(
        mat: Mat,
        outputFile: File,
        isBitonal: Boolean,
        jpegQuality: Int,
    ) {
        val tempFile = File(outputFile.parentFile, ".tmp_${outputFile.name}_${System.nanoTime()}.${if (isBitonal) "png" else "jpg"}")
        try {
            if (isBitonal) {
                Imgcodecs.imwrite(tempFile.absolutePath, mat)
            } else {
                val rgba = Mat()
                try {
                    if (mat.channels() == 1) {
                        Imgproc.cvtColor(mat, rgba, Imgproc.COLOR_GRAY2RGBA)
                    } else {
                        Imgproc.cvtColor(mat, rgba, Imgproc.COLOR_BGR2RGBA)
                    }
                    val bitmap = Bitmap.createBitmap(rgba.cols(), rgba.rows(), Bitmap.Config.ARGB_8888)
                    try {
                        Utils.matToBitmap(rgba, bitmap)
                        FileOutputStream(tempFile).use { out ->
                            bitmap.compress(Bitmap.CompressFormat.JPEG, jpegQuality, out)
                        }
                    } finally {
                        bitmap.recycle()
                    }
                } finally {
                    rgba.release()
                }
            }
            if (tempFile.exists() && tempFile.length() > 0L) {
                if (outputFile.exists()) outputFile.delete()
                if (!tempFile.renameTo(outputFile)) {
                    tempFile.copyTo(outputFile, overwrite = true)
                    tempFile.delete()
                }
            }
        } finally {
            if (tempFile.exists()) tempFile.delete()
        }
    }

    private fun jpegQualityFor(quality: ScanQuality): Int = when (quality) {
        ScanQuality.LOW -> 65
        ScanQuality.BALANCED -> 78
        ScanQuality.HIGH -> 86
    }

    private fun deleteStaleVariants(pageId: String) {
        renderedDir.listFiles { f -> f.name.startsWith("${pageId}_") || f.name.startsWith(".tmp_${pageId}_") }?.forEach { it.delete() }
        thumbsDir.listFiles { f -> f.name.startsWith("${pageId}_") || f.name.startsWith(".tmp_${pageId}_") }?.forEach { it.delete() }
    }

    private fun saveEditsManifestLocked() {
        runCatching {
            sessionDir.mkdirs()
            val orderArr = JSONArray()
            pageOrder.forEach { orderArr.put(it) }
            val editsObj = JSONObject()
            for ((id, rec) in records) {
                val obj = JSONObject().apply {
                    put("quadVersion", rec.quadVersion)
                    put("rotationDegrees", rec.rotationDegrees)
                    put("selectedFilter", rec.selectedFilter.wireValue)
                    rec.userQuad?.let { put("userQuad", quadToJson(it)) }
                }
                editsObj.put(id, obj)
            }
            val root = JSONObject().apply {
                put("order", orderArr)
                put("edits", editsObj)
            }
            editsManifestFile.writeText(root.toString())
        }
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
            NormalizedPoint(
                x = obj.optDouble("x", Double.NaN).toFloat(),
                y = obj.optDouble("y", Double.NaN).toFloat(),
            )
        }
        if (pts.size != 4 || pts.any { !it.x.isFinite() || !it.y.isFinite() }) return null
        return NormalizedQuad(pts[0], pts[1], pts[2], pts[3])
    }

    private data class SavedPageEdit(
        val userQuad: NormalizedQuad?,
        val quadVersion: Int,
        val rotationDegrees: Int,
        val selectedFilter: ScanFilter,
    )
}
