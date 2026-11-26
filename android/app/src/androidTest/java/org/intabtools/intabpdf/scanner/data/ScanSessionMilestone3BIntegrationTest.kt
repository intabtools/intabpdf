package org.intabtools.intabpdf.scanner.data

import android.content.Context
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.intabtools.intabpdf.scanner.imaging.OpenCvRuntime
import org.intabtools.intabpdf.scanner.vision.NormalizedPoint
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import org.intabtools.intabpdf.scanner.vision.OpenCvDocumentDetector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
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
class ScanSessionMilestone3BIntegrationTest {

    @Test
    fun multiPageOrderingDeletionRetakeAndIndependentEditsWorkEndToEnd(): Unit = runBlocking {
        assertTrue(OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = StillCaptureStore(context, OpenCvDocumentDetector())
        val controller = ScanSessionController(
            context = context,
            captureStore = store,
            mainDispatcher = Dispatchers.Default,
        )
        try {
            val p1 = store.saveFullResolutionCapture(writeSamplePage(store, Scalar(245.0, 245.0, 245.0)), null, autoCaptured = false)
            val p2 = store.saveFullResolutionCapture(writeSamplePage(store, Scalar(240.0, 235.0, 245.0)), null, autoCaptured = true)
            val p3 = store.saveFullResolutionCapture(writeSamplePage(store, Scalar(235.0, 245.0, 240.0)), null, autoCaptured = false)

            controller.onCameraPageCaptured(p1, null)
            controller.onCameraPageCaptured(p2, null)
            controller.onCameraPageCaptured(p3, null)
            waitUntil { controller.uiState.value.pages.size == 3 }

            controller.openReview()
            controller.selectPage(0)
            waitUntil { controller.uiState.value.selectedPageIndex == 0 }

            // Independent per-page crop, rotation, and filter on page 1
            val customCropP1 = NormalizedQuad(
                NormalizedPoint(0.14f, 0.14f),
                NormalizedPoint(0.86f, 0.14f),
                NormalizedPoint(0.86f, 0.86f),
                NormalizedPoint(0.14f, 0.86f),
            )
            controller.applyCropQuad(p1.pageId, customCropP1)
            controller.rotateSelectedPage(90)
            controller.selectFilter(ScanFilter.BLACK_AND_WHITE)
            waitUntil {
                val page = controller.uiState.value.pages.firstOrNull { it.pageId == p1.pageId }
                page?.selectedFilter == ScanFilter.BLACK_AND_WHITE &&
                    page.rotationDegrees == 90 &&
                    page.userQuad == customCropP1
            }

            // Reorder page 0 -> index 1
            controller.moveSelectedPage(1)
            waitUntil {
                val ids = controller.uiState.value.pages.map { it.pageId }
                ids == listOf(p2.pageId, p1.pageId, p3.pageId)
            }

            // Page 2 keeps default rotation=0 and AUTO filter, untouched by Page 1 edits
            val p2AfterMove = controller.uiState.value.pages[0]
            assertEquals(0, p2AfterMove.rotationDegrees)
            assertEquals(ScanFilter.AUTO, p2AfterMove.selectedFilter)

            // Retake replacement on page p2 updates slot 0 without changing count or other pages
            controller.beginRetakePage(p2.pageId)
            val retakeSource = store.saveFullResolutionCapture(
                writeSamplePage(store, Scalar(250.0, 250.0, 230.0)),
                null,
                autoCaptured = false,
                replacePageId = p2.pageId,
            )
            controller.onCameraPageCaptured(retakeSource, p2.pageId)
            waitUntil { controller.uiState.value.pages.firstOrNull()?.pageId == retakeSource.pageId }
            assertEquals(3, controller.uiState.value.pages.size)

            // Apply-to-all overwrites filter across all pages while preserving Page 1 crop & rotation
            controller.setApplyFilterToAll(true)
            controller.selectFilter(ScanFilter.GRAYSCALE)
            waitUntil { controller.uiState.value.pages.all { it.selectedFilter == ScanFilter.GRAYSCALE } }
            val p1AfterGlobalFilter = controller.uiState.value.pages.first { it.pageId == p1.pageId }
            assertEquals(90, p1AfterGlobalFilter.rotationDegrees)
            assertEquals(customCropP1, p1AfterGlobalFilter.userQuad)

            // Delete remaining pages cleanly down to empty state
            val idsToDelete = controller.uiState.value.pages.map { it.pageId }
            for (id in idsToDelete) {
                controller.deletePage(id)
            }
            waitUntil { controller.uiState.value.pages.isEmpty() }
            assertEquals(0, controller.uiState.value.selectedPageIndex)
        } finally {
            controller.shutdown()
        }
    }

    @Test
    fun galleryImportAppliesExifOrientationSkipsCorruptUrisAndHandlesEmptyCancellation(): Unit = runBlocking {
        assertTrue(OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = StillCaptureStore(context, OpenCvDocumentDetector())
        val controller = ScanSessionController(
            context = context,
            captureStore = store,
            mainDispatcher = Dispatchers.Default,
        )
        try {
            // Cancelled gallery picker returns empty list -> session untouched
            controller.importGalleryUris(emptyList())
            assertEquals(0, controller.uiState.value.pages.size)
            assertEquals(ScannerRoute.Camera, controller.uiState.value.route)

            // Landscape 960x640 file tagged EXIF ORIENTATION_ROTATE_90 -> must become 640x960 portrait
            val rotatedGalleryFile = writeSamplePage(store, Scalar(245.0, 245.0, 245.0), width = 960, height = 640)
            ExifInterface(rotatedGalleryFile.absolutePath).apply {
                setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString())
                saveAttributes()
            }
            val missingUri = Uri.fromFile(File(context.cacheDir, "does_not_exist_${System.nanoTime()}.jpg"))

            controller.importGalleryUris(listOf(Uri.fromFile(rotatedGalleryFile), missingUri))
            waitUntil { !controller.uiState.value.isImportingGallery && controller.uiState.value.pages.size == 1 }

            val importedPage = controller.uiState.value.pages.single()
            assertEquals(640, importedPage.sourceWidthPx)
            assertEquals(960, importedPage.sourceHeightPx)
            assertEquals(ScannerRoute.Review, controller.uiState.value.route)
            assertTrue(
                controller.uiState.value.statusMessage?.contains("1 skipped") == true
            )
            rotatedGalleryFile.delete()
        } finally {
            controller.shutdown()
        }
    }

    @Test
    fun filterThumbnailsReuseDiskCacheAndRapidFilterSwitchCancelsStaleRenders(): Unit = runBlocking {
        assertTrue(OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = StillCaptureStore(context, OpenCvDocumentDetector())
        val controller = ScanSessionController(
            context = context,
            captureStore = store,
            mainDispatcher = Dispatchers.Default,
        )
        try {
            val page = store.saveFullResolutionCapture(
                writeSamplePage(store, Scalar(242.0, 242.0, 242.0), width = 1000, height = 1400),
                fallbackQuad = null,
                autoCaptured = false,
            )
            controller.onCameraPageCaptured(page, null)
            waitUntil { controller.uiState.value.pages.size == 1 }

            controller.openReview()
            waitUntil {
                val s = controller.uiState.value
                s.filterThumbnails.size == ScanFilter.entries.size && s.renderedFiles[page.pageId] != null
            }

            val initialThumbMtimes = controller.uiState.value.filterThumbnails.mapValues { it.value.lastModified() }
            val initialCacheKey = controller.uiState.value.thumbnailCacheKey
            assertNotNull(initialCacheKey)

            // Rapidly switch filters in succession: stale intermediate renders must never beat the final choice
            controller.selectFilter(ScanFilter.BLACK_AND_WHITE)
            controller.selectFilter(ScanFilter.COLOR)
            controller.selectFilter(ScanFilter.ORIGINAL)

            waitUntil {
                val s = controller.uiState.value
                val rec = s.pages.firstOrNull { it.pageId == page.pageId }
                val rendered = s.renderedFiles[page.pageId]
                rec?.selectedFilter == ScanFilter.ORIGINAL &&
                    rendered?.effectiveFilter == ScanFilter.ORIGINAL &&
                    s.renderingPageIds.isEmpty()
            }

            // Switching filter must NOT regenerate thumbnails unnecessarily
            assertEquals(initialCacheKey, controller.uiState.value.thumbnailCacheKey)
            val afterThumbMtimes = controller.uiState.value.filterThumbnails.mapValues { it.value.lastModified() }
            assertEquals(initialThumbMtimes, afterThumbMtimes)
        } finally {
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

    private fun writeSamplePage(
        store: StillCaptureStore,
        paperColor: Scalar,
        width: Int = 800,
        height: Int = 1100,
    ): File {
        val file = store.newTempRawCaptureFile()
        val mat = Mat(height, width, CvType.CV_8UC3, Scalar(35.0, 35.0, 40.0))
        try {
            Imgproc.rectangle(
                mat,
                Point(width * 0.1, height * 0.1),
                Point(width * 0.9, height * 0.9),
                paperColor,
                -1,
            )
            Imgproc.line(
                mat,
                Point(width * 0.2, height * 0.35),
                Point(width * 0.8, height * 0.35),
                Scalar(20.0, 20.0, 25.0),
                6,
            )
            Imgcodecs.imwrite(file.absolutePath, mat)
        } finally {
            mat.release()
        }
        return file
    }
}
