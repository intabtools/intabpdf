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
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Clean-room Apache-2.0 OpenCV document quadrilateral detector.
 * Combines CIELAB / luminance multi-channel smoothing, morphological page-text suppression,
 * adaptive Canny + adaptive threshold edge extraction, convex-hull polygon simplification,
 * dominant 4-line fitting fallback, and geometric/contrast confidence scoring.
 */
class OpenCvDocumentDetector : DocumentDetector {

    override fun detect(sourceRgbaMat: Mat, mode: DetectionMode): DetectionResult {
        val startMs = SystemClock.elapsedRealtime()
        if (sourceRgbaMat.empty() || sourceRgbaMat.cols() < 32 || sourceRgbaMat.rows() < 32) {
            return DetectionResult.empty(0L)
        }

        val maxWorkingDim = if (mode == DetectionMode.LIVE_PREVIEW) 480.0 else 960.0
        val bgr = Mat()
        val resized = Mat()
        val gray = Mat()
        val lab = Mat()
        val morphKernel = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(9.0, 9.0))
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
                    Size((bgr.cols() * scale).roundToInt().toDouble(), (bgr.rows() * scale).roundToInt().toDouble()),
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

            val candidateMaps = buildEdgeCandidates(gray, labChannels, mode, morphKernel, dilateKernel)
            val best = evaluateCandidates(candidateMaps, gray, width, height, frameArea)

            candidateMaps.forEach { it.release() }
            labChannels.forEach { it.release() }

            val elapsed = SystemClock.elapsedRealtime() - startMs
            if (best == null) {
                return DetectionResult.empty(elapsed)
            }

