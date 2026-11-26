package org.intabtools.intabpdf.scanner.vision

import org.intabtools.intabpdf.scanner.imaging.ImageOrientation
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

enum class CropHandle {
    TOP_LEFT,
    TOP_RIGHT,
    BOTTOM_RIGHT,
    BOTTOM_LEFT,
}

data class NormalizedRect(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
) {
    val width: Float get() = (right - left).coerceAtLeast(0f)
    val height: Float get() = (bottom - top).coerceAtLeast(0f)
}

/**
 * Pure normalized and viewport geometry helpers for the interactive Crop & Perspective Editor.
 * Enforces non-crossing convex quads, rotation-aware coordinate projection, and loupe framing.
 */
object CropGeometry {

    fun visibleQuadFromSource(sourceQuad: NormalizedQuad, rotationDegrees: Int): NormalizedQuad =
        ImageOrientation.rotateQuadClockwise(sourceQuad, rotationDegrees)

    fun sourceQuadFromVisible(visibleQuad: NormalizedQuad, rotationDegrees: Int): NormalizedQuad =
        ImageOrientation.unrotateQuadClockwise(visibleQuad, rotationDegrees)

    fun getCorner(quad: NormalizedQuad, handle: CropHandle): NormalizedPoint = when (handle) {
        CropHandle.TOP_LEFT -> quad.topLeft
        CropHandle.TOP_RIGHT -> quad.topRight
        CropHandle.BOTTOM_RIGHT -> quad.bottomRight
        CropHandle.BOTTOM_LEFT -> quad.bottomLeft
    }

    fun withCorner(quad: NormalizedQuad, handle: CropHandle, point: NormalizedPoint): NormalizedQuad {
        val clamped = point.clamped()
        return when (handle) {
            CropHandle.TOP_LEFT -> quad.copy(topLeft = clamped)
            CropHandle.TOP_RIGHT -> quad.copy(topRight = clamped)
            CropHandle.BOTTOM_RIGHT -> quad.copy(bottomRight = clamped)
            CropHandle.BOTTOM_LEFT -> quad.copy(bottomLeft = clamped)
        }
    }

    /**
     * Validates that the 4 corners form a non-degenerate convex clockwise quadrilateral whose
     * opposite edges do not intersect or twist into a bowtie.
     */
    fun isValidEditableQuad(
        quad: NormalizedQuad,
        minAreaFraction: Float = 0.04f,
        minEdgeLength: Float = 0.08f,
        minAngleDeg: Float = 18f,
        maxAngleDeg: Float = 162f,
    ): Boolean {
        if (!quad.isValidConvex(
                minAreaFraction = minAreaFraction,
                maxAreaFraction = 1.0f,
                minAngleDeg = minAngleDeg,
                maxAngleDeg = maxAngleDeg,
                minEdgeLength = minEdgeLength,
            )
        ) {
            return false
        }

        // In normalized image space (x right, y down), strictly enforce negative signed cross product
        // (corresponding to clockwise order topLeft -> topRight -> bottomRight -> bottomLeft)
        // AND confirm opposite edges never cross.
        val pts = quad.points()
        val firstTurn = signedCross(pts[3], pts[0], pts[1])
        if (firstTurn >= -1e-6f) return false

        if (segmentsIntersect(quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft)) return false
        if (segmentsIntersect(quad.topRight, quad.bottomRight, quad.bottomLeft, quad.topLeft)) return false

        return true
    }

    /**
     * Moves [handle] toward [candidatePoint] while preventing corner crossing, edge inversion,
     * or collapsed quads. If the exact candidate violates geometry, steps cleanly along the
     * segment from current corner to [candidatePoint] to find the nearest valid limit.
     */
    fun updateCornerSafely(
        current: NormalizedQuad,
        handle: CropHandle,
        candidatePoint: NormalizedPoint,
    ): NormalizedQuad {
        val target = candidatePoint.clamped()
        val direct = withCorner(current, handle, target)
        if (isValidEditableQuad(direct)) return direct

        val start = getCorner(current, handle)
        var low = 0f
        var high = 1f
        var bestQuad = current
        repeat(8) {
            val mid = (low + high) * 0.5f
            val probePoint = start.lerpTo(target, mid)
            val probeQuad = withCorner(current, handle, probePoint)
            if (isValidEditableQuad(probeQuad)) {
                bestQuad = probeQuad
                low = mid
            } else {
                high = mid
            }
        }
        return bestQuad
    }

