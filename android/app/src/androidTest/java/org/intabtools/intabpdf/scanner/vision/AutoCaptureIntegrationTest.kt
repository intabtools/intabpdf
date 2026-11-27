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

    @Test
    fun automaticCaptureCompletesOnSharpTextHeavyDocumentUnderModeratelyDimLighting() = runBlocking {
        assertTrue(OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val controller = CameraPreviewController(context, initialAutoCaptureEnabled = true)
        val store = StillCaptureStore(context, OpenCvDocumentDetector())

        val dimSharpDoc = createDimTextDocumentRgba(blurred = false)
        val dimBlurryDoc = createDimTextDocumentRgba(blurred = true)
        try {
            // Blurry dim document must NOT trigger auto-capture even when locked
            repeat(4) { i ->
                controller.analyzeAndStabilizeMat(dimBlurryDoc, rotationDegrees = 0, nowMs = (i + 1) * 350L)
            }
            val blurryAttempt = controller.analyzeAndStabilizeMat(dimBlurryDoc, rotationDegrees = 0, nowMs = 2000L)
            assertFalse("Out-of-focus dim frame must not auto-capture", blurryAttempt.shouldTriggerAutoCapture)

            // Reset controller cleanly and test sharp moderately dim text page
            val sharpController = CameraPreviewController(context, initialAutoCaptureEnabled = true)
            try {
                sharpController.analyzeAndStabilizeMat(dimSharpDoc, rotationDegrees = 0, nowMs = 100L)
                sharpController.analyzeAndStabilizeMat(dimSharpDoc, rotationDegrees = 0, nowMs = 200L)
                val locked = sharpController.analyzeAndStabilizeMat(dimSharpDoc, rotationDegrees = 0, nowMs = 300L)
                assertTrue("Expected quad lock on sharp dim text document", locked.isLocked)
                assertNotNull(locked.overlayQuad)

                val trigger = sharpController.analyzeAndStabilizeMat(dimSharpDoc, rotationDegrees = 0, nowMs = 1350L)
                assertTrue("Expected auto-capture on sharp steady dim document, hint=${trigger.userHint}", trigger.shouldTriggerAutoCapture)

                val rawFile = store.newTempRawCaptureFile()
                Imgcodecs.imwrite(rawFile.absolutePath, bgrFromRgba(dimSharpDoc))
                val saved = store.saveFullResolutionCapture(rawFile, trigger.overlayQuad, autoCaptured = true)
                assertFalse("Expected still detection to succeed cleanly without fallback", saved.detectionRecovered)
                assertNotNull(saved.detectedQuad)
            } finally {
                sharpController.shutdown()
            }
        } finally {
            dimSharpDoc.release()
            dimBlurryDoc.release()
            controller.shutdown()
        }
    }

    @Test
    fun automaticCaptureTriggersOnNormalIndoorThinTextWithWoodDesk() = runBlocking {
        assertTrue(OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val controller = CameraPreviewController(context, initialAutoCaptureEnabled = true)

        val indoorDoc = createIndoorThinTextDocumentRgba()
        try {
            controller.analyzeAndStabilizeMat(indoorDoc, rotationDegrees = 0, nowMs = 100L)
            controller.analyzeAndStabilizeMat(indoorDoc, rotationDegrees = 0, nowMs = 200L)
            val locked = controller.analyzeAndStabilizeMat(indoorDoc, rotationDegrees = 0, nowMs = 300L)
            assertTrue("Expected quad lock on indoor thin-text doc (hint=${locked.userHint}, conf=${locked.lastConfidence})", locked.isLocked)
            assertNotNull(locked.overlayQuad)

            val trigger = controller.analyzeAndStabilizeMat(indoorDoc, rotationDegrees = 0, nowMs = 1350L)
            assertTrue("Expected auto-capture on steady indoor thin-text doc, hint=${trigger.userHint}", trigger.shouldTriggerAutoCapture)
        } finally {
            indoorDoc.release()
            controller.shutdown()
        }
    }

    @Test
    fun automaticCaptureTriggersOnDimFullFrameThinTextDocument() = runBlocking {
        assertTrue(OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val controller = CameraPreviewController(context, initialAutoCaptureEnabled = true)

        // Large document filling most of center ROI (mean ~ 75) with crisp 1px printed text lines
        val doc = Mat(480, 640, CvType.CV_8UC4, Scalar(24.0, 20.0, 18.0, 255.0))
        val paper = MatOfPoint(
            Point(75.0, 48.0),
            Point(565.0, 56.0),
            Point(575.0, 430.0),
            Point(65.0, 422.0),
        )
        Imgproc.fillPoly(doc, listOf(paper), Scalar(88.0, 86.0, 82.0, 255.0))
        paper.release()
        for (rowIdx in 0 until 10) {
            val y = 96.0 + rowIdx * 28.0
            Imgproc.line(doc, Point(120.0, y), Point(510.0, y), Scalar(24.0, 24.0, 26.0, 255.0), 1)
        }

        try {
            controller.analyzeAndStabilizeMat(doc, rotationDegrees = 0, nowMs = 100L)
            controller.analyzeAndStabilizeMat(doc, rotationDegrees = 0, nowMs = 200L)
            val locked = controller.analyzeAndStabilizeMat(doc, rotationDegrees = 0, nowMs = 300L)
            assertTrue("Expected lock on dim 1px text document, hint=${locked.userHint}, conf=${locked.lastConfidence}", locked.isLocked)

            val trigger = controller.analyzeAndStabilizeMat(doc, rotationDegrees = 0, nowMs = 1350L)
            assertTrue("Expected auto-capture on steady dim 1px text document, hint=${trigger.userHint}, progress=${trigger.autoCaptureProgress}", trigger.shouldTriggerAutoCapture)
        } finally {
            doc.release()
            controller.shutdown()
        }
    }

    @Test
    fun automaticCaptureTriggersOnDimSparsePrintedTextGlyphsWithoutMedianErase() = runBlocking {
        assertTrue(OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val controller = CameraPreviewController(context, initialAutoCaptureEnabled = true)

        // Realistic dim printed page (mean ~ 72 in center ROI) with short 1px word-like glyphs & light PSF
        val doc = Mat(480, 640, CvType.CV_8UC4, Scalar(24.0, 20.0, 18.0, 255.0))
        val paper = MatOfPoint(
            Point(75.0, 48.0),
            Point(565.0, 56.0),
            Point(575.0, 430.0),
            Point(65.0, 422.0),
        )
        Imgproc.fillPoly(doc, listOf(paper), Scalar(84.0, 82.0, 78.0, 255.0))
        paper.release()
        for (rowIdx in 0 until 7) {
            val y = 115.0 + rowIdx * 36.0
            var x = 140.0
            while (x < 470.0) {
                Imgproc.line(doc, Point(x, y), Point(x + 8.0, y), Scalar(42.0, 42.0, 44.0, 255.0), 1)
                Imgproc.line(doc, Point(x + 3.0, y - 3.0), Point(x + 3.0, y + 3.0), Scalar(42.0, 42.0, 44.0, 255.0), 1)
                x += 22.0
            }
        }

        try {
            controller.analyzeAndStabilizeMat(doc, rotationDegrees = 0, nowMs = 100L)
            controller.analyzeAndStabilizeMat(doc, rotationDegrees = 0, nowMs = 200L)
            val locked = controller.analyzeAndStabilizeMat(doc, rotationDegrees = 0, nowMs = 300L)
            assertTrue("Expected lock on dim short-glyph text page, hint=${locked.userHint}, conf=${locked.lastConfidence}", locked.isLocked)

            val trigger = controller.analyzeAndStabilizeMat(doc, rotationDegrees = 0, nowMs = 1350L)
            assertTrue(
                "Expected auto-capture on crisp dim sparse glyphs (not rejected as blurry), hint=${trigger.userHint}, progress=${trigger.autoCaptureProgress}",
                trigger.shouldTriggerAutoCapture,
            )
        } finally {
            doc.release()
            controller.shutdown()
        }
    }

    private fun createIndoorThinTextDocumentRgba(): Mat {
        val mat = Mat(480, 640, CvType.CV_8UC4)
        for (y in 0 until 480) {
            val row = ByteArray(640 * 4)
            for (x in 0 until 640) {
                val grain = (kotlin.math.sin(y * 0.22 + kotlin.math.sin(x * 0.06) * 2.0) * 10.0).toInt()
                row[x * 4] = (86 + grain).coerceIn(0, 255).toByte()
                row[x * 4 + 1] = (72 + grain).coerceIn(0, 255).toByte()
                row[x * 4 + 2] = (58 + grain).coerceIn(0, 255).toByte()
                row[x * 4 + 3] = 255.toByte()
            }
            mat.put(y, 0, row)
        }
        val paper = MatOfPoint(
            Point(110.0, 68.0),
            Point(520.0, 80.0),
            Point(530.0, 408.0),
            Point(98.0, 396.0),
        )
        // Typical dim-indoor mean (80..92) with thin 1-2px printed text strokes
        Imgproc.fillPoly(mat, listOf(paper), Scalar(118.0, 116.0, 112.0, 255.0))
        paper.release()
        for (rowIdx in 0 until 12) {
            val y = 104.0 + rowIdx * 23.0
            Imgproc.line(mat, Point(145.0, y), Point(485.0, y), Scalar(42.0, 42.0, 46.0, 255.0), 1)
        }
        return mat
    }

    private fun createDimTextDocumentRgba(blurred: Boolean): Mat {
        val mat = Mat(480, 640, CvType.CV_8UC4, Scalar(26.0, 22.0, 18.0, 255.0))
        val paper = MatOfPoint(
            Point(105.0, 68.0),
            Point(525.0, 80.0),
            Point(535.0, 408.0),
            Point(95.0, 396.0),
        )
        Imgproc.fillPoly(mat, listOf(paper), Scalar(88.0, 86.0, 82.0, 255.0))
        paper.release()

        for (row in 0 until 9) {
            val y = 112.0 + row * 28.0
            Imgproc.line(mat, Point(140.0, y), Point(485.0, y), Scalar(24.0, 24.0, 26.0, 255.0), 3)
        }
        if (blurred) {
            Imgproc.GaussianBlur(mat, mat, org.opencv.core.Size(31.0, 31.0), 7.5)
        }
        return mat
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
