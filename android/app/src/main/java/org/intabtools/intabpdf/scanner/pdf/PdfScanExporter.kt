package org.intabtools.intabpdf.scanner.pdf

import android.content.Context
import android.graphics.BitmapFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.intabtools.intabpdf.scanner.data.NonDestructivePagePipeline
import org.intabtools.intabpdf.scanner.data.ReversiblePageRecord
import org.intabtools.intabpdf.scanner.data.ScanQuality
import org.intabtools.intabpdf.scanner.data.ScannerPaths
import org.opencv.imgcodecs.Imgcodecs
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.FilterOutputStream
import java.io.IOException
import java.io.OutputStream
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.zip.Deflater
import java.util.zip.DeflaterOutputStream
import kotlin.coroutines.coroutineContext
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

class InsufficientStorageException(message: String) : IOException(message)

data class PdfExportResult(
    val outputFile: File,
    val fileName: String,
    val pageCount: Int,
    val sizeBytes: Long,
)

/**
 * Clean-room streaming PDF 1.4 exporter turning ordered edited scanner pages into a multi-page
 * PDF while keeping peak memory bounded to one page at a time and cleaning up temporary files on
 * cancellation or failure.
 */
class PdfScanExporter(
    context: Context,
    private val minRequiredBytes: Long = DEFAULT_MIN_REQUIRED_BYTES,
) {
    private val appContext = context.applicationContext

    suspend fun exportSessionToPdf(
        pages: List<ReversiblePageRecord>,
        pipeline: NonDestructivePagePipeline,
        quality: ScanQuality,
        suggestedFileName: String? = null,
        availableSpaceOverrideBytes: Long? = null,
        onProgress: ((completedPages: Int, totalPages: Int) -> Unit)? = null,
    ): PdfExportResult = withContext(Dispatchers.IO) {
        require(pages.isNotEmpty()) { "Cannot export a PDF from an empty scan session." }

        val outputDir = ScannerPaths.outputDir(appContext)
        if (!outputDir.exists() && !outputDir.mkdirs()) {
            throw IOException("Could not create scanner output directory.")
        }

        val requiredFree = max(minRequiredBytes, pages.size.toLong() * PER_PAGE_RESERVE_BYTES)
        val availableBytes = availableSpaceOverrideBytes ?: outputDir.usableSpace
        if (availableBytes < requiredFree) {
            throw InsufficientStorageException(
                "Not enough device storage to create PDF (${availableBytes / 1024} KB free)."
            )
        }

        val finalName = sanitizePdfFileName(suggestedFileName)
        val finalFile = uniqueOutputFile(outputDir, finalName)
        val tempFile = File(outputDir, ".tmp_${UUID.randomUUID()}.pdf")

        try {
            streamPdfAtomically(
                tempFile = tempFile,
                pages = pages,
                pipeline = pipeline,
                quality = quality,
                onProgress = onProgress,
            )

            coroutineContext.ensureActive()
            if (!tempFile.exists() || tempFile.length() < 32L) {
                throw IOException("Generated PDF was empty.")
            }

            if (finalFile.exists()) finalFile.delete()
            if (!tempFile.renameTo(finalFile)) {
                tempFile.copyTo(finalFile, overwrite = true)
                tempFile.delete()
            }

            if (!finalFile.exists() || finalFile.length() <= 0L) {
                throw IOException("Failed to finalize PDF output file.")
            }

            PdfExportResult(
                outputFile = finalFile,
                fileName = finalName,
                pageCount = pages.size,
                sizeBytes = finalFile.length(),
            )
        } catch (t: Throwable) {
            runCatching { tempFile.delete() }
            runCatching { finalFile.delete() }
            throw t
        } finally {
            if (tempFile.exists()) {
                runCatching { tempFile.delete() }
            }
        }
    }

    private suspend fun streamPdfAtomically(
        tempFile: File,
        pages: List<ReversiblePageRecord>,
        pipeline: NonDestructivePagePipeline,
        quality: ScanQuality,
        onProgress: ((completedPages: Int, totalPages: Int) -> Unit)?,
    ) {
        CountingOutputStream(BufferedOutputStream(FileOutputStream(tempFile), 32 * 1024)).use { out ->
            out.writeAscii("%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n")

            // Object IDs: 1 = Catalog, 2 = Pages tree, 3+ = per-page (Page, Content, ImageXObject)
            val offsets = LinkedHashMap<Int, Long>()
            offsets[1] = out.bytesWritten
            out.writeAscii("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

            var nextObjId = 3
            val pageObjIds = ArrayList<Int>(pages.size)

            for ((index, record) in pages.withIndex()) {
                coroutineContext.ensureActive()
                val rendered = pipeline.renderPage(record.pageId, quality)
                coroutineContext.ensureActive()

                val imageFile = rendered.outputFile
                if (!imageFile.exists() || !imageFile.isFile || imageFile.length() <= 0L) {
                    throw IOException("Rendered page image missing for page ${index + 1}.")
                }

                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(imageFile.absolutePath, bounds)
                val imgW = max(bounds.outWidth, rendered.widthPx).coerceAtLeast(1)
                val imgH = max(bounds.outHeight, rendered.heightPx).coerceAtLeast(1)
                val (pageW, pageH) = computePdfPageSizePoints(imgW, imgH)

                val pageId = nextObjId++
                val contentId = nextObjId++
                val imageId = nextObjId++
                pageObjIds += pageId

                // Image XObject
                offsets[imageId] = out.bytesWritten
                if (rendered.isBitonal) {
                    writeBitonalImageObject(out, imageId, imageFile)
                } else {
                    writeJpegImageObject(out, imageId, imageFile, imgW, imgH)
                }

                // Content Stream drawing the image edge-to-edge across the MediaBox
                val contentStream = String.format(
                    Locale.US,
                    "q\n%.2f 0 0 %.2f 0 0 cm\n/Im%d Do\nQ\n",
                    pageW,
                    pageH,
                    index + 1,
                ).toByteArray(StandardCharsets.US_ASCII)

                offsets[contentId] = out.bytesWritten
                out.writeAscii("$contentId 0 obj\n<< /Length ${contentStream.size} >>\nstream\n")
                out.write(contentStream)
                out.writeAscii("\nendstream\nendobj\n")

                // Page Dictionary
                offsets[pageId] = out.bytesWritten
                val pageWStr = String.format(Locale.US, "%.2f", pageW)
                val pageHStr = String.format(Locale.US, "%.2f", pageH)
                out.writeAscii(
                    "$pageId 0 obj\n" +
                        "<< /Type /Page /Parent 2 0 R " +
                        "/MediaBox [0 0 $pageWStr $pageHStr] " +
                        "/Resources << /XObject << /Im${index + 1} $imageId 0 R >> >> " +
                        "/Contents $contentId 0 R >>\n" +
                        "endobj\n"
                )

                onProgress?.invoke(index + 1, pages.size)
            }

            // Write Pages root (object 2) after streaming pages
            offsets[2] = out.bytesWritten
            val kidsRefs = pageObjIds.joinToString(" ") { "$it 0 R" }
            out.writeAscii("2 0 obj\n<< /Type /Pages /Kids [$kidsRefs] /Count ${pageObjIds.size} >>\nendobj\n")

            // Write sorted XRef table
            val maxObjId = nextObjId - 1
            val xrefOffset = out.bytesWritten
            out.writeAscii("xref\n0 ${maxObjId + 1}\n")
            out.writeAscii("0000000000 65535 f \n")
            for (id in 1..maxObjId) {
                val off = offsets[id] ?: 0L
                out.writeAscii(String.format(Locale.US, "%010d 00000 n \n", off))
            }

            out.writeAscii(
                "trailer\n<< /Size ${maxObjId + 1} /Root 1 0 R >>\nstartxref\n$xrefOffset\n%%EOF\n"
            )
            out.flush()
        }
    }

    private fun writeJpegImageObject(
        out: CountingOutputStream,
        objectId: Int,
        jpegFile: File,
        width: Int,
        height: Int,
    ) {
        val components = detectJpegComponents(jpegFile)
        val colorSpace = if (components == 1) "/DeviceGray" else "/DeviceRGB"
        val streamLen = jpegFile.length()

        out.writeAscii(
            "$objectId 0 obj\n" +
                "<< /Type /XObject /Subtype /Image " +
                "/Width $width /Height $height " +
                "/ColorSpace $colorSpace /BitsPerComponent 8 " +
                "/Filter /DCTDecode /Length $streamLen >>\n" +
                "stream\n"
        )
        val buf = ByteArray(16 * 1024)
        FileInputStream(jpegFile).use { input ->
            while (true) {
                val read = input.read(buf)
                if (read <= 0) break
                out.write(buf, 0, read)
            }
        }
        out.writeAscii("\nendstream\nendobj\n")
    }

    private fun writeBitonalImageObject(
        out: CountingOutputStream,
        objectId: Int,
        pngFile: File,
    ) {
        val mat = Imgcodecs.imread(pngFile.absolutePath, Imgcodecs.IMREAD_GRAYSCALE)
        if (mat.empty()) {
            mat.release()
            throw IOException("Could not decode bitonal image: ${pngFile.name}")
        }
        val width = mat.cols()
        val height = mat.rows()
        val grayBytes = ByteArray(width * height)
        try {
            mat.get(0, 0, grayBytes)
        } finally {
            mat.release()
        }

        val rowBytes = (width + 7) / 8
        val compressed = ByteArrayOutputStream(max(256, (rowBytes * height) / 4))
        val deflater = Deflater(Deflater.BEST_SPEED)
        try {
            DeflaterOutputStream(compressed, deflater).use { zout ->
                val packedRow = ByteArray(rowBytes)
                for (y in 0 until height) {
                    packedRow.fill(0)
                    val rowStart = y * width
                    for (x in 0 until width) {
                        val lum = grayBytes[rowStart + x].toInt() and 0xFF
                        if (lum >= 128) {
                            packedRow[x ushr 3] = (packedRow[x ushr 3].toInt() or (0x80 ushr (x and 7))).toByte()
                        }
                    }
                    zout.write(packedRow)
                }
            }
        } finally {
            deflater.end()
        }

        val compressedBytes = compressed.toByteArray()
        out.writeAscii(
            "$objectId 0 obj\n" +
                "<< /Type /XObject /Subtype /Image " +
                "/Width $width /Height $height " +
                "/ColorSpace /DeviceGray /BitsPerComponent 1 " +
                "/Filter /FlateDecode /Length ${compressedBytes.size} >>\n" +
                "stream\n"
        )
        out.write(compressedBytes)
        out.writeAscii("\nendstream\nendobj\n")
    }

    private fun uniqueOutputFile(dir: File, fileName: String): File {
        val candidate = File(dir, fileName)
        if (!candidate.exists()) return candidate
        val stem = fileName.removeSuffix(".pdf")
        return File(dir, "${stem}_${UUID.randomUUID().toString().take(8)}.pdf")
    }

    companion object {
        private const val DEFAULT_MIN_REQUIRED_BYTES = 2L * 1024L * 1024L
        private const val PER_PAGE_RESERVE_BYTES = 256L * 1024L
        private const val TARGET_A4_AREA_PT = 595.0 * 842.0

        fun computePdfPageSizePoints(imageWidthPx: Int, imageHeightPx: Int): Pair<Float, Float> {
            val w = imageWidthPx.coerceAtLeast(1).toDouble()
            val h = imageHeightPx.coerceAtLeast(1).toDouble()
            val ratio = w / h
            // Match cropped paper aspect ratio cleanly at A4 visual scale (~500,990 pt^2)
            val pageH = sqrt(TARGET_A4_AREA_PT / ratio).coerceIn(288.0, 1224.0)
            val pageW = (pageH * ratio).coerceIn(288.0, 1224.0)
            return pageW.toFloat() to pageH.toFloat()
        }

        fun sanitizePdfFileName(suggested: String?): String {
            val cleaned = suggested
                ?.trim()
                ?.replace(Regex("[^A-Za-z0-9._ -]"), "_")
                ?.replace(Regex("\\s+"), "_")
                ?.trim('_', '.')
                ?.take(80)
                .orEmpty()
            val base = if (cleaned.isNotEmpty()) {
                cleaned
            } else {
                val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
                "Scan_$stamp"
            }
            return if (base.lowercase(Locale.US).endsWith(".pdf")) base else "$base.pdf"
        }

        private fun detectJpegComponents(file: File): Int {
            return runCatching {
                FileInputStream(file).use { input ->
                    val b0 = input.read()
                    val b1 = input.read()
                    if (b0 != 0xFF || b1 != 0xD8) return@use 3
                    while (true) {
                        var markerPrefix = input.read()
                        while (markerPrefix != 0xFF) {
                            if (markerPrefix == -1) return@use 3
                            markerPrefix = input.read()
                        }
                        var marker = input.read()
                        while (marker == 0xFF) {
                            marker = input.read()
                        }
                        if (marker == -1) return@use 3
                        if (marker == 0xD9 || marker == 0xDA) return@use 3
                        if (marker in 0xD0..0xD7 || marker == 0x01 || marker == 0x00) continue
                        val lenHi = input.read()
                        val lenLo = input.read()
                        if (lenHi == -1 || lenLo == -1) return@use 3
                        val segLen = (lenHi shl 8) or lenLo
                        if (segLen < 2) return@use 3
                        if (marker in listOf(0xC0, 0xC1, 0xC2, 0xC3)) {
                            // SOF header: precision(1), height(2), width(2), numComponents(1)
                            val sofHeader = ByteArray(6)
                            if (input.read(sofHeader) == 6) {
                                return@use sofHeader[5].toInt() and 0xFF
                            }
                            return@use 3
                        } else {
                            var remaining = segLen - 2L
                            while (remaining > 0L) {
                                val skipped = input.skip(remaining)
                                if (skipped <= 0L) {
                                    if (input.read() == -1) break
                                    remaining--
                                } else {
                                    remaining -= skipped
                                }
                            }
                        }
                    }
                    3
                }
            }.getOrDefault(3)
        }
    }

    private class CountingOutputStream(out: OutputStream) : FilterOutputStream(out) {
        var bytesWritten: Long = 0L
            private set

        override fun write(b: Int) {
            out.write(b)
            bytesWritten++
        }

        override fun write(b: ByteArray, off: Int, len: Int) {
            out.write(b, off, len)
            bytesWritten += len
        }

        fun writeAscii(text: String) {
            val bytes = text.toByteArray(StandardCharsets.ISO_8859_1)
            write(bytes, 0, bytes.size)
        }
    }
}
