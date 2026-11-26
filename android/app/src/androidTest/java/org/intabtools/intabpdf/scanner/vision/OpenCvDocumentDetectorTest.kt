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
}
