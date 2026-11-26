package org.intabtools.intabpdf.scanner.vision

import android.os.SystemClock
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Clean-room Apache-2.0 OpenCV document quadrilateral detector.
 * Combines Otsu-guided luminance & Lab chroma edge maps, foreground region segmentation,
 * dense contour orientation-clustered least-squares line fitting, convex-hull polygon
 * simplification, and directional edge-support + contrast scoring.
 */
class OpenCvDocumentDetector : DocumentDetector {

    override fun detect(sourceRgbaMat: Mat, mode: DetectionMode): DetectionResult {
        val startMs = SystemClock.elapsedRealtime()
        if (sourceRgbaMat.empty() || sourceRgbaMat.cols() < 32 || sourceRgbaMat.rows() < 32) {
            return DetectionResult.empty(0L)
        }

        val maxWorkingDim = if (mode == DetectionMode.LIVE_PREVIEW) 360.0 else 960.0
        val bgr = Mat()
        val resized = Mat()
        val gray = Mat()
        val lab = Mat()
        val gradMag = Mat()
        val morphKernel = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(7.0, 7.0))
        val closeKernel = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(9.0, 9.0))
        val dilateKernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(3.0, 3.0))

        try {
            when (sourceRgbaMat.channels()) {
                4 -> Imgproc.cvtColor(sourceRgbaMat, bgr, Imgproc.COLOR_RGBA2BGR)
                3 -> sourceRgbaMat.copyTo(bgr)
                else -> Imgproc.cvtColor(sourceRgbaMat, bgr, Imgproc.COLOR_GRAY2BGR)
            }

            val maxDim = max(bgr.cols(), bgr.rows()).toDouble()
            val scale = if (maxDim > maxWorkingDim) maxWorkingDim / maxDim else 1.0
            if (scale < 1.0) {
                Imgproc.resize(
                    bgr,
                    resized,
                    Size(
                        max(32, (bgr.cols() * scale).roundToInt()).toDouble(),
                        max(32, (bgr.rows() * scale).roundToInt()).toDouble(),
                    ),
                    0.0,
                    0.0,
                    Imgproc.INTER_AREA,
                )
            } else {
                bgr.copyTo(resized)
            }

            val width = resized.cols().toFloat()
            val height = resized.rows().toFloat()
            val frameArea = width * height

            Imgproc.cvtColor(resized, gray, Imgproc.COLOR_BGR2GRAY)
            Imgproc.cvtColor(resized, lab, Imgproc.COLOR_BGR2Lab)
            val labChannels = ArrayList<Mat>(3)
            Core.split(lab, labChannels)

            buildGradientMagnitudeMap(gray, gradMag)
            val wInt = gray.cols()
            val hInt = gray.rows()
            val totalPixels = wInt * hInt
            val grayBytes = ByteArray(totalPixels)
            val gradBytes = ByteArray(totalPixels)
            gray.get(0, 0, grayBytes)
            gradMag.get(0, 0, gradBytes)

            val candidateMaps = buildCandidateMaps(gray, labChannels, mode, morphKernel, closeKernel, dilateKernel)
            val best = evaluateCandidates(candidateMaps, grayBytes, gradBytes, wInt, hInt, width, height, frameArea)
            val refined = best?.let { refineQuadSidesToGradientRidge(it, grayBytes, gradBytes, wInt, hInt) }

            candidateMaps.forEach { it.release() }
            labChannels.forEach { it.release() }

            val elapsed = SystemClock.elapsedRealtime() - startMs
            if (refined == null) {
                return DetectionResult.empty(elapsed)
            }

            val quad = refined.quad
            return DetectionResult(
                normalizedQuad = quad,
                confidence = refined.score.coerceIn(0f, 1f),
                areaFraction = quad.areaFraction(),
                touchesOuterMargin = quad.touchesOuterMargin(),
                inferenceTimeMs = elapsed,
            )
        } catch (_: Throwable) {
            val elapsed = SystemClock.elapsedRealtime() - startMs
            return DetectionResult.empty(elapsed)
        } finally {
            bgr.release()
            resized.release()
            gray.release()
            lab.release()
            gradMag.release()
            morphKernel.release()
            closeKernel.release()
            dilateKernel.release()
        }
    }

    private fun buildGradientMagnitudeMap(gray: Mat, outGrad: Mat) {
        val blur = Mat()
        val gx = Mat()
        val gy = Mat()
        val absX = Mat()
        val absY = Mat()
        try {
            Imgproc.GaussianBlur(gray, blur, Size(5.0, 5.0), 0.0)
            Imgproc.Sobel(blur, gx, CvType.CV_16S, 1, 0, 3)
            Imgproc.Sobel(blur, gy, CvType.CV_16S, 0, 1, 3)
            Core.convertScaleAbs(gx, absX, 0.25)
            Core.convertScaleAbs(gy, absY, 0.25)
            Core.addWeighted(absX, 0.5, absY, 0.5, 0.0, outGrad)
        } finally {
            blur.release()
            gx.release()
            gy.release()
            absX.release()
            absY.release()
        }
    }

    private fun buildCandidateMaps(
        gray: Mat,
        labChannels: List<Mat>,
        mode: DetectionMode,
        morphKernel: Mat,
        closeKernel: Mat,
        dilateKernel: Mat,
    ): List<Mat> {
        val maps = mutableListOf<Mat>()

        // 1. Text-suppressed Otsu-guided Canny edge map (luminance + chroma)
        val closedGray = Mat()
        val blurredGray = Mat()
        val otsuDummy = Mat()
        val grayEdges = Mat()
        val combinedEdges = Mat.zeros(gray.size(), CvType.CV_8U)
        try {
            Imgproc.morphologyEx(gray, closedGray, Imgproc.MORPH_CLOSE, morphKernel)
            Imgproc.GaussianBlur(closedGray, blurredGray, Size(5.0, 5.0), 0.0)
            val otsu = Imgproc.threshold(blurredGray, otsuDummy, 0.0, 255.0, Imgproc.THRESH_BINARY or Imgproc.THRESH_OTSU)
            val lower = (otsu * 0.40).coerceIn(18.0, 85.0)
            val upper = (otsu * 0.95).coerceIn(lower + 32.0, 210.0)
            Imgproc.Canny(blurredGray, grayEdges, lower, upper)
            Core.bitwise_or(combinedEdges, grayEdges, combinedEdges)

            for (chromaIdx in 1..2) {
                val chromaClosed = Mat()
                val chromaBlur = Mat()
                val chromaEdges = Mat()
                try {
                    Imgproc.morphologyEx(labChannels[chromaIdx], chromaClosed, Imgproc.MORPH_CLOSE, morphKernel)
                    Imgproc.GaussianBlur(chromaClosed, chromaBlur, Size(5.0, 5.0), 0.0)
                    Imgproc.Canny(chromaBlur, chromaEdges, 36.0, 108.0)
                    Core.bitwise_or(combinedEdges, chromaEdges, combinedEdges)
                } finally {
                    chromaClosed.release()
                    chromaBlur.release()
                    chromaEdges.release()
                }
            }

            val dilated = Mat()
            val bridged = Mat()
            try {
                Imgproc.dilate(combinedEdges, dilated, dilateKernel)
                Imgproc.morphologyEx(dilated, bridged, Imgproc.MORPH_CLOSE, morphKernel)
                maps += bridged
            } finally {
                dilated.release()
            }
        } finally {
            closedGray.release()
            blurredGray.release()
            otsuDummy.release()
            grayEdges.release()
            combinedEdges.release()
        }

        // 2. Otsu foreground paper-region mask (use tighter closing in LIVE_PREVIEW so narrow
        // gaps between a page's right edge and stacked lower pages/cover are not bridged over)
        val regionBlur = Mat()
        val regionBin = Mat()
        val regionClosed = Mat()
        val regionOpened = Mat()
        val regionCloseKernel = if (mode == DetectionMode.LIVE_PREVIEW) {
            Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(5.0, 5.0))
        } else {
            closeKernel
        }
        try {
            Imgproc.GaussianBlur(gray, regionBlur, Size(7.0, 7.0), 0.0)
            Imgproc.threshold(regionBlur, regionBin, 0.0, 255.0, Imgproc.THRESH_BINARY or Imgproc.THRESH_OTSU)
            Imgproc.morphologyEx(regionBin, regionClosed, Imgproc.MORPH_CLOSE, regionCloseKernel)
            Imgproc.morphologyEx(regionClosed, regionOpened, Imgproc.MORPH_OPEN, morphKernel)
            maps += regionOpened
        } finally {
            regionBlur.release()
            regionBin.release()
            regionClosed.release()
            if (regionCloseKernel !== closeKernel) {
                regionCloseKernel.release()
            }
        }

        // 3. Soft luminance Canny + edge-preserving local adaptive mask (splits open notebook spreads along dark binding gutter)
        if (mode == DetectionMode.STILL_CAPTURE) {
            val thresh = Mat()
            val morph = Mat()
            val blur = Mat()
            try {
                Imgproc.GaussianBlur(gray, blur, Size(7.0, 7.0), 0.0)
                Imgproc.adaptiveThreshold(
                    blur,
                    thresh,
                    255.0,
                    Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C,
                    Imgproc.THRESH_BINARY,
                    25,
                    4.0,
                )
                Imgproc.morphologyEx(thresh, morph, Imgproc.MORPH_OPEN, closeKernel)
                maps += morph
            } finally {
                thresh.release()
                blur.release()
            }

            val adaptGutter = Mat()
            val adaptBlur = Mat()
            val adaptClosed = Mat()
            val smallClose = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(5.0, 5.0))
            val gutterOpen = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(9.0, 9.0))
            try {
                Imgproc.GaussianBlur(gray, adaptBlur, Size(9.0, 9.0), 0.0)
                Imgproc.adaptiveThreshold(
                    adaptBlur,
                    adaptGutter,
                    255.0,
                    Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C,
                    Imgproc.THRESH_BINARY,
                    35,
                    5.0,
                )
                Imgproc.morphologyEx(adaptGutter, adaptClosed, Imgproc.MORPH_CLOSE, smallClose)
                val adaptOpened = Mat()
                Imgproc.morphologyEx(adaptClosed, adaptOpened, Imgproc.MORPH_OPEN, gutterOpen)
                maps += adaptOpened
            } finally {
                adaptGutter.release()
                adaptBlur.release()
                adaptClosed.release()
                smallClose.release()
                gutterOpen.release()
            }
        } else {
            val softBlur = Mat()
            val softCanny = Mat()
            val softDilated = Mat()
            val softClosed = Mat()
            try {
                Imgproc.GaussianBlur(gray, softBlur, Size(7.0, 7.0), 0.0)
                Imgproc.Canny(softBlur, softCanny, 28.0, 88.0)
                Imgproc.dilate(softCanny, softDilated, dilateKernel)
                Imgproc.morphologyEx(softDilated, softClosed, Imgproc.MORPH_CLOSE, morphKernel)
                maps += softClosed
            } finally {
                softBlur.release()
                softCanny.release()
                softDilated.release()
            }

            val adaptBlur = Mat()
            val adaptThresh = Mat()
            val adaptClosed = Mat()
            val adaptOpened = Mat()
            val smallClose = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(3.0, 3.0))
            val gutterOpen = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(5.0, 5.0))
            try {
                Imgproc.GaussianBlur(gray, adaptBlur, Size(7.0, 7.0), 0.0)
                Imgproc.adaptiveThreshold(
                    adaptBlur,
                    adaptThresh,
                    255.0,
                    Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C,
                    Imgproc.THRESH_BINARY,
                    21,
                    5.0,
                )
                Imgproc.morphologyEx(adaptThresh, adaptClosed, Imgproc.MORPH_CLOSE, smallClose)
                Imgproc.morphologyEx(adaptClosed, adaptOpened, Imgproc.MORPH_OPEN, gutterOpen)
                maps += adaptOpened
            } finally {
                adaptBlur.release()
                adaptThresh.release()
                adaptClosed.release()
                smallClose.release()
                gutterOpen.release()
            }
        }

        return maps
    }

    private data class ScoredCandidate(
        val quad: NormalizedQuad,
        val score: Float,
    )

    private fun evaluateCandidates(
        candidateMaps: List<Mat>,
        grayBytes: ByteArray,
        gradBytes: ByteArray,
        imgW: Int,
        imgH: Int,
        width: Float,
        height: Float,
        frameArea: Float,
    ): ScoredCandidate? {
        var best: ScoredCandidate? = null

        for (edgeMap in candidateMaps) {
            val contours = ArrayList<MatOfPoint>()
            val hierarchy = Mat()
            try {
                // Use RETR_LIST so inner single-page contours inside an open notebook cover or
                // two-page spread are evaluated alongside outer contours.
                Imgproc.findContours(edgeMap, contours, hierarchy, Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE)
                val largest = contours
                    .filter {
                        val area = Imgproc.contourArea(it)
                        area >= frameArea * 0.05 && area <= frameArea * 0.94
                    }
                    .sortedByDescending { Imgproc.contourArea(it) }
                    .take(12)

                for (contour in largest) {
                    val contourArea = Imgproc.contourArea(contour)
                    val hullIndices = org.opencv.core.MatOfInt()
                    try {
                        Imgproc.convexHull(contour, hullIndices)
                        val pts = contour.toArray()
                        val hullPts = hullIndices.toArray().map { pts[it] }
                        val hull2f = MatOfPoint2f(*hullPts.toTypedArray())
                        try {
                            val peri = Imgproc.arcLength(hull2f, true)
                            if (peri <= 12.0) continue

                            val candidateQuads = mutableListOf<NormalizedQuad>()

                            // Dense orientation-clustered least-squares 4-line fit on smoothed hull/contour
                            fitLinearSideQuad(pts, hull2f, peri, width, height)?.let { candidateQuads += it }

                            // Polygon approximation candidates + curved-edge N-gon reduction to 4 corners
                            for (factor in listOf(0.015, 0.025, 0.04, 0.06)) {
                                val approx = MatOfPoint2f()
                                Imgproc.approxPolyDP(hull2f, approx, factor * peri, true)
                                val approxPts = approx.toArray()
                                approx.release()
                                val quadPts = when {
                                    approxPts.size == 4 -> approxPts.toList()
                                    approxPts.size in 5..10 -> reduceConvexPolygonToQuad(approxPts)
                                    else -> null
                                }
                                if (quadPts != null) {
                                    val normalized = quadPts.map { p ->
                                        NormalizedPoint((p.x / width).toFloat(), (p.y / height).toFloat())
                                    }
                                    NormalizedQuad.orderClockwise(normalized)?.let { candidateQuads += it }
                                }
                            }

                            for (quad in candidateQuads) {
                                if (!quad.isValidConvex()) continue
                                // Reject wildly curved/irregular regions that cannot be represented
                                // accurately by a 4-corner quadrilateral
                                val quadPixelArea = quad.areaFraction() * frameArea
                                if (contourArea > 1.0 && quadPixelArea > 1f) {
                                    val areaFit = min(contourArea, quadPixelArea.toDouble()) /
                                        max(contourArea, quadPixelArea.toDouble())
                                    if (areaFit < 0.68) continue
                                }
                                val score = scoreQuad(quad, grayBytes, gradBytes, imgW, imgH)
                                if (best == null || score > best.score) {
                                    best = ScoredCandidate(quad, score)
                                }
                            }
                        } finally {
                            hull2f.release()
                        }
                    } finally {
                        hullIndices.release()
                    }
                }
            } finally {
                contours.forEach { it.release() }
                hierarchy.release()
            }
        }

        return best
    }

    /**
     * Reconstructs a quadrilateral by clustering contour boundary segments into four dominant
     * edge orientations, fitting an orthogonal least-squares line through all supporting points
     * of each side, and intersecting adjacent lines.
     */
    private fun fitLinearSideQuad(
        contourPts: Array<Point>,
        hull2f: MatOfPoint2f,
        perimeter: Double,
        width: Float,
        height: Float,
    ): NormalizedQuad? {
        val denseApprox = MatOfPoint2f()
        val sourcePts: Array<Point>
        try {
            if (contourPts.size >= 16) {
                val c2f = MatOfPoint2f(*contourPts)
                Imgproc.approxPolyDP(c2f, denseApprox, 0.004 * perimeter, true)
                c2f.release()
                sourcePts = denseApprox.toArray()
            } else {
                Imgproc.approxPolyDP(hull2f, denseApprox, 0.005 * perimeter, true)
                sourcePts = denseApprox.toArray()
            }
        } finally {
            denseApprox.release()
        }

        val n = sourcePts.size
        if (n < 4) return null

        data class Segment(
            val p1: Point,
            val p2: Point,
            val len: Double,
            val angleModPi: Double,
            val midX: Double,
            val midY: Double,
        )

        val segs = ArrayList<Segment>(n)
        for (i in 0 until n) {
            val a = sourcePts[i]
            val b = sourcePts[(i + 1) % n]
            val len = hypot(b.x - a.x, b.y - a.y)
            if (len < 3.0) continue
            var ang = atan2(b.y - a.y, b.x - a.x)
            if (ang < 0) ang += Math.PI
            if (ang >= Math.PI) ang -= Math.PI
            segs += Segment(a, b, len, ang, (a.x + b.x) * 0.5, (a.y + b.y) * 0.5)
        }
        if (segs.size < 4) return null

        // Group segments into clusters sharing similar orientation (mod Pi) and spatial proximity
        class SideCluster(
            var refAngle: Double,
            var totalLen: Double,
            var sumMidX: Double,
            var sumMidY: Double,
            val points: MutableList<Point>,
        )

        val clusters = mutableListOf<SideCluster>()
        val angleTol = Math.toRadians(20.0)
        val diag = hypot(width.toDouble(), height.toDouble())
        val maxNormalSep = diag * 0.12

        for (seg in segs.sortedByDescending { it.len }) {
            var matched: SideCluster? = null
            for (c in clusters) {
                val diff = angleDiffModPi(seg.angleModPi, c.refAngle)
                if (diff <= angleTol) {
                    val cMidX = c.sumMidX / c.totalLen
                    val cMidY = c.sumMidY / c.totalLen
                    // Perpendicular distance from segment midpoint to cluster center along cluster normal
                    val nx = -sin(c.refAngle)
                    val ny = cos(c.refAngle)
                    val perpDist = abs((seg.midX - cMidX) * nx + (seg.midY - cMidY) * ny)
                    if (perpDist <= maxNormalSep) {
                        matched = c
                        break
                    }
                }
            }
            if (matched != null) {
                matched.totalLen += seg.len
                matched.sumMidX += seg.midX * seg.len
                matched.sumMidY += seg.midY * seg.len
                matched.points += seg.p1
                matched.points += seg.p2
            } else {
                clusters += SideCluster(
                    refAngle = seg.angleModPi,
                    totalLen = seg.len,
                    sumMidX = seg.midX * seg.len,
                    sumMidY = seg.midY * seg.len,
                    points = mutableListOf(seg.p1, seg.p2),
                )
            }
        }

        // Select top 4 clusters representing distinct document sides (no duplicate collinear side)
        val chosen = mutableListOf<SideCluster>()
        for (c in clusters.sortedByDescending { it.totalLen }) {
            val cMidX = c.sumMidX / c.totalLen
            val cMidY = c.sumMidY / c.totalLen
            val duplicatesSide = chosen.any { existing ->
                val eMidX = existing.sumMidX / existing.totalLen
                val eMidY = existing.sumMidY / existing.totalLen
                val sameAngle = angleDiffModPi(c.refAngle, existing.refAngle) < Math.toRadians(22.0)
                val nx = -sin(existing.refAngle)
                val ny = cos(existing.refAngle)
                val perpDist = abs((cMidX - eMidX) * nx + (cMidY - eMidY) * ny)
                sameAngle && perpDist < diag * 0.08
            }
            if (!duplicatesSide) {
                chosen += c
                if (chosen.size == 4) break
            }
        }
        if (chosen.size != 4) return null

        // Order the 4 sides cyclically around the cluster centroid
        val cx = chosen.sumOf { it.sumMidX / it.totalLen } / 4.0
        val cy = chosen.sumOf { it.sumMidY / it.totalLen } / 4.0
        val orderedSides = chosen.sortedBy { c ->
            atan2((c.sumMidY / c.totalLen) - cy, (c.sumMidX / c.totalLen) - cx)
        }

        val lines = orderedSides.map { fitOrthogonalLine(it.points) ?: return null }
        val intersections = ArrayList<NormalizedPoint>(4)
        for (i in 0 until 4) {
            val l1 = lines[i]
            val l2 = lines[(i + 1) % 4]
            val inter = intersectLines(l1.first, l1.second, l2.first, l2.second) ?: return null
            val nx = (inter.x / width).toFloat()
            val ny = (inter.y / height).toFloat()
            if (!nx.isFinite() || !ny.isFinite() || nx < -0.08f || ny < -0.08f || nx > 1.08f || ny > 1.08f) {
                return null
            }
            intersections += NormalizedPoint(nx, ny).clamped()
        }
        return NormalizedQuad.orderClockwise(intersections)
    }

    /**
     * Simplifies a convex 5..10-vertex polygon (such as a page with slightly curved or uneven
     * notebook edges) to 4 corners by iteratively removing the vertex that contributes the
     * smallest marginal triangle area.
     */
    private fun reduceConvexPolygonToQuad(points: Array<Point>): List<Point>? {
        if (points.size < 4) return null
        val poly = points.toMutableList()
        while (poly.size > 4) {
            var removeIdx = -1
            var minArea = Double.MAX_VALUE
            val n = poly.size
            for (i in 0 until n) {
                val a = poly[(i - 1 + n) % n]
                val b = poly[i]
                val c = poly[(i + 1) % n]
                val twiceTriArea = abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
                if (twiceTriArea < minArea) {
                    minArea = twiceTriArea
                    removeIdx = i
                }
            }
            if (removeIdx < 0) return null
            poly.removeAt(removeIdx)
        }
        return poly
    }

    private fun fitOrthogonalLine(points: List<Point>): Pair<Point, Point>? {
        if (points.size < 2) return null
        var mx = 0.0
        var my = 0.0
        for (p in points) {
            mx += p.x
            my += p.y
        }
        mx /= points.size
        my /= points.size

        var sxx = 0.0
        var sxy = 0.0
        var syy = 0.0
        for (p in points) {
            val dx = p.x - mx
            val dy = p.y - my
            sxx += dx * dx
            sxy += dx * dy
            syy += dy * dy
        }
        val theta = 0.5 * atan2(2.0 * sxy, sxx - syy)
        val p1 = Point(mx, my)
        val p2 = Point(mx + cos(theta), my + sin(theta))
        return p1 to p2
    }

    /**
     * Refines each quad edge along its own normal within a tight local band to snap off
     * morphological dilation halos, stacked-page rims, or outer cover margins onto the primary
     * high-contrast page boundary without breaking tilted/trapezoidal geometry or centre binding.
     */
    private fun refineQuadSidesToGradientRidge(
        candidate: ScoredCandidate,
        grayBytes: ByteArray,
        gradBytes: ByteArray,
        w: Int,
        h: Int,
    ): ScoredCandidate {
        val pts = candidate.quad.points()
        val samplesPerSide = 15

        // Determine dominant foreground-vs-background contrast polarity across the quad
        var netContrast = 0.0
        for (i in 0 until 4) {
            val a = pts[i]
            val b = pts[(i + 1) % 4]
            val nx = -(b.y - a.y)
            val ny = (b.x - a.x)
            val len = hypot(nx.toDouble(), ny.toDouble()).coerceAtLeast(1e-5)
            val ux = nx / len
            val uy = ny / len
            for (step in 1..samplesPerSide) {
                val t = step / (samplesPerSide + 1).toDouble()
                val px = (a.x + (b.x - a.x) * t) * w
                val py = (a.y + (b.y - a.y) * t) * h
                val inX = (px + ux * 4.0).toInt().coerceIn(0, w - 1)
                val inY = (py + uy * 4.0).toInt().coerceIn(0, h - 1)
                val outX = (px - ux * 4.0).toInt().coerceIn(0, w - 1)
                val outY = (py - uy * 4.0).toInt().coerceIn(0, h - 1)
                netContrast += ((grayBytes[inY * w + inX].toInt() and 0xFF) - (grayBytes[outY * w + outX].toInt() and 0xFF))
            }
        }
        val polarity = if (netContrast >= 0.0) 1.0 else -1.0

        val minDim = min(w, h)
        val maxOutward = max(3, (minDim * 0.014).roundToInt())
        val maxInward = max(8, (minDim * 0.048).roundToInt())

        val refinedLines = ArrayList<Pair<Point, Point>>(4)
        var anyShifted = false

        for (i in 0 until 4) {
            val a = pts[i]
            val b = pts[(i + 1) % 4]
            val ax = a.x * w.toDouble()
            val ay = a.y * h.toDouble()
            val bx = b.x * w.toDouble()
            val by = b.y * h.toDouble()

            val nx = -(b.y - a.y)
            val ny = (b.x - a.x)
            val len = hypot(nx.toDouble(), ny.toDouble()).coerceAtLeast(1e-5)
            val ux = nx / len
            val uy = ny / len

            var bestShift = 0
            var bestShiftScore = Double.NEGATIVE_INFINITY
            var baseShiftScore = 0.0

            for (shift in -maxOutward..maxInward) {
                var edgeSum = 0.0
                var contrastSum = 0.0
                var strongSamples = 0

                for (step in 1..samplesPerSide) {
                    val t = step / (samplesPerSide + 1).toDouble()
                    val px = ax + (bx - ax) * t + ux * shift
                    val py = ay + (by - ay) * t + uy * shift

                    var peakGrad = 0
                    for (offset in -1..1) {
                        val sx = (px + ux * offset).toInt().coerceIn(0, w - 1)
                        val sy = (py + uy * offset).toInt().coerceIn(0, h - 1)
                        val g = gradBytes[sy * w + sx].toInt() and 0xFF
                        if (g > peakGrad) peakGrad = g
                    }
                    if (peakGrad >= 14) strongSamples++
                    edgeSum += (peakGrad / 68.0).coerceAtMost(1.0)

                    val inX = (px + ux * 4.0).toInt().coerceIn(0, w - 1)
                    val inY = (py + uy * 4.0).toInt().coerceIn(0, h - 1)
                    val outX = (px - ux * 4.0).toInt().coerceIn(0, w - 1)
                    val outY = (py - uy * 4.0).toInt().coerceIn(0, h - 1)
                    val signedDiff = ((grayBytes[inY * w + inX].toInt() and 0xFF) - (grayBytes[outY * w + outX].toInt() and 0xFF)) * polarity
                    contrastSum += (signedDiff / 255.0).coerceIn(-0.5, 1.0)
                }

                val meanEdge = edgeSum / samplesPerSide
                val meanContrast = contrastSum / samplesPerSide
                val supportFraction = strongSamples.toDouble() / samplesPerSide
                // Mild preference for tight inner page edge over outer cover/stack halo when tied
                val tightBias = if (shift > 0) 0.025 else 0.0
                val score = if (supportFraction >= 0.55 && meanContrast > 0.03) {
                    meanEdge * 0.62 + meanContrast * 0.38 + tightBias
                } else {
                    -1.0
                }
                if (shift == 0) {
                    baseShiftScore = score
                }
                if (score > bestShiftScore) {
                    bestShiftScore = score
                    bestShift = shift
                }
            }

            val acceptedShift = if (bestShift != 0 && bestShiftScore > baseShiftScore + 0.015) {
                anyShifted = true
                bestShift
            } else {
                0
            }
            refinedLines += Point(ax + ux * acceptedShift, ay + uy * acceptedShift) to
                Point(bx + ux * acceptedShift, by + uy * acceptedShift)
        }

        if (!anyShifted) return candidate

        val intersections = ArrayList<NormalizedPoint>(4)
        for (i in 0 until 4) {
            val l1 = refinedLines[(i + 3) % 4]
            val l2 = refinedLines[i]
            val inter = intersectLines(l1.first, l1.second, l2.first, l2.second) ?: return candidate
            val nx = (inter.x / w).toFloat()
            val ny = (inter.y / h).toFloat()
            if (!nx.isFinite() || !ny.isFinite() || nx < -0.02f || ny < -0.02f || nx > 1.02f || ny > 1.02f) {
                return candidate
            }
            intersections += NormalizedPoint(nx, ny).clamped()
        }
        val refinedQuad = NormalizedQuad.orderClockwise(intersections) ?: return candidate
        if (!refinedQuad.isValidConvex()) return candidate
        val refinedScore = scoreQuad(refinedQuad, grayBytes, gradBytes, w, h)
        return if (refinedScore >= candidate.score) {
            ScoredCandidate(refinedQuad, refinedScore)
        } else {
            candidate
        }
    }

    private fun scoreQuad(
        quad: NormalizedQuad,
        grayBytes: ByteArray,
        gradBytes: ByteArray,
        w: Int,
        h: Int,
    ): Float {
        val pts = quad.points()
        val area = quad.areaFraction()

        // Favor typical framed document sizes [0.14 .. 0.78] without rewarding full-frame backgrounds
        val areaScore = when {
            area < 0.06f -> 0.15f
            area < 0.14f -> 0.35f + ((area - 0.06f) / 0.08f) * 0.45f
            area <= 0.78f -> 0.85f + (1f - abs(area - 0.45f) / 0.35f).coerceIn(0f, 1f) * 0.15f
            area <= 0.90f -> 0.82f - ((area - 0.78f) / 0.12f) * 0.25f
            else -> 0.45f
        }

        var edgeSum = 0.0
        var minSideEdge = 1.0
        var contrastSum = 0.0
        var minSideContrast = 1.0
        var signedContrastNet = 0.0
        var absContrastTotal = 0.0
        val samplesPerSide = 14

        for (i in 0 until 4) {
            val a = pts[i]
            val b = pts[(i + 1) % 4]
            val nx = -(b.y - a.y)
            val ny = (b.x - a.x)
            val len = hypot(nx.toDouble(), ny.toDouble()).coerceAtLeast(1e-5)
            val ux = nx / len
            val uy = ny / len

            var sideEdgeSum = 0.0
            var signedSideContrast = 0.0

            for (step in 1..samplesPerSide) {
                val t = step / (samplesPerSide + 1).toDouble()
                val px = (a.x + (b.x - a.x) * t) * w
                val py = (a.y + (b.y - a.y) * t) * h

                // Peak gradient within +-2 px normal to the fitted edge
                var peakGrad = 0
                for (offset in -2..2) {
                    val sx = (px + ux * offset).toInt().coerceIn(0, w - 1)
                    val sy = (py + uy * offset).toInt().coerceIn(0, h - 1)
                    val g = gradBytes[sy * w + sx].toInt() and 0xFF
                    if (g > peakGrad) peakGrad = g
                }
                sideEdgeSum += (peakGrad / 68.0).coerceAtMost(1.0)

                val inX = (px + ux * 4.5).toInt().coerceIn(0, w - 1)
                val inY = (py + uy * 4.5).toInt().coerceIn(0, h - 1)
                val outX = (px - ux * 4.5).toInt().coerceIn(0, w - 1)
                val outY = (py - uy * 4.5).toInt().coerceIn(0, h - 1)
                val inVal = grayBytes[inY * w + inX].toInt() and 0xFF
                val outVal = grayBytes[outY * w + outX].toInt() and 0xFF
                signedSideContrast += (inVal - outVal) / 255.0
            }

            val sideEdgeAvg = sideEdgeSum / samplesPerSide
            val sideSignedAvg = signedSideContrast / samplesPerSide
            val sideContrastAvg = abs(sideSignedAvg)
            edgeSum += sideEdgeAvg
            contrastSum += sideContrastAvg
            signedContrastNet += sideSignedAvg
            absContrastTotal += sideContrastAvg
            if (sideEdgeAvg < minSideEdge) minSideEdge = sideEdgeAvg
            if (sideContrastAvg < minSideContrast) minSideContrast = sideContrastAvg
        }

        val edgeScore = ((edgeSum / 4.0) * 0.65 + minSideEdge * 0.35).toFloat().coerceIn(0f, 1f)
        val rawContrast = ((contrastSum / 4.0) * 0.65 + minSideContrast * 0.35).toFloat().coerceIn(0f, 1f)
        val polarityConsistency = if (absContrastTotal > 1e-4) {
            (abs(signedContrastNet) / absContrastTotal).toFloat().coerceIn(0f, 1f)
        } else {
            1f
        }
        val contrastScore = (rawContrast * (0.70f + 0.30f * polarityConsistency)).coerceIn(0f, 1f)
        val perspectiveScore = computePerspectiveGeometryScore(pts)

        val marginPenalty = if (quad.touchesOuterMargin(margin = 0.01f)) 0.80f else 1.0f
        val rawScore = (edgeScore * 0.45f) + (contrastScore * 0.25f) + (areaScore * 0.20f) + (perspectiveScore * 0.10f)
        return (rawScore * marginPenalty).coerceIn(0f, 1f)
    }

    /**
     * Evaluates convex quadrilateral plausibility across normal and perspective-distorted
     * (trapezoidal / oblique) page geometries without requiring 90-degree corners or equal
     * opposite side lengths.
     */
    private fun computePerspectiveGeometryScore(pts: List<NormalizedPoint>): Float {
        var minCorner = 180f
        var maxCorner = 0f
        for (i in 0 until 4) {
            val prev = pts[(i + 3) % 4]
            val curr = pts[i]
            val next = pts[(i + 1) % 4]
            val v1x = prev.x - curr.x
            val v1y = prev.y - curr.y
            val v2x = next.x - curr.x
            val v2y = next.y - curr.y
            val len1 = hypot(v1x, v1y).coerceAtLeast(1e-5f)
            val len2 = hypot(v2x, v2y).coerceAtLeast(1e-5f)
            val cosA = ((v1x * v2x + v1y * v2y) / (len1 * len2)).coerceIn(-1f, 1f)
            val angleDeg = Math.toDegrees(acos(cosA.toDouble())).toFloat()
            if (angleDeg < minCorner) minCorner = angleDeg
            if (angleDeg > maxCorner) maxCorner = angleDeg
        }
        val lowScore = ((minCorner - 20f) / 14f).coerceIn(0f, 1f)
        val highScore = ((160f - maxCorner) / 14f).coerceIn(0f, 1f)
        return min(lowScore, highScore)
    }

    private fun angleDiffModPi(a: Double, b: Double): Double {
        val diff = abs(a - b) % Math.PI
        return min(diff, Math.PI - diff)
    }

    private fun intersectLines(p1: Point, p2: Point, p3: Point, p4: Point): Point? {
        val denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x)
        if (abs(denom) < 1e-6) return null
        val t1 = p1.x * p2.y - p1.y * p2.x
        val t2 = p3.x * p4.y - p3.y * p4.x
        val px = (t1 * (p3.x - p4.x) - (p1.x - p2.x) * t2) / denom
        val py = (t1 * (p3.y - p4.y) - (p1.y - p2.y) * t2) / denom
        return Point(px, py)
    }
}
