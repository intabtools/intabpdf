package org.intabtools.intabpdf.scanner.pdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.exifinterface.media.ExifInterface
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.intabtools.intabpdf.scanner.data.NonDestructivePagePipeline
import org.intabtools.intabpdf.scanner.data.ScanFilter
import org.intabtools.intabpdf.scanner.data.ScanQuality
import org.intabtools.intabpdf.scanner.data.ScanSessionController
import org.intabtools.intabpdf.scanner.data.ScannerPaths
import org.intabtools.intabpdf.scanner.data.StillCaptureStore
import org.intabtools.intabpdf.scanner.imaging.OpenCvRuntime
import org.intabtools.intabpdf.scanner.vision.NormalizedPoint
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import org.intabtools.intabpdf.scanner.vision.OpenCvDocumentDetector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.Point
import org.opencv.core.Scalar
import org.opencv.imgcodecs.Imgcodecs
import org.opencv.imgproc.Imgproc
import java.io.File

@RunWith(AndroidJUnit4::class)
class PdfExportAndLifecycleIntegrationTest {

    @Test
    fun singleAndMultiPageEditedPdfExportPreservesOrderCropRotationFiltersAndRendersCleanly(): Unit = runBlocking {
        assertTrue(OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = StillCaptureStore(context, OpenCvDocumentDetector())
        val controller = ScanSessionController(
            context = context,
            captureStore = store,
            mainDispatcher = Dispatchers.Default,
        )
        var exportedPdfFile: File? = null
        try {
            // Empty session must reject PDF export cleanly
            controller.exportPdf()
            waitUntil { controller.uiState.value.exportErrorMessage != null }
            assertNull(controller.uiState.value.completedExport)
            controller.dismissExportError()

            // Page 1: captured page + custom crop + 90-deg rotation + BLACK_AND_WHITE
            val p1 = store.saveFullResolutionCapture(
                writeSampleDoc(store, 900, 1200, Scalar(245.0, 245.0, 245.0)),
                null,
                autoCaptured = true,
            )
            // Page 2: gallery imported EXIF-rotated page + COLOR
            val galleryRaw = writeSampleDoc(store, 1200, 800, Scalar(235.0, 240.0, 250.0))
            ExifInterface(galleryRaw.absolutePath).apply {
                setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString())
                saveAttributes()
            }

            controller.onCameraPageCaptured(p1, null)
            waitUntil { controller.uiState.value.pages.size == 1 }
            controller.importGalleryUris(listOf(Uri.fromFile(galleryRaw)))
            waitUntil { !controller.uiState.value.isImportingGallery && controller.uiState.value.pages.size == 2 }
            galleryRaw.delete()

            val page2Id = controller.uiState.value.pages[1].pageId
            controller.openReview()
            controller.selectPage(0)
            controller.applyCropQuad(
                p1.pageId,
                NormalizedQuad(
                    NormalizedPoint(0.12f, 0.12f),
                    NormalizedPoint(0.88f, 0.12f),
                    NormalizedPoint(0.88f, 0.88f),
                    NormalizedPoint(0.12f, 0.88f),
                ),
            )
            controller.rotateSelectedPage(90)
            controller.selectFilter(ScanFilter.BLACK_AND_WHITE)

            controller.selectPage(1)
            controller.selectFilter(ScanFilter.COLOR)
            // Move page 2 before page 1
            controller.moveSelectedPage(-1)
            waitUntil { controller.uiState.value.pages.map { it.pageId } == listOf(page2Id, p1.pageId) }

            // Export multi-page PDF
            controller.exportPdf()
            waitUntil(timeoutMs = 15_000L) { controller.uiState.value.completedExport != null }
            val result = controller.uiState.value.completedExport!!
            exportedPdfFile = result.outputFile

            assertEquals(2, result.pageCount)
            assertTrue(result.outputFile.exists() && result.sizeBytes > 1000L)
            assertTrue(ScannerPaths.isOwnedOutputFile(context, result.outputFile))

            // Verify valid PDF rendering via Android PdfRenderer
            ParcelFileDescriptor.open(result.outputFile, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
                PdfRenderer(pfd).use { renderer ->
                    assertEquals(2, renderer.pageCount)

                    // First PDF page should be portrait (gallery-imported portrait COLOR scan)
                    renderer.openPage(0).use { pdfPage0 ->
                        assertTrue("Expected portrait page 0, got ${pdfPage0.width}x${pdfPage0.height}", pdfPage0.height > pdfPage0.width)
                        val bmp = Bitmap.createBitmap(pdfPage0.width, pdfPage0.height, Bitmap.Config.ARGB_8888)
                        pdfPage0.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        bmp.recycle()
                    }

                    // Second PDF page should be landscape (90-deg rotated B&W scan)
                    renderer.openPage(1).use { pdfPage1 ->
                        assertTrue("Expected landscape rotated page 1, got ${pdfPage1.width}x${pdfPage1.height}", pdfPage1.width > pdfPage1.height)
                        val bmp = Bitmap.createBitmap(pdfPage1.width, pdfPage1.height, Bitmap.Config.ARGB_8888)
                        pdfPage1.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        bmp.recycle()
                    }
                }
            }

            // Original full-resolution sources remain intact after export
            assertTrue(File(p1.sourceFilePath).exists())
            // Pruning stale (<24h) must NOT delete valid just-created PDF
            ScannerPaths.pruneStaleDirectory(ScannerPaths.outputDir(context))
            assertTrue(result.outputFile.exists())
        } finally {
            exportedPdfFile?.delete()
            ScannerPaths.sessionDir(context, store.sessionId).deleteRecursively()
            controller.shutdown()
        }
    }

