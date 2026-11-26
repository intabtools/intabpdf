package org.intabtools.intabpdf.scanner.vision

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.intabtools.intabpdf.scanner.imaging.OpenCvRuntime
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint
import org.opencv.core.Point
import org.opencv.core.Scalar
import org.opencv.imgproc.Imgproc

/**
 * Android instrumentation test verifying native OpenCV initialization and quadrilateral
 * detection on a synthetic skewed white document over a dark wood-toned surface.
 */
@RunWith(AndroidJUnit4::class)
class OpenCvDocumentDetectorTest {

    @Test
    fun detectSyntheticDocumentQuadrilateral() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(65.0, 50.0, 38.0, 255.0))
        try {
            val paperPoly = MatOfPoint(
                Point(120.0, 70.0),
                Point(510.0, 90.0),
                Point(540.0, 410.0),
                Point(95.0, 395.0),
            )
            Imgproc.fillPoly(scene, listOf(paperPoly), Scalar(242.0, 240.0, 236.0, 255.0))
            paperPoly.release()

            val detector = OpenCvDocumentDetector()
            val result = detector.detect(scene, DetectionMode.STILL_CAPTURE)

            assertNotNull("Expected valid quad on high-contrast synthetic document", result.normalizedQuad)
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected detected quad area > 0.25, got ${result.areaFraction}", result.areaFraction > 0.25f)
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectRotatedDocumentWithInternalTextOverTexturedDesk() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4)
        try {
            // Textured wood-grain desk background
            for (y in 0 until height) {
                val row = ByteArray(width * 4)
                for (x in 0 until width) {
                    val grain = (kotlin.math.sin(y * 0.25 + kotlin.math.sin(x * 0.05) * 2.0) * 18.0).toInt()
                    val r = (105 + grain).coerceIn(0, 255)
                    val g = (78 + grain).coerceIn(0, 255)
                    val b = (54 + grain).coerceIn(0, 255)
                    row[x * 4] = r.toByte()
                    row[x * 4 + 1] = g.toByte()
                    row[x * 4 + 2] = b.toByte()
                    row[x * 4 + 3] = 255.toByte()
                }
                scene.put(y, 0, row)
            }

            // Document rotated ~42 degrees with internal text lines
            val paperPoly = MatOfPoint(
                Point(310.0, 55.0),
                Point(515.0, 215.0),
                Point(335.0, 425.0),
                Point(130.0, 265.0),
            )
            Imgproc.fillPoly(scene, listOf(paperPoly), Scalar(242.0, 240.0, 236.0, 255.0))
            paperPoly.release()

            // Internal text lines that must NOT hijack the outer paper boundary
            for (i in 0 until 5) {
                val t = 0.25 + i * 0.11
                val p1 = Point(240.0 + t * 80.0, 140.0 + t * 140.0)
                val p2 = Point(365.0 + t * 65.0, 235.0 + t * 130.0)
                Imgproc.line(scene, p1, p2, Scalar(35.0, 35.0, 35.0, 255.0), 3)
            }

            val detector = OpenCvDocumentDetector()
            val result = detector.detect(scene, DetectionMode.LIVE_PREVIEW)
            assertNotNull("Expected valid quad on rotated textured-background document", result.normalizedQuad)
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue(
                "Expected outer page area > 0.20 (not an inner text box), got ${result.areaFraction}",
                result.areaFraction > 0.20f,
            )
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectLowContrastDocumentOverLightDesk() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        // Light tan desk (168, 158, 145) vs slightly off-white paper (232, 230, 226)
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(168.0, 158.0, 145.0, 255.0))
        try {
            val paperPoly = MatOfPoint(
                Point(110.0, 65.0),
                Point(520.0, 80.0),
                Point(535.0, 415.0),
                Point(95.0, 400.0),
            )
            Imgproc.fillPoly(scene, listOf(paperPoly), Scalar(232.0, 230.0, 226.0, 255.0))
            paperPoly.release()

            val detector = OpenCvDocumentDetector()
            val result = detector.detect(scene, DetectionMode.LIVE_PREVIEW)
            assertNotNull("Expected valid quad on low-contrast document", result.normalizedQuad)
            assertTrue("Expected confidence >= 0.45 on low-contrast document, got ${result.confidence}", result.confidence >= 0.45f)
        } finally {
            scene.release()
        }
    }
}
