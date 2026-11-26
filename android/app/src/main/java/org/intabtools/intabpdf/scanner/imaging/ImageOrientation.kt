package org.intabtools.intabpdf.scanner.imaging

import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import org.intabtools.intabpdf.scanner.vision.ImageDimensions
import org.intabtools.intabpdf.scanner.vision.NormalizedPoint
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import org.opencv.core.Core
import org.opencv.core.Mat

/**
 * Pure geometry and Android EXIF orientation helpers for non-destructive document rotation.
 * Supports all 8 standard EXIF orientation tags and reversible 90-degree page rotations.
 */
object ImageOrientation {

    fun normalizeRotationDegrees(degrees: Int): Int {
        val snapped = ((degrees % 360) + 360) % 360
        return when (snapped) {
            in 45..134 -> 90
            in 135..224 -> 180
            in 225..314 -> 270
            else -> 0
        }
    }

    fun effectiveDimensions(width: Int, height: Int, rotationDegrees: Int): ImageDimensions {
        val rot = normalizeRotationDegrees(rotationDegrees)
        return if (rot == 90 || rot == 270) {
            ImageDimensions(width = height, height = width)
        } else {
            ImageDimensions(width = width, height = height)
        }
    }

    /**
     * Rotates a normalized quad in visible image space clockwise by [deltaDegrees]
     * (used to translate crop coordinates between rotated preview and upright source orientation).
     */
    fun rotateQuadClockwise(quad: NormalizedQuad, deltaDegrees: Int): NormalizedQuad {
        val rot = normalizeRotationDegrees(deltaDegrees)
        if (rot == 0) return quad

        fun rotatePoint(p: NormalizedPoint): NormalizedPoint = when (rot) {
            90 -> NormalizedPoint(1f - p.y, p.x).clamped()
            180 -> NormalizedPoint(1f - p.x, 1f - p.y).clamped()
            270 -> NormalizedPoint(p.y, 1f - p.x).clamped()
            else -> p.clamped()
        }

        val pts = quad.points().map(::rotatePoint)
        return NormalizedQuad.orderClockwise(pts) ?: quad
    }

    fun unrotateQuadClockwise(quad: NormalizedQuad, appliedDegrees: Int): NormalizedQuad {
        val inverse = (360 - normalizeRotationDegrees(appliedDegrees)) % 360
        return rotateQuadClockwise(quad, inverse)
    }

    fun rotateMatInPlaceOrClone(src: Mat, rotationDegrees: Int): Mat {
        val rot = normalizeRotationDegrees(rotationDegrees)
        if (rot == 0) return src.clone()
        val dst = Mat()
        val flag = when (rot) {
            90 -> Core.ROTATE_90_CLOCKWISE
            180 -> Core.ROTATE_180
            270 -> Core.ROTATE_90_COUNTERCLOCKWISE
            else -> return src.clone()
        }
        Core.rotate(src, dst, flag)
        return dst
    }

    fun buildExifTransformMatrix(exifOrientation: Int): Matrix = Matrix().apply {
        when (exifOrientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                postRotate(90f)
                postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                postRotate(270f)
                postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(270f)
            else -> Unit
        }
    }

    fun applyExifOrientation(bitmap: Bitmap, exifOrientation: Int): Bitmap {
        if (exifOrientation == ExifInterface.ORIENTATION_NORMAL || exifOrientation == ExifInterface.ORIENTATION_UNDEFINED) {
            return bitmap
        }
        val matrix = buildExifTransformMatrix(exifOrientation)
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    fun exifOrientedDimensions(rawWidth: Int, rawHeight: Int, exifOrientation: Int): ImageDimensions {
        return when (exifOrientation) {
            ExifInterface.ORIENTATION_ROTATE_90,
            ExifInterface.ORIENTATION_ROTATE_270,
            ExifInterface.ORIENTATION_TRANSPOSE,
            ExifInterface.ORIENTATION_TRANSVERSE -> ImageDimensions(rawHeight, rawWidth)
            else -> ImageDimensions(rawWidth, rawHeight)
        }
    }
}