    @Test
    fun insufficientStorageFailureAndCancellationLeaveZeroPartialFilesAndKeepEditsIntact(): Unit = runBlocking {
        assertTrue(OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = StillCaptureStore(context, OpenCvDocumentDetector())
        val controller = ScanSessionController(
            context = context,
            captureStore = store,
            mainDispatcher = Dispatchers.Default,
        )
        val outputDir = ScannerPaths.outputDir(context)
        val existingFilesBefore = outputDir.listFiles()?.map { it.name }?.toSet().orEmpty()
        try {
            val page = store.saveFullResolutionCapture(
                writeSampleDoc(store, 800, 1100, Scalar(240.0, 240.0, 240.0)),
                null,
                autoCaptured = false,
            )
            controller.onCameraPageCaptured(page, null)
            waitUntil { controller.uiState.value.pages.size == 1 }
            controller.openReview()

            // Force insufficient storage failure
            controller.exportPdf(availableSpaceOverrideBytes = 64_000L)
            waitUntil { controller.uiState.value.exportErrorMessage != null && !controller.uiState.value.isExportingPdf }

            assertNull(controller.uiState.value.completedExport)
            assertTrue(controller.uiState.value.exportErrorMessage!!.contains("storage", ignoreCase = true))
            // Edits & page remain preserved so user can retry cleanly
            assertEquals(1, controller.uiState.value.pages.size)

            // Verify zero orphan .tmp or broken .pdf files created
            val newFiles = outputDir.listFiles()?.map { it.name }?.toSet().orEmpty() - existingFilesBefore
            assertTrue("No partial export files should remain after failure: $newFiles", newFiles.isEmpty())

            // Ownership check prevents deleting files outside scanner_outputs
            val outsideFile = File(context.cacheDir, "must_not_delete_${System.nanoTime()}.pdf").apply {
                writeText("%PDF-1.4")
            }
            assertFalse(ScannerPaths.isOwnedOutputFile(context, outsideFile))
            outsideFile.delete()
        } finally {
            ScannerPaths.sessionDir(context, store.sessionId).deleteRecursively()
            controller.shutdown()
        }
    }

    private suspend fun waitUntil(timeoutMs: Long = 10_000L, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            delay(40L)
        }
        assertTrue("Condition timed out after ${timeoutMs}ms", condition())
    }

    private fun writeSampleDoc(
        store: StillCaptureStore,
        width: Int,
        height: Int,
        paperColor: Scalar,
    ): File {
        val file = store.newTempRawCaptureFile()
        val mat = Mat(height, width, CvType.CV_8UC3, Scalar(30.0, 30.0, 35.0))
        try {
            Imgproc.rectangle(mat, Point(width * 0.1, height * 0.1), Point(width * 0.9, height * 0.9), paperColor, -1)
            Imgproc.line(mat, Point(width * 0.2, height * 0.3), Point(width * 0.8, height * 0.3), Scalar(15.0, 15.0, 20.0), 6)
            Imgcodecs.imwrite(file.absolutePath, mat)
        } finally {
            mat.release()
        }
        return file
    }
}
