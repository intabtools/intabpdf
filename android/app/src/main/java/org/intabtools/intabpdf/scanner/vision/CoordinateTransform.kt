package org.intabtools.intabpdf.scanner.vision

data class CanvasPoint(
    val x: Float,
    val y: Float,
)

data class ImageDimensions(
    val width: Int,
    val height: Int,
)

/**
 * Pure geometry helpers mapping CameraX analysis-buffer coordinates (across rotation and
 * aspect-ratio letterboxing) accurately onto PreviewView / Compose Canvas pixel space.
 */
object CoordinateTransform {

    fun rotatedDimensions(rawWidth: Int, rawHeight: Int, rotationDegrees: Int): ImageDimensions {
        val normalizedRot = ((rotationDegrees % 360) + 360) % 360
        return if (normalizedRot == 90 || normalizedRot == 270) {
            ImageDimensions(width = rawHeight, height = rawWidth)
        } else {
            ImageDimensions(width = rawWidth, height = rawHeight)
        }
    }

    /**
     * Rotates a normalized point from raw sensor buffer space ([0..1] in unrotated ImageProxy)
     * into upright display normalized coordinates after applying clockwise [rotationDegrees].
     */
    fun rotateNormalizedPoint(point: NormalizedPoint, rotationDegrees: Int): NormalizedPoint {
        val rot = ((rotationDegrees % 360) + 360) % 360
        return when (rot) {
            90 -> NormalizedPoint(x = 1f - point.y, y = point.x).clamped()
            180 -> NormalizedPoint(x = 1f - point.x, y = 1f - point.y).clamped()
            270 -> NormalizedPoint(x = point.y, y = 1f - point.x).clamped()
            else -> point.clamped()
        }
    }

    fun rotateNormalizedQuad(quad: NormalizedQuad, rotationDegrees: Int): NormalizedQuad? {
        val rotated = quad.points().map { rotateNormalizedPoint(it, rotationDegrees) }
        return NormalizedQuad.orderClockwise(rotated)
    }

    /**
     * Maps an upright normalized point ([0..1]) into a [canvasWidth] x [canvasHeight] viewport
     * displaying an image of [imageAspectRatio] (width / height) using FIT_CENTER scaling.
     */
    fun mapNormalizedToFitCenterCanvas(
        point: NormalizedPoint,
        imageAspectRatio: Float,
        canvasWidth: Float,
        canvasHeight: Float,
    ): CanvasPoint {
        if (canvasWidth <= 0f || canvasHeight <= 0f || imageAspectRatio <= 0f) {
            return CanvasPoint(0f, 0f)
        }
        val canvasAspect = canvasWidth / canvasHeight
        val contentWidth: Float
        val contentHeight: Float
        val offsetX: Float
        val offsetY: Float

        if (canvasAspect > imageAspectRatio) {
            // Pillarbox left/right
            contentHeight = canvasHeight
            contentWidth = canvasHeight * imageAspectRatio
            offsetX = (canvasWidth - contentWidth) * 0.5f
            offsetY = 0f
        } else {
            // Letterbox top/bottom
            contentWidth = canvasWidth
            contentHeight = canvasWidth / imageAspectRatio
            offsetX = 0f
            offsetY = (canvasHeight - contentHeight) * 0.5f
        }

        return CanvasPoint(
            x = offsetX + point.x * contentWidth,
            y = offsetY + point.y * contentHeight,
        )
    }

    fun mapQuadToFitCenterCanvas(
        quad: NormalizedQuad,
        imageAspectRatio: Float,
        canvasWidth: Float,
        canvasHeight: Float,
    ): List<CanvasPoint> = quad.points().map {
        mapNormalizedToFitCenterCanvas(it, imageAspectRatio, canvasWidth, canvasHeight)
    }
}