            val quad = best.quad
            return DetectionResult(
                normalizedQuad = quad,
                confidence = best.score.coerceIn(0f, 1f),
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
            morphKernel.release()
            dilateKernel.release()
        }
    }

    private fun buildEdgeCandidates(
        gray: Mat,
        labChannels: List<Mat>,
        mode: DetectionMode,
        morphKernel: Mat,
        dilateKernel: Mat,
    ): List<Mat> {
        val maps = mutableListOf<Mat>()
        val planes = if (mode == DetectionMode.LIVE_PREVIEW) {
            listOf(gray, labChannels[1], labChannels[2])
        } else {
            listOf(gray, labChannels[0], labChannels[1], labChannels[2])
        }

        val combinedCanny = Mat.zeros(gray.size(), CvType.CV_8U)
        for (plane in planes) {
            val closed = Mat()
            val blurred = Mat()
            val edges = Mat()
            try {
                Imgproc.morphologyEx(plane, closed, Imgproc.MORPH_CLOSE, morphKernel)
                Imgproc.GaussianBlur(closed, blurred, Size(5.0, 5.0), 0.0)
                val meanVal = Core.mean(blurred).`val`[0]
                val lower = (meanVal * 0.45).coerceIn(18.0, 90.0)
                val upper = (meanVal * 1.15).coerceIn(lower + 30.0, 220.0)
                Imgproc.Canny(blurred, edges, lower, upper)
                Core.bitwise_or(combinedCanny, edges, combinedCanny)
            } finally {
                closed.release()
                blurred.release()
                edges.release()
            }
        }
        val dilatedCanny = Mat()
        Imgproc.dilate(combinedCanny, dilatedCanny, dilateKernel)
        combinedCanny.release()
        maps += dilatedCanny

        // Secondary edge map for softer / low-contrast paper edges
        val softBlurred = Mat()
        val softCanny = Mat()
        val softDilated = Mat()
        try {
            Imgproc.GaussianBlur(gray, softBlurred, Size(7.0, 7.0), 0.0)
            Imgproc.Canny(softBlurred, softCanny, 25.0, 75.0)
            Imgproc.dilate(softCanny, softDilated, dilateKernel)
            maps += softDilated
        } finally {
            softBlurred.release()
            softCanny.release()
        }

        // Still capture also probes adaptive threshold foreground regions
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
                Imgproc.morphologyEx(thresh, morph, Imgproc.MORPH_OPEN, morphKernel)
                maps += morph
            } finally {
                thresh.release()
                blur.release()
            }
        }

        return maps
    }

    private data class ScoredCandidate(
        val quad: NormalizedQuad,
        val score: Float,
    )

    private fun evaluateCandidates(
        edgeMaps: List<Mat>,
        gray: Mat,
        width: Float,
        height: Float,
        frameArea: Float,
    ): ScoredCandidate? {
        var best: ScoredCandidate? = null

        for (edgeMap in edgeMaps) {
            val contours = ArrayList<MatOfPoint>()
            val hierarchy = Mat()
            try {
                Imgproc.findContours(edgeMap, contours, hierarchy, Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE)
                val largest = contours
                    .filter { Imgproc.contourArea(it) >= frameArea * 0.05 && Imgproc.contourArea(it) <= frameArea * 0.96 }
                    .sortedByDescending { Imgproc.contourArea(it) }
                    .take(5)

                for (contour in largest) {
                    val hullIndices = org.opencv.core.MatOfInt()
                    val contour2f = MatOfPoint2f(*contour.toArray())
                    try {
                        Imgproc.convexHull(contour, hullIndices)
                        val pts = contour.toArray()
                        val hullPts = hullIndices.toArray().map { pts[it] }
                        val hull2f = MatOfPoint2f(*hullPts.toTypedArray())
                        try {
                            val peri = Imgproc.arcLength(hull2f, true)
                            if (peri <= 10.0) continue

                            val candidateQuads = mutableListOf<NormalizedQuad>()
                            for (factor in listOf(0.02, 0.035, 0.055)) {
                                val approx = MatOfPoint2f()
                                Imgproc.approxPolyDP(hull2f, approx, factor * peri, true)
                                val approxPts = approx.toArray()
                                approx.release()
                                if (approxPts.size == 4) {
                                    val normalized = approxPts.map { p ->
                                        NormalizedPoint((p.x / width).toFloat(), (p.y / height).toFloat())
                                    }
                                    NormalizedQuad.orderClockwise(normalized)?.let { candidateQuads += it }
                                }
                            }

                            if (candidateQuads.isEmpty() && hullPts.size >= 4) {
                                fitDominantSideQuad(hullPts, width, height)?.let { candidateQuads += it }
                            }

                            for (quad in candidateQuads) {
                                if (!quad.isValidConvex()) continue
                                val score = scoreQuad(quad, gray)
                                if (best == null || score > best.score) {
                                    best = ScoredCandidate(quad, score)
                                }
                            }
                        } finally {
                            hull2f.release()
                        }
                    } finally {
                        hullIndices.release()
                        contour2f.release()
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
     * Fits 4 dominant straight edge lines when slightly rounded paper corners yield >4 hull vertices.
     */
    private fun fitDominantSideQuad(hullPts: List<Point>, width: Float, height: Float): NormalizedQuad? {
        if (hullPts.size < 4) return null
        val n = hullPts.size
        data class EdgeSeg(val idx: Int, val p1: Point, val p2: Point, val len: Double, val angle: Double)

        val segs = (0 until n).map { i ->
            val a = hullPts[i]
            val b = hullPts[(i + 1) % n]
            val len = hypot(b.x - a.x, b.y - a.y)
            val ang = atan2(b.y - a.y, b.x - a.x)
            EdgeSeg(i, a, b, len, ang)
        }

        val chosen = mutableListOf<EdgeSeg>()
        for (seg in segs.sortedByDescending { it.len }) {
            val tooParallel = chosen.any { existing ->
                val diff = abs(normalizeAngleDiff(seg.angle - existing.angle))
                val modPi = min(abs(diff), abs(Math.PI - diff))
                modPi < Math.toRadians(28.0) && seg.p1.distanceSq(existing.p1) < (width * 0.25f) * (width * 0.25f)
            }
            if (!tooParallel) {
                chosen += seg
                if (chosen.size == 4) break
            }
        }
        if (chosen.size != 4) return null

        val orderedSegs = chosen.sortedBy { it.idx }
        val intersections = mutableListOf<NormalizedPoint>()
        for (i in 0 until 4) {
            val s1 = orderedSegs[i]
            val s2 = orderedSegs[(i + 1) % 4]
            val inter = intersectSegmentsAsLines(s1.p1, s1.p2, s2.p1, s2.p2) ?: return null
            val nx = (inter.x / width).toFloat()
            val ny = (inter.y / height).toFloat()
            if (nx < -0.1f || ny < -0.1f || nx > 1.1f || ny > 1.1f) return null
            intersections += NormalizedPoint(nx, ny).clamped()
        }
        return NormalizedQuad.orderClockwise(intersections)
    }

    private fun scoreQuad(quad: NormalizedQuad, gray: Mat): Float {
        val area = quad.areaFraction()
        val areaScore = when {
            area < 0.08f -> area / 0.08f * 0.5f
            area <= 0.85f -> 0.55f + ((area - 0.08f) / 0.77f) * 0.45f
            else -> 0.85f
        }

        // Measure edge gradient support along the 4 sides
        val w = gray.cols()
        val h = gray.rows()
        val pts = quad.points()
        var gradientSum = 0.0
        var samples = 0
        for (i in 0 until 4) {
            val a = pts[i]
            val b = pts[(i + 1) % 4]
            val nx = -(b.y - a.y)
            val ny = (b.x - a.x)
            val len = hypot(nx.toDouble(), ny.toDouble()).coerceAtLeast(1e-5)
            val ux = nx / len
            val uy = ny / len

            for (step in 1..6) {
                val t = step / 7.0
                val px = (a.x + (b.x - a.x) * t) * w
                val py = (a.y + (b.y - a.y) * t) * h
                val inX = (px + ux * 4.0).toInt().coerceIn(0, w - 1)
                val inY = (py + uy * 4.0).toInt().coerceIn(0, h - 1)
                val outX = (px - ux * 4.0).toInt().coerceIn(0, w - 1)
                val outY = (py - uy * 4.0).toInt().coerceIn(0, h - 1)
                val inVal = gray.get(inY, inX)?.get(0) ?: 128.0
                val outVal = gray.get(outY, outX)?.get(0) ?: 128.0
                gradientSum += abs(inVal - outVal) / 255.0
                samples++
            }
        }
        val contrastScore = if (samples > 0) (gradientSum / samples).toFloat().coerceIn(0f, 1f) else 0f
        val marginPenalty = if (quad.touchesOuterMargin()) 0.85f else 1.0f
        return ((areaScore * 0.55f) + (contrastScore * 0.45f)) * marginPenalty
    }

    private fun Point.distanceSq(other: Point): Double {
        val dx = x - other.x
        val dy = y - other.y
        return dx * dx + dy * dy
    }

    private fun normalizeAngleDiff(angle: Double): Double {
        var a = angle
        while (a <= -Math.PI) a += 2 * Math.PI
        while (a > Math.PI) a -= 2 * Math.PI
        return a
    }

    private fun intersectSegmentsAsLines(p1: Point, p2: Point, p3: Point, p4: Point): Point? {
        val denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x)
        if (abs(denom) < 1e-6) return null
        val t1 = p1.x * p2.y - p1.y * p2.x
        val t2 = p3.x * p4.y - p3.y * p4.x
        val px = (t1 * (p3.x - p4.x) - (p1.x - p2.x) * t2) / denom
        val py = (t1 * (p3.y - p4.y) - (p1.y - p2.y) * t2) / denom
        return Point(px, py)
    }
}
