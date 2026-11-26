package org.intabtools.intabpdf.scanner.vision

import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

data class NormalizedPoint(
    val x: Float,
    val y: Float,
) {
    fun clamped(): NormalizedPoint = NormalizedPoint(
        x = x.coerceIn(0f, 1f),
        y = y.coerceIn(0f, 1f),
    )

    fun distanceTo(other: NormalizedPoint): Float =
        hypot(x - other.x, y - other.y)

    fun lerpTo(target: NormalizedPoint, factor: Float): NormalizedPoint {
        val f = factor.coerceIn(0f, 1f)
        return NormalizedPoint(
            x = x + (target.x - x) * f,
            y = y + (target.y - y) * f,
        )
    }
}

/**
 * Normalized clockwise document quadrilateral in [0f..1f] coordinates:
 * topLeft -> topRight -> bottomRight -> bottomLeft.
 */
data class NormalizedQuad(
    val topLeft: NormalizedPoint,
    val topRight: NormalizedPoint,
    val bottomRight: NormalizedPoint,
    val bottomLeft: NormalizedPoint,
) {
    fun points(): List<NormalizedPoint> = listOf(topLeft, topRight, bottomRight, bottomLeft)

    fun areaFraction(): Float {
        val pts = points()
        var twiceArea = 0f
        for (i in pts.indices) {
            val a = pts[i]
            val b = pts[(i + 1) % pts.size]
            twiceArea += (a.x * b.y) - (b.x * a.y)
        }
        return abs(twiceArea) * 0.5f
    }

    fun maxCornerDistance(other: NormalizedQuad): Float = maxOf(
        topLeft.distanceTo(other.topLeft),
        topRight.distanceTo(other.topRight),
        bottomRight.distanceTo(other.bottomRight),
        bottomLeft.distanceTo(other.bottomLeft),
    )

    fun lerpTo(target: NormalizedQuad, factor: Float): NormalizedQuad = NormalizedQuad(
        topLeft = topLeft.lerpTo(target.topLeft, factor),
        topRight = topRight.lerpTo(target.topRight, factor),
        bottomRight = bottomRight.lerpTo(target.bottomRight, factor),
        bottomLeft = bottomLeft.lerpTo(target.bottomLeft, factor),
    )

    /**
     * Returns the cyclic corner rotation of this quad that minimizes total corner distance to
     * [reference], preserving clockwise winding while preventing ~45-degree corner-index flips.
     */
    fun alignCornersTo(reference: NormalizedQuad): NormalizedQuad {
        val pts = points()
        val refPts = reference.points()
        var bestShift = 0
        var bestCost = Float.MAX_VALUE
        for (shift in 0 until 4) {
            var cost = 0f
            for (i in 0 until 4) {
                cost += pts[(shift + i) % 4].distanceTo(refPts[i])
            }
            if (cost < bestCost) {
                bestCost = cost
                bestShift = shift
            }
        }
        return if (bestShift == 0) {
            this
        } else {
            NormalizedQuad(
                topLeft = pts[bestShift],
                topRight = pts[(bestShift + 1) % 4],
                bottomRight = pts[(bestShift + 2) % 4],
                bottomLeft = pts[(bestShift + 3) % 4],
            )
        }
    }

    fun touchesOuterMargin(margin: Float = 0.015f): Boolean {
        val limitHigh = 1f - margin
        return points().any { p ->
            p.x <= margin || p.y <= margin || p.x >= limitHigh || p.y >= limitHigh
        }
    }

    fun isValidConvex(
        minAreaFraction: Float = 0.04f,
        maxAreaFraction: Float = 0.98f,
        minAngleDeg: Float = 22f,
        maxAngleDeg: Float = 158f,
        minEdgeLength: Float = 0.06f,
    ): Boolean {
        val pts = points()
        if (pts.any { !it.x.isFinite() || !it.y.isFinite() || it.x < -0.02f || it.y < -0.02f || it.x > 1.02f || it.y > 1.02f }) {
            return false
        }

        val area = areaFraction()
        if (area < minAreaFraction || area > maxAreaFraction) {
            return false
        }

        var expectedSign = 0
        for (i in pts.indices) {
            val prev = pts[(i + 3) % 4]
            val curr = pts[i]
            val next = pts[(i + 1) % 4]

            val edgeLen = curr.distanceTo(next)
            if (edgeLen < minEdgeLength) return false

            val v1x = prev.x - curr.x
            val v1y = prev.y - curr.y
            val v2x = next.x - curr.x
            val v2y = next.y - curr.y

            val cross = v1x * v2y - v1y * v2x
            val sign = when {
                cross > 1e-6f -> 1
                cross < -1e-6f -> -1
                else -> return false
            }
            if (expectedSign == 0) {
                expectedSign = sign
            } else if (expectedSign != sign) {
                return false
            }

            val len1 = hypot(v1x, v1y)
            val len2 = hypot(v2x, v2y)
            if (len1 <= 1e-6f || len2 <= 1e-6f) return false

            val cosAngle = ((v1x * v2x + v1y * v2y) / (len1 * len2)).coerceIn(-1f, 1f)
            val angleDeg = Math.toDegrees(acos(cosAngle.toDouble())).toFloat()
            if (angleDeg < minAngleDeg || angleDeg > maxAngleDeg) {
                return false
            }
        }
        return true
    }

    companion object {
        fun fullFrame(): NormalizedQuad = NormalizedQuad(
            topLeft = NormalizedPoint(0f, 0f),
            topRight = NormalizedPoint(1f, 0f),
            bottomRight = NormalizedPoint(1f, 1f),
            bottomLeft = NormalizedPoint(0f, 1f),
        )

        fun defaultInset(margin: Float = 0.06f): NormalizedQuad {
            val m = margin.coerceIn(0f, 0.25f)
            val far = 1f - m
            return NormalizedQuad(
                topLeft = NormalizedPoint(m, m),
                topRight = NormalizedPoint(far, m),
                bottomRight = NormalizedPoint(far, far),
                bottomLeft = NormalizedPoint(m, far),
            )
        }

        /**
         * Orders an arbitrary list of 4 normalized points into clockwise screen order:
         * topLeft, topRight, bottomRight, bottomLeft.
         */
        fun orderClockwise(points: List<NormalizedPoint>): NormalizedQuad? {
            if (points.size != 4) return null
            val cx = points.sumOf { it.x.toDouble() }.toFloat() / 4f
            val cy = points.sumOf { it.y.toDouble() }.toFloat() / 4f

            // In image coordinates (x right, y down), increasing atan2(y - cy, x - cx) goes clockwise.
            val sorted = points.sortedBy { p -> atan2((p.y - cy).toDouble(), (p.x - cx).toDouble()) }
            val topLeftIndex = sorted.indices.minByOrNull { idx ->
                val p = sorted[idx]
                p.x + p.y
            } ?: return null

            val ordered = (0 until 4).map { offset -> sorted[(topLeftIndex + offset) % 4].clamped() }
            val quad = NormalizedQuad(
                topLeft = ordered[0],
                topRight = ordered[1],
                bottomRight = ordered[2],
                bottomLeft = ordered[3],
            )
            // Ensure consistent clockwise winding; if topRight is below bottomLeft on edge shapes, verify sum/diff check
            return if (quad.isValidConvex(minAreaFraction = 0.001f, maxAreaFraction = 1.0f, minAngleDeg = 5f, maxAngleDeg = 175f, minEdgeLength = 0.01f)) {
                quad
            } else {
                // Fallback sum-and-difference corner ordering for highly skewed perspectives
                val tl = points.minByOrNull { it.x + it.y } ?: return null
                val br = points.maxByOrNull { it.x + it.y } ?: return null
                val remaining = points.filter { it !== tl && it !== br }
                if (remaining.size != 2) return null
                val tr = if (remaining[0].x - remaining[0].y >= remaining[1].x - remaining[1].y) remaining[0] else remaining[1]
                val bl = if (tr === remaining[0]) remaining[1] else remaining[0]
                NormalizedQuad(tl.clamped(), tr.clamped(), br.clamped(), bl.clamped())
            }
        }
    }
}