    /**
     * Inverse of [CoordinateTransform.mapNormalizedToFitCenterCanvas], converting a canvas pixel
     * position back into normalized [0f..1f] coordinates within the FIT_CENTER displayed image.
     */
    fun canvasPointToNormalizedImagePoint(
        canvasX: Float,
        canvasY: Float,
        imageAspectRatio: Float,
        canvasWidth: Float,
        canvasHeight: Float,
    ): NormalizedPoint? {
        if (canvasWidth <= 0f || canvasHeight <= 0f || imageAspectRatio <= 0f) return null
        val canvasAspect = canvasWidth / canvasHeight
        val contentWidth: Float
        val contentHeight: Float
        val offsetX: Float
        val offsetY: Float

        if (canvasAspect > imageAspectRatio) {
            contentHeight = canvasHeight
            contentWidth = canvasHeight * imageAspectRatio
            offsetX = (canvasWidth - contentWidth) * 0.5f
            offsetY = 0f
        } else {
            contentWidth = canvasWidth
            contentHeight = canvasWidth / imageAspectRatio
            offsetX = 0f
            offsetY = (canvasHeight - contentHeight) * 0.5f
        }

        val normX = ((canvasX - offsetX) / contentWidth).coerceIn(0f, 1f)
        val normY = ((canvasY - offsetY) / contentHeight).coerceIn(0f, 1f)
        return NormalizedPoint(normX, normY)
    }

    fun findClosestHandle(
        tapX: Float,
        tapY: Float,
        quad: NormalizedQuad,
        imageAspectRatio: Float,
        canvasWidth: Float,
        canvasHeight: Float,
        maxDistancePx: Float,
    ): CropHandle? {
        val handles = listOf(
            CropHandle.TOP_LEFT to quad.topLeft,
            CropHandle.TOP_RIGHT to quad.topRight,
            CropHandle.BOTTOM_RIGHT to quad.bottomRight,
            CropHandle.BOTTOM_LEFT to quad.bottomLeft,
        )
        var bestHandle: CropHandle? = null
        var bestDist = maxDistancePx
        for ((handle, normPt) in handles) {
            val canvasPt = CoordinateTransform.mapNormalizedToFitCenterCanvas(
                point = normPt,
                imageAspectRatio = imageAspectRatio,
                canvasWidth = canvasWidth,
                canvasHeight = canvasHeight,
            )
            val dist = kotlin.math.hypot(tapX - canvasPt.x, tapY - canvasPt.y)
            if (dist <= bestDist) {
                bestDist = dist
                bestHandle = handle
            }
        }
        return bestHandle
    }

    /**
     * Computes a square normalized viewport rectangle centered on [focus] for the zoomed loupe.
     */
    fun computeLoupeSourceRect(
        focus: NormalizedPoint,
        halfWidth: Float = 0.12f,
        halfHeight: Float = 0.12f,
    ): NormalizedRect {
        val hw = halfWidth.coerceIn(0.04f, 0.45f)
        val hh = halfHeight.coerceIn(0.04f, 0.45f)
        val left = (focus.x - hw).coerceIn(0f, 1f - hw * 2f)
        val top = (focus.y - hh).coerceIn(0f, 1f - hh * 2f)
        return NormalizedRect(
            left = left,
            top = top,
            right = (left + hw * 2f).coerceAtMost(1f),
            bottom = (top + hh * 2f).coerceAtMost(1f),
        )
    }

    private fun signedCross(a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint): Float {
        // Cross product of (a -> b) x (b -> c) for clockwise checking in y-down space:
        // Wait: (a - b) and (c - b) yields positive clockwise winding consistent with NormalizedQuad.isValidConvex
        val v1x = a.x - b.x
        val v1y = a.y - b.y
        val v2x = c.x - b.x
        val v2y = c.y - b.y
        return v1x * v2y - v1y * v2x
    }

    private fun segmentsIntersect(
        a1: NormalizedPoint,
        a2: NormalizedPoint,
        b1: NormalizedPoint,
        b2: NormalizedPoint,
    ): Boolean {
        val d1 = orient(b1, b2, a1)
        val d2 = orient(b1, b2, a2)
        val d3 = orient(a1, a2, b1)
        val d4 = orient(a1, a2, b2)

        if (((d1 > 0f && d2 < 0f) || (d1 < 0f && d2 > 0f)) &&
            ((d3 > 0f && d4 < 0f) || (d3 < 0f && d4 > 0f))
        ) {
            return true
        }
        if (abs(d1) <= 1e-6f && onSegment(b1, a1, b2)) return true
        if (abs(d2) <= 1e-6f && onSegment(b1, a2, b2)) return true
        if (abs(d3) <= 1e-6f && onSegment(a1, b1, a2)) return true
        if (abs(d4) <= 1e-6f && onSegment(a1, b2, a2)) return true
        return false
    }

    private fun orient(a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint): Float =
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

    private fun onSegment(a: NormalizedPoint, p: NormalizedPoint, b: NormalizedPoint): Boolean =
        p.x <= max(a.x, b.x) + 1e-6f && p.x >= min(a.x, b.x) - 1e-6f &&
            p.y <= max(a.y, b.y) + 1e-6f && p.y >= min(a.y, b.y) - 1e-6f
}
