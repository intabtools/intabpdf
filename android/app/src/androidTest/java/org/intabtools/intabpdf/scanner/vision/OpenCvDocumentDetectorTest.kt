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

    @Test
    fun detectPerspectiveDistortedTrapezoidAtObliqueAngle() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(58.0, 48.0, 40.0, 255.0))
        try {
            // Strongly foreshortened oblique trapezoid (short far top edge, wide near bottom edge,
            // unequal side lengths and non-90 corner angles ~55..125 deg)
            val trapezoid = MatOfPoint(
                Point(215.0, 105.0),
                Point(435.0, 120.0),
                Point(545.0, 390.0),
                Point(90.0, 365.0),
            )
            Imgproc.fillPoly(scene, listOf(trapezoid), Scalar(240.0, 238.0, 234.0, 255.0))
            trapezoid.release()

            // Simulated document text lines
            for (i in 0 until 5) {
                val y = 165.0 + i * 36.0
                Imgproc.line(scene, Point(190.0, y), Point(450.0, y + 6.0), Scalar(40.0, 40.0, 40.0, 255.0), 3)
            }

            val detector = OpenCvDocumentDetector()
            val result = detector.detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on oblique trapezoidal page", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45 on trapezoidal page, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected top edge shorter than bottom edge", quad.topLeft.distanceTo(quad.topRight) < quad.bottomLeft.distanceTo(quad.bottomRight))
            assertTrue("Expected TL left of TR", quad.topLeft.x < quad.topRight.x)
            assertTrue("Expected BL left of BR", quad.bottomLeft.x < quad.bottomRight.x)
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectOpenNotebookTargetPageWithCurvedSpineWithoutIncludingOppositePage() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(72.0, 58.0, 44.0, 255.0))
        try {
            // Dark notebook cover spanning both pages
            Imgproc.rectangle(scene, Point(50.0, 55.0), Point(590.0, 430.0), Scalar(28.0, 30.0, 36.0, 255.0), -1)

            // Left page (partially visible opposite page)
            val leftPage = MatOfPoint(
                Point(65.0, 72.0),
                Point(210.0, 78.0),
                Point(210.0, 412.0),
                Point(65.0, 416.0),
            )
            Imgproc.fillPoly(scene, listOf(leftPage), Scalar(230.0, 228.0, 222.0, 255.0))
            leftPage.release()

            // Target right page with slightly curved/bowed spine edge along the center binding
            val rightPagePts = mutableListOf(
                Point(230.0, 76.0),
                Point(572.0, 70.0),
                Point(574.0, 416.0),
                Point(230.0, 412.0),
            )
            // Add slight bow along spine edge (between 230,412 back up to 230,76)
            for (step in 1..6) {
                val t = step / 7.0
                val y = 412.0 - t * (412.0 - 76.0)
                val bowX = 230.0 + kotlin.math.sin(t * Math.PI) * 14.0
                rightPagePts.add(Point(bowX, y))
            }
            val rightPage = MatOfPoint(*rightPagePts.toTypedArray())
            Imgproc.fillPoly(scene, listOf(rightPage), Scalar(244.0, 242.0, 238.0, 255.0))
            rightPage.release()

            // Notebook ruled lines on target right page
            for (row in 0 until 6) {
                val y = 120.0 + row * 42.0
                Imgproc.line(scene, Point(265.0, y), Point(540.0, y), Scalar(130.0, 140.0, 160.0, 255.0), 2)
            }

            val detector = OpenCvDocumentDetector()
            val result = detector.detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on open notebook page", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            // Must stay on the right target page (x >= 0.25) rather than wrapping the whole left+right spread
            assertTrue("Expected target right page boundary, got topLeft.x=${quad.topLeft.x}", quad.topLeft.x >= 0.25f)
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectPageRightEdgeAccuratelyDespiteStackedLowerPagesAndCover() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(68.0, 56.0, 44.0, 255.0))
        try {
            // Dark cover peeking beyond the page edges (especially on the right margin)
            Imgproc.rectangle(scene, Point(96.0, 56.0), Point(552.0, 430.0), Scalar(32.0, 34.0, 40.0, 255.0), -1)

            // Lower stacked sheet protruding asymmetrically on the right side (x up to 494)
            Imgproc.rectangle(scene, Point(122.0, 76.0), Point(494.0, 410.0), Scalar(212.0, 210.0, 204.0, 255.0), -1)
            Imgproc.rectangle(scene, Point(122.0, 76.0), Point(494.0, 410.0), Scalar(135.0, 132.0, 128.0, 255.0), 2)

            // Top target page with crisp right edge at x = 472 (472 / 640 = 0.7375)
            val topPage = MatOfPoint(
                Point(116.0, 72.0),
                Point(472.0, 74.0),
                Point(470.0, 412.0),
                Point(114.0, 414.0),
            )
            Imgproc.fillPoly(scene, listOf(topPage), Scalar(244.0, 242.0, 238.0, 255.0))
            Imgproc.polylines(scene, listOf(topPage), true, Scalar(105.0, 105.0, 110.0, 255.0), 2)
            // Contact shadow along the right edge where top page meets lower protruding sheet
            Imgproc.line(scene, Point(474.0, 76.0), Point(472.0, 410.0), Scalar(92.0, 92.0, 96.0, 255.0), 3)
            topPage.release()

            // Ruled text lines inside target sheet
            for (row in 0 until 5) {
                val y = 128.0 + row * 48.0
                Imgproc.line(scene, Point(155.0, y), Point(430.0, y), Scalar(120.0, 130.0, 145.0, 255.0), 2)
            }

            val detector = OpenCvDocumentDetector()
            val result = detector.detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on top sheet", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue(
                "Expected right edge near top page (~0.737), not stacked sheet/cover; topRight.x=${quad.topRight.x}, bottomRight.x=${quad.bottomRight.x}",
                quad.topRight.x in 0.68f..0.78f && quad.bottomRight.x in 0.68f..0.78f,
            )
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectOpenNotebookLeftPageRightSpineEdgeAccurately() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(66.0, 54.0, 42.0, 255.0))
        try {
            // Notebook dark cover
            Imgproc.rectangle(scene, Point(48.0, 50.0), Point(596.0, 434.0), Scalar(30.0, 32.0, 38.0, 255.0), -1)

            // Opposite right page (neighbouring page on the right side of binding)
            val oppositeRightPage = MatOfPoint(
                Point(432.0, 74.0),
                Point(580.0, 70.0),
                Point(578.0, 416.0),
                Point(432.0, 412.0),
            )
            Imgproc.fillPoly(scene, listOf(oppositeRightPage), Scalar(232.0, 230.0, 224.0, 255.0))
            oppositeRightPage.release()

            // Target left page with slightly curved right spine boundary near x = 408 (408 / 640 = 0.6375)
            val leftPagePts = mutableListOf(
                Point(72.0, 68.0),
                Point(408.0, 76.0),
            )
            for (step in 1..6) {
                val t = step / 7.0
                val y = 76.0 + t * (412.0 - 76.0)
                val bowX = 408.0 - kotlin.math.sin(t * Math.PI) * 10.0
                leftPagePts.add(Point(bowX, y))
            }
            leftPagePts.add(Point(408.0, 412.0))
            leftPagePts.add(Point(72.0, 416.0))
            val leftPage = MatOfPoint(*leftPagePts.toTypedArray())
            Imgproc.fillPoly(scene, listOf(leftPage), Scalar(246.0, 244.0, 240.0, 255.0))
            leftPage.release()

            // Binding gutter shadow right of the left page
            Imgproc.rectangle(scene, Point(408.0, 72.0), Point(428.0, 416.0), Scalar(52.0, 50.0, 54.0, 255.0), -1)

            // Notes on target left page
            for (row in 0 until 6) {
                val y = 118.0 + row * 44.0
                Imgproc.line(scene, Point(110.0, y), Point(372.0, y), Scalar(125.0, 135.0, 150.0, 255.0), 2)
            }

            val detector = OpenCvDocumentDetector()
            val result = detector.detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on left notebook page", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue(
                "Expected right edge near centre spine (~0.637), not opposite page; topRight.x=${quad.topRight.x}, bottomRight.x=${quad.bottomRight.x}",
                quad.topRight.x in 0.56f..0.70f && quad.bottomRight.x in 0.56f..0.70f,
            )
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectTiltedTrapezoidPageWithDimmerRightEdgeLighting() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(62.0, 54.0, 48.0, 255.0))
        try {
            val page = MatOfPoint(
                Point(110.0, 80.0),
                Point(515.0, 108.0),
                Point(552.0, 405.0),
                Point(86.0, 392.0),
            )
            Imgproc.fillPoly(scene, listOf(page), Scalar(238.0, 236.0, 232.0, 255.0))

            // Simulate uneven directional shading dimming the right half of the page
            for (x in 0 until width) {
                val factor = if (x < 300) 1.0 else (1.0 - ((x - 300.0) / 340.0) * 0.28)
                if (factor < 1.0) {
                    val col = scene.col(x)
                    org.opencv.core.Core.multiply(col, Scalar(factor, factor, factor, 1.0), col)
                    col.release()
                }
            }
            page.release()

            val detector = OpenCvDocumentDetector()
            val result = detector.detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected tilted quad with shaded right edge", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            // Exact vertices: topRight.x = 515/640 = 0.805, bottomRight.x = 552/640 = 0.863
            assertTrue(
                "Expected accurate shaded right corners; topRight.x=${quad.topRight.x}, bottomRight.x=${quad.bottomRight.x}",
                quad.topRight.x in 0.74f..0.86f && quad.bottomRight.x in 0.80f..0.92f,
            )
        } finally {
            scene.release()
        }
    }
}
