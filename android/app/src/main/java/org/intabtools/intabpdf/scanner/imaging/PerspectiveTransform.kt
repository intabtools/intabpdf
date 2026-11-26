package org.intabtools.intabpdf.scanner.imaging

import org.intabtools.intabpdf.scanner.vision.ImageDimensions
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Clean-room perspective rectification utilities transforming a source OpenCV Mat and
 * normalized quadrilateral into a flat upright document image.
 */
object PerspectiveTransform {

    /**
     * Estimates clean target output dimensions from quad corner edge lengths in source pixels,
     * applying aspect-bounded pixel limits without over-distorting perspective tilts.
     */
    fun estimateWarpedDimensions(
        quad: NormalizedQuad,
        sourceWidth: Int,
        sourceHeight: Int,
        maxOutputPixels: Long,
    ): ImageDimensions {
        val w = sourceWidth.coerceAtLeast(1).toFloat()
        val h = sourceHeight.coerceAtLeast(1).toFloat()

        val tlX = quad.topLeft.x * w
        val tlY = quad.topLeft.y * h
        val trX = quad.topRight.x * w
        val trY = quad.topRight.y * h
        val brX = quad.bottomRight.x * w
        val brY = quad.bottomRight.y * h
        val blX = quad.bottomLeft.x * w
        val blY = quad.bottomLeft.y * h

        val topWidth = hypot(trX - tlX, trY - tlY)
        val bottomWidth = hypot(brX - blX, brY - blY)
        val leftHeight = hypot(blX - tlX, blY - tlY)
        val rightHeight = hypot(brX - trX, brY - trY)

        // Blend mean & max slightly toward max to compensate perspective foreshortening cleanly
        val estWidth = (0.35f * (topWidth + bottomWidth) * 0.5f + 0.65f * max(topWidth, bottomWidth)).coerceAtLeast(64f)
        val estHeight = (0.35f * (leftHeight + rightHeight) * 0.5f + 0.65f * max(leftHeight, rightHeight)).coerceAtLeast(64f)

        val rawPixels = estWidth.toDouble() * estHeight.toDouble()
        val scale = if (rawPixels > maxOutputPixels.toDouble() && maxOutputPixels > 0L) {
            sqrt(maxOutputPixels.toDouble() / rawPixels)
        } else {
            1.0
        }

        val outW = (estWidth * scale).roundToInt().coerceAtLeast(64)
        val outH = (estHeight * scale).roundToInt().coerceAtLeast(64)
        return ImageDimensions(width = outW, height = outH)
    }

    /**
     * Executes OpenCV projective warp from [quad] on [sourceBgrOrRgba] into a new Mat
     * of size [targetDimensions]. Caller owns and must release the returned Mat.
     */
    fun warpDocument(
        sourceMat: Mat,
        quad: NormalizedQuad,
        targetDimensions: ImageDimensions,
    ): Mat {
        val srcW = sourceMat.cols().toDouble()
        val srcH = sourceMat.rows().toDouble()
        val dstW = targetDimensions.width.toDouble()
        val dstH = targetDimensions.height.toDouble()

        val srcPts = MatOfPoint2f(
            Point(quad.topLeft.x * srcW, quad.topLeft.y * srcH),
            Point(quad.topRight.x * srcW, quad.topRight.y * srcH),
            Point(quad.bottomRight.x * srcW, quad.bottomRight.y * srcH),
            Point(quad.bottomLeft.x * srcW, quad.bottomLeft.y * srcH),
        )
        val dstPts = MatOfPoint2f(
            Point(0.0, 0.0),
            Point(dstW - 1.0, 0.0),
            Point(dstW - 1.0, dstH - 1.0),
            Point(0.0, dstH - 1.0),
        )
        val transform = Imgproc.getPerspectiveTransform(srcPts, dstPts)
        val warped = Mat()
        try {
            val interpolation = if (dstW * dstH > srcW * srcH * quad.areaFraction().toDouble()) {
                Imgproc.INTER_CUBIC
            } else {
                Imgproc.INTER_LINEAR
            }
            Imgproc.warpPerspective(
                sourceMat,
                warped,
                transform,
                Size(dstW, dstH),
                interpolation,
                org.opencv.core.Core.BORDER_REPLICATE,
            )
            return warped
        } finally {
            srcPts.release()
            dstPts.release()
            transform.release()
        }
    }
}
