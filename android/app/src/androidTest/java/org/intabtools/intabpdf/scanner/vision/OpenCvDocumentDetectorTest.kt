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

    @Test
    fun detectOpenBookLeftPageWithLeftStaircaseUnderlyingSheets() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(64.0, 52.0, 42.0, 255.0))
        try {
            // Notebook cover framing the open book (extending near right frame edge)
            Imgproc.rectangle(scene, Point(44.0, 50.0), Point(628.0, 434.0), Scalar(30.0, 32.0, 38.0, 255.0), -1)

            // Partially visible opposite right page beyond the centre binding gutter
            val rightPage = MatOfPoint(Point(476.0, 72.0), Point(618.0, 70.0), Point(618.0, 412.0), Point(476.0, 410.0))
            Imgproc.fillPoly(scene, listOf(rightPage), Scalar(230.0, 228.0, 224.0, 255.0))
            rightPage.release()

            // Staircase of 3 exposed underlying sheets protruding left of target x = 132
            for ((idx, leftX) in listOf(102.0, 112.0, 122.0).withIndex()) {
                val shade = 198.0 + idx * 16.0
                val sheet = MatOfPoint(
                    Point(leftX, 70.0),
                    Point(454.0, 72.0),
                    Point(454.0, 410.0),
                    Point(leftX, 412.0),
                )
                Imgproc.fillPoly(scene, listOf(sheet), Scalar(shade, shade - 2.0, shade - 4.0, 255.0))
                Imgproc.line(scene, Point(leftX + 1.0, 71.0), Point(leftX + 1.0, 411.0), Scalar(88.0, 88.0, 92.0, 255.0), 2)
                sheet.release()
            }

            // Topmost target left page: left = 132 (0.206), right spine = 454 (0.709)
            val topPage = MatOfPoint(Point(132.0, 70.0), Point(454.0, 72.0), Point(454.0, 410.0), Point(132.0, 412.0))
            Imgproc.fillPoly(scene, listOf(topPage), Scalar(246.0, 244.0, 240.0, 255.0))
            Imgproc.line(scene, Point(130.0, 71.0), Point(130.0, 411.0), Scalar(92.0, 92.0, 96.0, 255.0), 2)
            topPage.release()

            // Centre binding gutter shadow + ruled notes on target page
            Imgproc.rectangle(scene, Point(454.0, 70.0), Point(474.0, 412.0), Scalar(44.0, 44.0, 48.0, 255.0), -1)
            for (row in 0 until 5) {
                val y = 120.0 + row * 48.0
                Imgproc.line(scene, Point(165.0, y), Point(422.0, y), Scalar(120.0, 130.0, 145.0, 255.0), 2)
            }

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on open book left page", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue(
                "Expected left edge near topmost page (~0.206), not outer stack (~0.159); TL.x=${quad.topLeft.x}, BL.x=${quad.bottomLeft.x}",
                quad.topLeft.x in 0.185f..0.24f && quad.bottomLeft.x in 0.185f..0.24f,
            )
            assertTrue(
                "Expected centre binding preserved (~0.709); TR.x=${quad.topRight.x}, BR.x=${quad.bottomRight.x}",
                quad.topRight.x in 0.67f..0.745f && quad.bottomRight.x in 0.67f..0.745f,
            )
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectOpenBookRightPageWithRightStaircaseUnderlyingSheets() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(64.0, 52.0, 42.0, 255.0))
        try {
            // Notebook cover framing the open book (extending near left frame edge)
            Imgproc.rectangle(scene, Point(12.0, 50.0), Point(596.0, 434.0), Scalar(30.0, 32.0, 38.0, 255.0), -1)

            // Partially visible opposite left page beyond the centre binding gutter
            val leftPage = MatOfPoint(Point(22.0, 72.0), Point(164.0, 74.0), Point(164.0, 410.0), Point(22.0, 412.0))
            Imgproc.fillPoly(scene, listOf(leftPage), Scalar(230.0, 228.0, 224.0, 255.0))
            leftPage.release()

            // Staircase of 3 exposed underlying sheets protruding right of target x = 506
            for ((idx, rightX) in listOf(538.0, 528.0, 518.0).withIndex()) {
                val shade = 198.0 + idx * 16.0
                val sheet = MatOfPoint(
                    Point(188.0, 72.0),
                    Point(rightX, 70.0),
                    Point(rightX, 412.0),
                    Point(188.0, 410.0),
                )
                Imgproc.fillPoly(scene, listOf(sheet), Scalar(shade, shade - 2.0, shade - 4.0, 255.0))
                Imgproc.line(scene, Point(rightX - 1.0, 71.0), Point(rightX - 1.0, 411.0), Scalar(88.0, 88.0, 92.0, 255.0), 2)
                sheet.release()
            }

            // Topmost target right page: left spine = 188 (0.294), right = 508 (0.794)
            val topPage = MatOfPoint(Point(188.0, 72.0), Point(508.0, 70.0), Point(508.0, 412.0), Point(188.0, 410.0))
            Imgproc.fillPoly(scene, listOf(topPage), Scalar(246.0, 244.0, 240.0, 255.0))
            Imgproc.line(scene, Point(510.0, 71.0), Point(510.0, 411.0), Scalar(92.0, 92.0, 96.0, 255.0), 2)
            topPage.release()

            // Centre binding gutter shadow + ruled notes on target page
            Imgproc.rectangle(scene, Point(166.0, 70.0), Point(188.0, 412.0), Scalar(44.0, 44.0, 48.0, 255.0), -1)
            for (row in 0 until 5) {
                val y = 120.0 + row * 48.0
                Imgproc.line(scene, Point(220.0, y), Point(474.0, y), Scalar(120.0, 130.0, 145.0, 255.0), 2)
            }

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on open book right page", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue(
                "Expected right edge near topmost page (~0.794), not outer stack (~0.841); TR.x=${quad.topRight.x}, BR.x=${quad.bottomRight.x}",
                quad.topRight.x in 0.76f..0.818f && quad.bottomRight.x in 0.76f..0.818f,
            )
            assertTrue(
                "Expected centre binding preserved (~0.294); TL.x=${quad.topLeft.x}, BL.x=${quad.bottomLeft.x}",
                quad.topLeft.x in 0.26f..0.33f && quad.bottomLeft.x in 0.26f..0.33f,
            )
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectOpenBookWithStaircaseSheetsOnBothLeftAndRightSides() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(58.0, 48.0, 40.0, 255.0))
        try {
            // Dark book cover
            Imgproc.rectangle(scene, Point(84.0, 50.0), Point(556.0, 434.0), Scalar(28.0, 30.0, 36.0, 255.0), -1)

            // 3 underlying staircase sheets exposed on BOTH left (118..146) and right (494..522)
            for (idx in 0 until 3) {
                val leftX = 118.0 + idx * 10.0
                val rightX = 522.0 - idx * 10.0
                val shade = 196.0 + idx * 17.0
                val sheet = MatOfPoint(
                    Point(leftX, 72.0),
                    Point(rightX, 72.0),
                    Point(rightX, 408.0),
                    Point(leftX, 408.0),
                )
                Imgproc.fillPoly(scene, listOf(sheet), Scalar(shade, shade - 2.0, shade - 4.0, 255.0))
                Imgproc.line(scene, Point(leftX + 1.0, 73.0), Point(leftX + 1.0, 407.0), Scalar(88.0, 88.0, 92.0, 255.0), 2)
                Imgproc.line(scene, Point(rightX - 1.0, 73.0), Point(rightX - 1.0, 407.0), Scalar(88.0, 88.0, 92.0, 255.0), 2)
                sheet.release()
            }

            // Topmost target page: x = 154..486 (0.241 .. 0.759)
            val topPage = MatOfPoint(Point(154.0, 72.0), Point(486.0, 72.0), Point(486.0, 408.0), Point(154.0, 408.0))
            Imgproc.fillPoly(scene, listOf(topPage), Scalar(246.0, 244.0, 240.0, 255.0))
            Imgproc.line(scene, Point(152.0, 73.0), Point(152.0, 407.0), Scalar(90.0, 90.0, 94.0, 255.0), 2)
            Imgproc.line(scene, Point(488.0, 73.0), Point(488.0, 407.0), Scalar(90.0, 90.0, 94.0, 255.0), 2)
            topPage.release()

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on open book with staircase on both sides", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue(
                "Expected left edge on topmost page (~0.241), not outer (~0.184); TL.x=${quad.topLeft.x}, BL.x=${quad.bottomLeft.x}",
                quad.topLeft.x in 0.21f..0.275f && quad.bottomLeft.x in 0.21f..0.275f,
            )
            assertTrue(
                "Expected right edge on topmost page (~0.759), not outer (~0.816); TR.x=${quad.topRight.x}, BR.x=${quad.bottomRight.x}",
                quad.topRight.x in 0.725f..0.79f && quad.bottomRight.x in 0.725f..0.79f,
            )
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectTiltedOpenBookPageWithStaircaseAndUnevenLighting() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(58.0, 50.0, 44.0, 255.0))
        try {
            // Dark tilted book cover
            val cover = MatOfPoint(Point(16.0, 62.0), Point(558.0, 88.0), Point(588.0, 424.0), Point(16.0, 404.0))
            Imgproc.fillPoly(scene, listOf(cover), Scalar(28.0, 30.0, 36.0, 255.0))
            cover.release()

            // Opposite tilted left page partially visible beyond spine gutter
            val oppLeft = MatOfPoint(Point(22.0, 80.0), Point(146.0, 90.0), Point(130.0, 384.0), Point(22.0, 374.0))
            Imgproc.fillPoly(scene, listOf(oppLeft), Scalar(228.0, 226.0, 222.0, 255.0))
            oppLeft.release()

            // Tilted underlying staircase sheets on the right (+28, +18, +8 px)
            for ((idx, shift) in listOf(28.0, 18.0, 8.0).withIndex()) {
                val shade = 198.0 + idx * 16.0
                val sheet = MatOfPoint(
                    Point(168.0, 90.0),
                    Point(476.0 + shift, 114.0),
                    Point(516.0 + shift, 396.0),
                    Point(150.0, 382.0),
                )
                Imgproc.fillPoly(scene, listOf(sheet), Scalar(shade, shade - 2.0, shade - 4.0, 255.0))
                Imgproc.line(scene, Point(475.0 + shift, 115.0), Point(515.0 + shift, 395.0), Scalar(90.0, 90.0, 94.0, 255.0), 2)
                sheet.release()
            }

            // Tilted trapezoidal topmost target page: TL(168,90)..TR(476,114)=0.744, BR(516,396)=0.806
            val targetPage = MatOfPoint(
                Point(168.0, 90.0),
                Point(476.0, 114.0),
                Point(516.0, 396.0),
                Point(150.0, 382.0),
            )
            Imgproc.fillPoly(scene, listOf(targetPage), Scalar(246.0, 244.0, 240.0, 255.0))
            Imgproc.line(scene, Point(478.0, 115.0), Point(518.0, 395.0), Scalar(92.0, 92.0, 96.0, 255.0), 2)
            targetPage.release()

            // Dark binding gutter between oppLeft and targetPage
            val gutter = MatOfPoint(Point(148.0, 88.0), Point(168.0, 90.0), Point(150.0, 382.0), Point(130.0, 384.0))
            Imgproc.fillPoly(scene, listOf(gutter), Scalar(44.0, 44.0, 48.0, 255.0))
            gutter.release()

            // Uneven lighting shading across the frame
            for (x in 0 until width) {
                val factor = if (x < 260) 1.0 else (1.0 - ((x - 260.0) / 380.0) * 0.24)
                if (factor < 1.0) {
                    val col = scene.col(x)
                    org.opencv.core.Core.multiply(col, Scalar(factor, factor, factor, 1.0), col)
                    col.release()
                }
            }

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid tilted open-book quad", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected trapezoidal foreshortening (top < bottom)", quad.topLeft.distanceTo(quad.topRight) < quad.bottomLeft.distanceTo(quad.bottomRight))
            assertTrue(
                "Expected tilted right edge on topmost page (~0.744 / ~0.806), not outer staircase (~0.788 / ~0.850); TR.x=${quad.topRight.x}, BR.x=${quad.bottomRight.x}",
                quad.topRight.x in 0.70f..0.775f && quad.bottomRight.x in 0.76f..0.832f,
            )
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectOpenBookCentreBindingAndTopBottomEdgesPreserved() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(64.0, 52.0, 42.0, 255.0))
        try {
            // Dark cover
            Imgproc.rectangle(scene, Point(12.0, 50.0), Point(588.0, 434.0), Scalar(30.0, 32.0, 38.0, 255.0), -1)

            // Partially visible opposite left page
            val leftPage = MatOfPoint(Point(22.0, 74.0), Point(164.0, 74.0), Point(164.0, 408.0), Point(22.0, 408.0))
            Imgproc.fillPoly(scene, listOf(leftPage), Scalar(230.0, 228.0, 224.0, 255.0))
            leftPage.release()

            // Right underlying staircase sheets protruding slightly beyond x = 504
            for ((idx, rightX) in listOf(530.0, 517.0).withIndex()) {
                val shade = 202.0 + idx * 18.0
                val sheet = MatOfPoint(Point(188.0, 74.0), Point(rightX, 74.0), Point(rightX, 408.0), Point(188.0, 408.0))
                Imgproc.fillPoly(scene, listOf(sheet), Scalar(shade, shade - 2.0, shade - 4.0, 255.0))
                Imgproc.line(scene, Point(rightX - 1.0, 75.0), Point(rightX - 1.0, 407.0), Scalar(90.0, 90.0, 94.0, 255.0), 2)
                sheet.release()
            }

            // Target right page: topY = 74 (0.154), bottomY = 408 (0.850), left spine = 188 (0.294), right = 504 (0.7875)
            val targetRight = MatOfPoint(Point(188.0, 74.0), Point(504.0, 74.0), Point(504.0, 408.0), Point(188.0, 408.0))
            Imgproc.fillPoly(scene, listOf(targetRight), Scalar(246.0, 244.0, 240.0, 255.0))
            Imgproc.line(scene, Point(506.0, 75.0), Point(506.0, 407.0), Scalar(92.0, 92.0, 96.0, 255.0), 2)
            targetRight.release()

            // Binding gutter shadow
            Imgproc.rectangle(scene, Point(166.0, 72.0), Point(188.0, 410.0), Scalar(44.0, 44.0, 48.0, 255.0), -1)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad", quad)
            quad!!
            // Exact top/bottom preservation + centre binding preserved
            assertTrue("Top edge preserved (~0.154): TL.y=${quad.topLeft.y}, TR.y=${quad.topRight.y}", quad.topLeft.y in 0.125f..0.185f && quad.topRight.y in 0.125f..0.185f)
            assertTrue("Bottom edge preserved (~0.850): BL.y=${quad.bottomLeft.y}, BR.y=${quad.bottomRight.y}", quad.bottomLeft.y in 0.82f..0.88f && quad.bottomRight.y in 0.82f..0.88f)
            assertTrue("Centre binding preserved (~0.294): TL.x=${quad.topLeft.x}, BL.x=${quad.bottomLeft.x}", quad.topLeft.x in 0.26f..0.33f && quad.bottomLeft.x in 0.26f..0.33f)
            assertTrue("Right edge accurate (~0.788): TR.x=${quad.topRight.x}, BR.x=${quad.bottomRight.x}", quad.topRight.x in 0.755f..0.812f && quad.bottomRight.x in 0.755f..0.812f)
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectModeratelyDimNoisyDocumentOverWoodDesk() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(28.0, 22.0, 18.0, 255.0))
        try {
            val poly = MatOfPoint(
                Point(110.0, 68.0),
                Point(515.0, 82.0),
                Point(530.0, 412.0),
                Point(98.0, 400.0),
            )
            Imgproc.fillPoly(scene, listOf(poly), Scalar(88.0, 86.0, 82.0, 255.0))
            poly.release()
            addSensorNoise(scene, sigma = 6.5, seed = 101)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad in moderately dim noisy scene", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected topLeft near (0.17, 0.14), got ${quad.topLeft}", quad.topLeft.x in 0.12f..0.23f && quad.topLeft.y in 0.09f..0.20f)
            assertTrue("Expected bottomRight near (0.83, 0.86), got ${quad.bottomRight}", quad.bottomRight.x in 0.78f..0.88f && quad.bottomRight.y in 0.80f..0.91f)
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectUnevenlyLitDocumentAcrossDiagonalLightingGradient() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(58.0, 48.0, 40.0, 255.0))
        try {
            val poly = MatOfPoint(
                Point(115.0, 72.0),
                Point(520.0, 78.0),
                Point(532.0, 412.0),
                Point(104.0, 404.0),
            )
            Imgproc.fillPoly(scene, listOf(poly), Scalar(236.0, 234.0, 228.0, 255.0))
            poly.release()

            // Strong diagonal illumination falloff (top-left 1.0x -> bottom-right 0.30x)
            val buf = ByteArray(width * height * 4)
            scene.get(0, 0, buf)
            for (y in 0 until height) {
                for (x in 0 until width) {
                    val u = (x.toDouble() / width + y.toDouble() / height) * 0.5
                    val factor = (1.0 - 0.70 * u).coerceIn(0.28, 1.0)
                    val idx = (y * width + x) * 4
                    buf[idx] = ((buf[idx].toInt() and 0xFF) * factor).toInt().coerceIn(0, 255).toByte()
                    buf[idx + 1] = ((buf[idx + 1].toInt() and 0xFF) * factor).toInt().coerceIn(0, 255).toByte()
                    buf[idx + 2] = ((buf[idx + 2].toInt() and 0xFF) * factor).toInt().coerceIn(0, 255).toByte()
                }
            }
            scene.put(0, 0, buf)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad under steep uneven illumination", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected full page area (> 0.38) instead of only lit corner, got ${result.areaFraction}", result.areaFraction > 0.38f)
            assertTrue("Expected shaded bottomRight near (0.83, 0.86), got ${quad.bottomRight}", quad.bottomRight.x in 0.77f..0.89f && quad.bottomRight.y in 0.79f..0.91f)
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectDocumentDespiteHardCastShadowAcrossPageBoundary() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(64.0, 52.0, 42.0, 255.0))
        try {
            val poly = MatOfPoint(
                Point(110.0, 68.0),
                Point(524.0, 74.0),
                Point(530.0, 412.0),
                Point(102.0, 404.0),
            )
            Imgproc.fillPoly(scene, listOf(poly), Scalar(238.0, 236.0, 230.0, 255.0))
            poly.release()

            // Cast shadow cutting diagonally across middle of page + right edge + desk
            val buf = ByteArray(width * height * 4)
            scene.get(0, 0, buf)
            for (y in 0 until height) {
                for (x in 0 until width) {
                    val shadowPos = (x - 160.0) * 0.65 + (y - 90.0) * 0.45
                    val factor = when {
                        shadowPos < 145.0 -> 1.0
                        shadowPos < 175.0 -> 1.0 - ((shadowPos - 145.0) / 30.0) * 0.56
                        else -> 0.44
                    }
                    val idx = (y * width + x) * 4
                    buf[idx] = ((buf[idx].toInt() and 0xFF) * factor).toInt().coerceIn(0, 255).toByte()
                    buf[idx + 1] = ((buf[idx + 1].toInt() and 0xFF) * factor).toInt().coerceIn(0, 255).toByte()
                    buf[idx + 2] = ((buf[idx + 2].toInt() and 0xFF) * factor).toInt().coerceIn(0, 255).toByte()
                }
            }
            scene.put(0, 0, buf)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad across cast shadow", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected whole page (> 0.38), not bisected at shadow; area=${result.areaFraction}", result.areaFraction > 0.38f)
            assertTrue("Expected shadowed bottomRight preserved (~0.83, ~0.86), got ${quad.bottomRight}", quad.bottomRight.x in 0.76f..0.89f && quad.bottomRight.y in 0.78f..0.91f)
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectLowContrastPaperUnderDimLighting() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        // Dim beige table (52, 46, 40) vs dim off-white paper (86, 83, 78) -> ΔI ≈ 34
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(52.0, 46.0, 40.0, 255.0))
        try {
            val poly = MatOfPoint(
                Point(118.0, 74.0),
                Point(512.0, 86.0),
                Point(524.0, 408.0),
                Point(108.0, 396.0),
            )
            Imgproc.fillPoly(scene, listOf(poly), Scalar(86.0, 83.0, 78.0, 255.0))
            poly.release()
            addSensorNoise(scene, sigma = 3.5, seed = 202)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on dim low-contrast paper", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected area near true sheet (> 0.34), got ${result.areaFraction}", result.areaFraction > 0.34f)
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectTextHeavyDocumentUnderDimLighting() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(26.0, 22.0, 18.0, 255.0))
        try {
            val poly = MatOfPoint(
                Point(116.0, 62.0),
                Point(524.0, 68.0),
                Point(530.0, 418.0),
                Point(110.0, 412.0),
            )
            Imgproc.fillPoly(scene, listOf(poly), Scalar(92.0, 90.0, 86.0, 255.0))
            poly.release()

            // Dense dark text header + paragraphs + table box inside dim sheet
            Imgproc.rectangle(scene, Point(150.0, 96.0), Point(490.0, 126.0), Scalar(24.0, 24.0, 28.0, 255.0), -1)
            for (row in 0 until 10) {
                val y = 148.0 + row * 24.0
                Imgproc.line(scene, Point(152.0, y), Point(320.0, y), Scalar(28.0, 28.0, 32.0, 255.0), 3)
                Imgproc.line(scene, Point(342.0, y), Point(492.0, y), Scalar(30.0, 30.0, 34.0, 255.0), 3)
            }
            Imgproc.rectangle(scene, Point(150.0, 240.0), Point(492.0, 376.0), Scalar(32.0, 32.0, 36.0, 255.0), 2)
            addSensorNoise(scene, sigma = 4.5, seed = 303)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on dim text-heavy page", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected outer paper boundary (> 0.36) rather than inner text box, got ${result.areaFraction}", result.areaFraction > 0.36f)
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectTiltedTrapezoidalPageUnderDimLighting() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(28.0, 23.0, 19.0, 255.0))
        try {
            val trapezoid = MatOfPoint(
                Point(210.0, 102.0),
                Point(440.0, 118.0),
                Point(546.0, 392.0),
                Point(88.0, 366.0),
            )
            Imgproc.fillPoly(scene, listOf(trapezoid), Scalar(88.0, 86.0, 82.0, 255.0))
            trapezoid.release()
            for (row in 0 until 5) {
                val y = 166.0 + row * 36.0
                Imgproc.line(scene, Point(190.0, y), Point(445.0, y + 6.0), Scalar(28.0, 28.0, 30.0, 255.0), 3)
            }
            addSensorNoise(scene, sigma = 4.5, seed = 404)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected tilted trapezoidal quad in dim lighting", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected foreshortened top edge < bottom edge", quad.topLeft.distanceTo(quad.topRight) < quad.bottomLeft.distanceTo(quad.bottomRight))
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectOpenNotebookWithUnderlyingPagesUnderDimLighting() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(26.0, 22.0, 18.0, 255.0))
        try {
            // Dark book cover
            Imgproc.rectangle(scene, Point(12.0, 50.0), Point(588.0, 434.0), Scalar(14.0, 15.0, 18.0, 255.0), -1)

            // Opposite left page
            val leftPage = MatOfPoint(Point(22.0, 74.0), Point(164.0, 74.0), Point(164.0, 408.0), Point(22.0, 408.0))
            Imgproc.fillPoly(scene, listOf(leftPage), Scalar(78.0, 77.0, 75.0, 255.0))
            leftPage.release()

            // Underlying right staircase sheets
            for ((idx, rightX) in listOf(532.0, 518.0).withIndex()) {
                val shade = 70.0 + idx * 7.0
                val sheet = MatOfPoint(Point(188.0, 74.0), Point(rightX, 74.0), Point(rightX, 408.0), Point(188.0, 408.0))
                Imgproc.fillPoly(scene, listOf(sheet), Scalar(shade, shade - 1.0, shade - 2.0, 255.0))
                Imgproc.line(scene, Point(rightX - 1.0, 75.0), Point(rightX - 1.0, 407.0), Scalar(34.0, 34.0, 36.0, 255.0), 2)
                sheet.release()
            }

            // Target right page: spine x = 188 (0.294), right edge x = 504 (0.788)
            val targetRight = MatOfPoint(Point(188.0, 74.0), Point(504.0, 74.0), Point(504.0, 408.0), Point(188.0, 408.0))
            Imgproc.fillPoly(scene, listOf(targetRight), Scalar(94.0, 92.0, 90.0, 255.0))
            Imgproc.line(scene, Point(506.0, 75.0), Point(506.0, 407.0), Scalar(36.0, 36.0, 38.0, 255.0), 2)
            targetRight.release()

            // Spine gutter + dim ruled notes
            Imgproc.rectangle(scene, Point(166.0, 72.0), Point(188.0, 410.0), Scalar(20.0, 20.0, 22.0, 255.0), -1)
            for (row in 0 until 5) {
                val y = 122.0 + row * 48.0
                Imgproc.line(scene, Point(220.0, y), Point(470.0, y), Scalar(44.0, 46.0, 52.0, 255.0), 2)
            }
            addSensorNoise(scene, sigma = 3.5, seed = 505)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on dim open notebook", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Centre binding preserved (~0.294): TL.x=${quad.topLeft.x}, BL.x=${quad.bottomLeft.x}", quad.topLeft.x in 0.25f..0.34f && quad.bottomLeft.x in 0.25f..0.34f)
            assertTrue("Right staircase trimmed (~0.788): TR.x=${quad.topRight.x}, BR.x=${quad.bottomRight.x}", quad.topRight.x in 0.745f..0.822f && quad.bottomRight.x in 0.745f..0.822f)
        } finally {
            scene.release()
        }
    }

    @Test
    fun rejectsBlankDarkEmptyFrameWithoutFalseDocumentLock() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(24.0, 24.0, 24.0, 255.0))
        try {
            addSensorNoise(scene, sigma = 6.0, seed = 606)
            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            assertTrue(
                "Noisy flat dark frame must not exceed lock threshold (< 0.45), got confidence=${result.confidence}",
                result.normalizedQuad == null || result.confidence < 0.45f,
            )
        } finally {
            scene.release()
        }
    }

    @Test
    fun benchmarkLivePreviewDetectionThroughputNormalVsDimLight() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val detector = OpenCvDocumentDetector()
        val normal = Mat(480, 640, CvType.CV_8UC4, Scalar(64.0, 52.0, 42.0, 255.0))
        val dim = Mat(480, 640, CvType.CV_8UC4, Scalar(28.0, 23.0, 19.0, 255.0))
        try {
            val poly = MatOfPoint(Point(110.0, 68.0), Point(520.0, 82.0), Point(530.0, 412.0), Point(98.0, 400.0))
            Imgproc.fillPoly(normal, listOf(poly), Scalar(242.0, 240.0, 236.0, 255.0))
            Imgproc.fillPoly(dim, listOf(poly), Scalar(88.0, 86.0, 82.0, 255.0))
            poly.release()
            addSensorNoise(dim, sigma = 5.0, seed = 707)

            // Warmup
            repeat(2) {
                detector.detect(normal, DetectionMode.LIVE_PREVIEW)
                detector.detect(dim, DetectionMode.LIVE_PREVIEW)
            }

            val iterations = 15
            var normalTotalMs = 0L
            repeat(iterations) {
                normalTotalMs += detector.detect(normal, DetectionMode.LIVE_PREVIEW).inferenceTimeMs
            }
            var dimTotalMs = 0L
            repeat(iterations) {
                dimTotalMs += detector.detect(dim, DetectionMode.LIVE_PREVIEW).inferenceTimeMs
            }

            val normalAvgMs = normalTotalMs.toDouble() / iterations
            val dimAvgMs = dimTotalMs.toDouble() / iterations
            val normalFps = if (normalAvgMs > 0.0) 1000.0 / normalAvgMs else 999.0
            val dimFps = if (dimAvgMs > 0.0) 1000.0 / dimAvgMs else 999.0
            android.util.Log.i(
                "ScannerPerf",
                "LIVE_PREVIEW normalAvg=${"%.1f".format(normalAvgMs)}ms (${"%.1f".format(normalFps)} FPS) dimAvg=${"%.1f".format(dimAvgMs)}ms (${"%.1f".format(dimFps)} FPS)",
            )
            assertTrue("Expected normal-light detection under 120ms/frame, got ${normalAvgMs}ms", normalAvgMs < 120.0)
            assertTrue("Expected dim-light detection under 150ms/frame, got ${dimAvgMs}ms", dimAvgMs < 150.0)
        } finally {
            normal.release()
            dim.release()
        }
    }

    @Test
    fun detectNormalIndoorExposureDocumentWithThinTextAndWoodGrain() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        val scene = Mat(height, width, CvType.CV_8UC4)
        try {
            for (y in 0 until height) {
                val row = ByteArray(width * 4)
                for (x in 0 until width) {
                    val grain = (kotlin.math.sin(y * 0.22 + kotlin.math.sin(x * 0.06) * 2.0) * 10.0).toInt()
                    row[x * 4] = (108 + grain).coerceIn(0, 255).toByte()
                    row[x * 4 + 1] = (92 + grain).coerceIn(0, 255).toByte()
                    row[x * 4 + 2] = (74 + grain).coerceIn(0, 255).toByte()
                    row[x * 4 + 3] = 255.toByte()
                }
                scene.put(y, 0, row)
            }

            // Typical mobile camera AE exposure in indoor light (paper ~156 -> p90 < 165, span90 < 105)
            val poly = MatOfPoint(
                Point(110.0, 66.0),
                Point(518.0, 78.0),
                Point(532.0, 408.0),
                Point(96.0, 396.0),
            )
            Imgproc.fillPoly(scene, listOf(poly), Scalar(156.0, 154.0, 150.0, 255.0))
            poly.release()

            for (rowIdx in 0 until 9) {
                val y = 112.0 + rowIdx * 28.0
                Imgproc.line(scene, Point(145.0, y), Point(482.0, y), Scalar(52.0, 52.0, 56.0, 255.0), 1)
            }
            Imgproc.GaussianBlur(scene, scene, org.opencv.core.Size(3.0, 3.0), 0.7)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad in normal indoor AE exposure", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected full page area > 0.36, got ${result.areaFraction}", result.areaFraction > 0.36f)
            assertTrue(
                "Expected accurate corners near (0.17,0.14)..(0.83,0.85), got TL=${quad.topLeft}, BR=${quad.bottomRight}",
                quad.topLeft.x in 0.13f..0.22f && quad.topLeft.y in 0.10f..0.19f &&
                    quad.bottomRight.x in 0.78f..0.88f && quad.bottomRight.y in 0.80f..0.90f,
            )
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectNormalLightingDocumentOnMediumDeskWithSmallPercentileSpan() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        // Medium desk (132, 126, 118) vs paper (196, 194, 190): bright scene with span90 < 105
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(132.0, 126.0, 118.0, 255.0))
        try {
            val poly = MatOfPoint(
                Point(118.0, 72.0),
                Point(512.0, 86.0),
                Point(524.0, 408.0),
                Point(108.0, 396.0),
            )
            Imgproc.fillPoly(scene, listOf(poly), Scalar(196.0, 194.0, 190.0, 255.0))
            poly.release()
            for (rowIdx in 0 until 7) {
                val y = 122.0 + rowIdx * 34.0
                Imgproc.line(scene, Point(155.0, y), Point(470.0, y), Scalar(78.0, 78.0, 82.0, 255.0), 2)
            }
            Imgproc.GaussianBlur(scene, scene, org.opencv.core.Size(3.0, 3.0), 0.7)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on medium-contrast normal desk", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected area > 0.34, got ${result.areaFraction}", result.areaFraction > 0.34f)
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectIndoorOpenNotebookWithMediumDeskAndModeratePaperContrast() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        // Normal indoor desk where paper=152 vs desk=104 (p90 < 165 and span90 < 105)
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(104.0, 96.0, 86.0, 255.0))
        try {
            // Cover & opposite left page
            Imgproc.rectangle(scene, Point(12.0, 50.0), Point(588.0, 434.0), Scalar(48.0, 50.0, 56.0, 255.0), -1)
            val oppLeft = MatOfPoint(Point(22.0, 74.0), Point(164.0, 74.0), Point(164.0, 408.0), Point(22.0, 408.0))
            Imgproc.fillPoly(scene, listOf(oppLeft), Scalar(144.0, 142.0, 138.0, 255.0))
            oppLeft.release()

            // Target right page with softer spine & subtle ruled lines
            val targetRight = MatOfPoint(Point(188.0, 74.0), Point(504.0, 74.0), Point(504.0, 408.0), Point(188.0, 408.0))
            Imgproc.fillPoly(scene, listOf(targetRight), Scalar(156.0, 154.0, 150.0, 255.0))
            targetRight.release()

            // Binding gutter + ruled text lines
            Imgproc.rectangle(scene, Point(166.0, 72.0), Point(188.0, 410.0), Scalar(64.0, 64.0, 68.0, 255.0), -1)
            for (rowIdx in 0 until 6) {
                val y = 118.0 + rowIdx * 42.0
                Imgproc.line(scene, Point(216.0, y), Point(474.0, y), Scalar(84.0, 88.0, 96.0, 255.0), 2)
            }
            Imgproc.GaussianBlur(scene, scene, org.opencv.core.Size(3.0, 3.0), 0.7)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on indoor open notebook", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected right page boundary preserved (~0.294..0.788), got TL.x=${quad.topLeft.x}, TR.x=${quad.topRight.x}", quad.topLeft.x in 0.25f..0.34f && quad.topRight.x in 0.74f..0.83f)
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectMediumDimLowContrastShadowedPageWithoutRawFloorOverPenalty() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        // Realistic dim indoor beige table (66, 62, 56) vs paper (102, 100, 96), with shading on right half
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(66.0, 62.0, 56.0, 255.0))
        try {
            val poly = MatOfPoint(
                Point(110.0, 70.0),
                Point(515.0, 82.0),
                Point(530.0, 408.0),
                Point(96.0, 396.0),
            )
            Imgproc.fillPoly(scene, listOf(poly), Scalar(102.0, 100.0, 96.0, 255.0))
            poly.release()

            val buf = ByteArray(width * height * 4)
            scene.get(0, 0, buf)
            for (y in 0 until height) {
                for (x in 0 until width) {
                    val factor = if (x < 280) 1.0 else (1.0 - ((x - 280.0) / 360.0) * 0.22)
                    val idx = (y * width + x) * 4
                    buf[idx] = ((buf[idx].toInt() and 0xFF) * factor).toInt().coerceIn(0, 255).toByte()
                    buf[idx + 1] = ((buf[idx + 1].toInt() and 0xFF) * factor).toInt().coerceIn(0, 255).toByte()
                    buf[idx + 2] = ((buf[idx + 2].toInt() and 0xFF) * factor).toInt().coerceIn(0, 255).toByte()
                }
            }
            scene.put(0, 0, buf)
            addSensorNoise(scene, sigma = 3.0, seed = 808)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on dim low-contrast shaded page (conf=${result.confidence})", quad)
            assertTrue("Expected confidence >= 0.45 on dim low-contrast shaded page, got ${result.confidence}", result.confidence >= 0.45f)
            assertTrue("Expected full page area > 0.34, got ${result.areaFraction}", result.areaFraction > 0.34f)
        } finally {
            scene.release()
        }
    }

    @Test
    fun detectDocumentWithSoftOpticalEdgeAndDarkPageBorderWithoutInwardShrink() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val width = 640
        val height = 480
        // Light desk (138, 128, 114) + slightly soft page edge + inner margin border frame
        val scene = Mat(height, width, CvType.CV_8UC4, Scalar(138.0, 128.0, 114.0, 255.0))
        try {
            val poly = MatOfPoint(
                Point(110.0, 68.0),
                Point(530.0, 74.0),
                Point(536.0, 412.0),
                Point(104.0, 406.0),
            )
            Imgproc.fillPoly(scene, listOf(poly), Scalar(226.0, 224.0, 220.0, 255.0))
            poly.release()
            // Subtle darker margin shading + inner table border ~22px inside left/right edges
            Imgproc.rectangle(scene, Point(136.0, 96.0), Point(504.0, 384.0), Scalar(90.0, 92.0, 96.0, 255.0), 2)
            Imgproc.GaussianBlur(scene, scene, org.opencv.core.Size(5.0, 5.0), 1.4)

            val result = OpenCvDocumentDetector().detect(scene, DetectionMode.LIVE_PREVIEW)
            val quad = result.normalizedQuad
            assertNotNull("Expected valid quad on bordered document with soft edge", quad)
            quad!!
            assertTrue("Expected confidence >= 0.45, got ${result.confidence}", result.confidence >= 0.45f)
            // True outer page edges are 0.172 (110/640) and 0.828 (530/640); must not shrink to inner border (0.212..0.788)
            assertTrue(
                "Expected outer page edges (~0.172..0.828), not inner margin frame; TL.x=${quad.topLeft.x}, TR.x=${quad.topRight.x}",
                quad.topLeft.x in 0.14f..0.195f && quad.topRight.x in 0.80f..0.86f,
            )
        } finally {
            scene.release()
        }
    }

    private fun addSensorNoise(rgbaMat: Mat, sigma: Double, seed: Int) {
        val w = rgbaMat.cols()
        val h = rgbaMat.rows()
        val buf = ByteArray(w * h * 4)
        rgbaMat.get(0, 0, buf)
        val rng = java.util.Random(seed.toLong())
        for (i in 0 until w * h) {
            val n = (rng.nextGaussian() * sigma).toInt()
            val idx = i * 4
            buf[idx] = ((buf[idx].toInt() and 0xFF) + n).coerceIn(0, 255).toByte()
            buf[idx + 1] = ((buf[idx + 1].toInt() and 0xFF) + n).coerceIn(0, 255).toByte()
            buf[idx + 2] = ((buf[idx + 2].toInt() and 0xFF) + n).coerceIn(0, 255).toByte()
        }
        rgbaMat.put(0, 0, buf)
    }
}
