package org.intabtools.intabpdf.scanner.vision

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.intabtools.intabpdf.scanner.data.StillCaptureStore
import org.intabtools.intabpdf.scanner.imaging.OpenCvRuntime
import org.intabtools.intabpdf.scanner.ui.camera.CameraPreviewController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint
import org.opencv.core.Point
import org.opencv.core.Scalar
import org.opencv.imgcodecs.Imgcodecs
import org.opencv.imgproc.Imgproc

/**
 * Integration test exercising the full automatic capture state machine with live OpenCV
 * detection, FrameQualityAnalyzer, QuadStabilizer countdown, StillCaptureStore persistence,
 * cooldown, and stationary duplicate prevention.
 */
@RunWith(AndroidJUnit4::class)
class AutoCaptureIntegrationTest {

    @Test
    fun automaticCaptureSequenceLocksCountsDownCapturesCoolsDownAndBlocksDuplicates() = runBlocking {
        assertTrue(OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val controller = CameraPreviewController(context, initialAutoCaptureEnabled = true)
        val store = StillCaptureStore(context, OpenCvDocumentDetector())

        val doc1 = createHighContrastDocumentRgba(offsetX = 0)
        val doc2 = createHighContrastDocumentRgba(offsetX = 75) // shifted scene -> new page
        try {
            // 1. First 2 frames do not lock yet
            val f1 = controller.analyzeAndStabilizeMat(doc1, rotationDegrees = 0, nowMs = 100L)
            assertFalse(f1.isLocked)
            assertFalse(f1.shouldTriggerAutoCapture)

            val f2 = controller.analyzeAndStabilizeMat(doc1, rotationDegrees = 0, nowMs = 200L)
            assertFalse(f2.isLocked)

            // 2. Frame 3 locks overlay and begins hold window
            val f3 = controller.analyzeAndStabilizeMat(doc1, rotationDegrees = 0, nowMs = 300L)
            assertTrue("Expected quad lock on 3rd consistent frame", f3.isLocked)
            assertNotNull(f3.overlayQuad)
            assertFalse(f3.shouldTriggerAutoCapture)

            // 3. Intermediate countdown frame (~50% of 900ms hold window)
            val mid = controller.analyzeAndStabilizeMat(doc1, rotationDegrees = 0, nowMs = 750L)
            assertTrue("Expected countdown progress > 0.3, got ${mid.autoCaptureProgress}", mid.autoCaptureProgress >= 0.3f)
            assertFalse(mid.shouldTriggerAutoCapture)

            // 4. Hold completes (>= 900ms) -> triggers Auto-Capture and saves full-res JPEG
            val trigger = controller.analyzeAndStabilizeMat(doc1, rotationDegrees = 0, nowMs = 1300L)
            assertTrue("Expected auto-capture trigger after sustained hold", trigger.shouldTriggerAutoCapture)
            assertEquals(1.0f, trigger.autoCaptureProgress, 1e-4f)

            controller.markCaptureTriggeredForTest(1300L, trigger.overlayQuad)
            val raw1 = store.newTempRawCaptureFile()
            Imgcodecs.imwrite(raw1.absolutePath, bgrFromRgba(doc1))
            val saved1 = store.saveFullResolutionCapture(raw1, trigger.overlayQuad, autoCaptured = true)
            assertTrue(saved1.autoCaptured)
            assertEquals(1, store.currentPages().size)

            // 5. Within cooldown (1300 + 800ms < 3500ms) -> stays blocked
            val cooldownFrame = controller.analyzeAndStabilizeMat(doc1, rotationDegrees = 0, nowMs = 2100L)
            assertFalse(cooldownFrame.shouldTriggerAutoCapture)
            assertEquals(CameraUserHint.CAPTURING_NEXT_COOLDOWN, cooldownFrame.userHint)

            // 6. Past cooldown (+3500ms) with identical stationary document -> duplicate prevented!
            val duplicateFrame = controller.analyzeAndStabilizeMat(doc1, rotationDegrees = 0, nowMs = 4800L)
            assertFalse("Stationary identical document must remain duplicate-blocked", duplicateFrame.shouldTriggerAutoCapture)
            assertEquals(CameraUserHint.CAPTURING_NEXT_COOLDOWN, duplicateFrame.userHint)

            // 7. Shift document (doc2) -> breaks duplicate lock, re-locks, and auto-captures page 2
            controller.analyzeAndStabilizeMat(doc2, rotationDegrees = 0, nowMs = 5000L)
            controller.analyzeAndStabilizeMat(doc2, rotationDegrees = 0, nowMs = 5100L)
            val anchor2 = controller.analyzeAndStabilizeMat(doc2, rotationDegrees = 0, nowMs = 5200L)
            assertFalse(anchor2.shouldTriggerAutoCapture)

            val trigger2 = controller.analyzeAndStabilizeMat(doc2, rotationDegrees = 0, nowMs = 6200L)
            assertTrue("Expected second page auto-capture after scene shift", trigger2.shouldTriggerAutoCapture)
            controller.markCaptureTriggeredForTest(6200L, trigger2.overlayQuad)
            val raw2 = store.newTempRawCaptureFile()
            Imgcodecs.imwrite(raw2.absolutePath, bgrFromRgba(doc2))
            store.saveFullResolutionCapture(raw2, trigger2.overlayQuad, autoCaptured = true)
            assertEquals(2, store.currentPages().size)
        } finally {
            doc1.release()
            doc2.release()
            controller.shutdown()
        }
    }

    private fun createHighContrastDocumentRgba(offsetX: Int): Mat {
        val mat = Mat(480, 640, CvType.CV_8UC4, Scalar(50.0, 40.0, 32.0, 255.0))
        val paper = MatOfPoint(
            Point((90 + offsetX).toDouble(), 70.0),
            Point((440 + offsetX).toDouble(), 85.0),
            Point((455 + offsetX).toDouble(), 405.0),
            Point((80 + offsetX).toDouble(), 390.0),
        )
        Imgproc.fillPoly(mat, listOf(paper), Scalar(244.0, 244.0, 240.0, 255.0))
        paper.release()

        // High-frequency crisp simulated text bars for Laplacian focus variance
        for (row in 0 until 8) {
            val y = 120.0 + row * 28.0
            Imgproc.line(
                mat,
                Point((120 + offsetX).toDouble(), y),
                Point((400 + offsetX).toDouble(), y),
                Scalar(25.0, 25.0, 25.0, 255.0),
                3,
            )
        }
        return mat
    }

    private fun bgrFromRgba(rgba: Mat): Mat {
        val bgr = Mat()
        Imgproc.cvtColor(rgba, bgr, Imgproc.COLOR_RGBA2BGR)
        return bgr
    }
}
