package org.intabtools.intabpdf.scanner.imaging

import androidx.exifinterface.media.ExifInterface
import org.intabtools.intabpdf.scanner.vision.ImageDimensions
import org.intabtools.intabpdf.scanner.vision.NormalizedPoint
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import org.junit.Assert.assertEquals
import org.junit.Test

class ImageOrientationTest {

    @Test
    fun `normalizeRotationDegrees snaps to orthogonal 90 degree increments`() {
        assertEquals(0, ImageOrientation.normalizeRotationDegrees(0))
        assertEquals(90, ImageOrientation.normalizeRotationDegrees(90))
        assertEquals(180, ImageOrientation.normalizeRotationDegrees(180))
        assertEquals(270, ImageOrientation.normalizeRotationDegrees(270))
        assertEquals(270, ImageOrientation.normalizeRotationDegrees(-90))
        assertEquals(90, ImageOrientation.normalizeRotationDegrees(450))
    }

    @Test
    fun `effectiveDimensions and exifOrientedDimensions handle swaps across all orthogonal and transpose tags`() {
        assertEquals(ImageDimensions(1200, 1600), ImageOrientation.effectiveDimensions(1600, 1200, 90))
        assertEquals(ImageDimensions(1600, 1200), ImageOrientation.effectiveDimensions(1600, 1200, 180))

        assertEquals(ImageDimensions(1200, 1600), ImageOrientation.exifOrientedDimensions(1600, 1200, ExifInterface.ORIENTATION_ROTATE_90))
        assertEquals(ImageDimensions(1200, 1600), ImageOrientation.exifOrientedDimensions(1600, 1200, ExifInterface.ORIENTATION_TRANSPOSE))
        assertEquals(ImageDimensions(1200, 1600), ImageOrientation.exifOrientedDimensions(1600, 1200, ExifInterface.ORIENTATION_TRANSVERSE))
        assertEquals(ImageDimensions(1600, 1200), ImageOrientation.exifOrientedDimensions(1600, 1200, ExifInterface.ORIENTATION_FLIP_HORIZONTAL))
    }

    @Test
    fun `rotateQuadClockwise and unrotateQuadClockwise are lossless inverses`() {
        val original = NormalizedQuad(
            topLeft = NormalizedPoint(0.10f, 0.20f),
            topRight = NormalizedPoint(0.70f, 0.15f),
            bottomRight = NormalizedPoint(0.75f, 0.85f),
            bottomLeft = NormalizedPoint(0.12f, 0.80f),
        )

        for (deg in listOf(90, 180, 270)) {
            val rotated = ImageOrientation.rotateQuadClockwise(original, deg)
            val restored = ImageOrientation.unrotateQuadClockwise(rotated, deg)

            assertEquals(original.topLeft.x, restored.topLeft.x, 1e-4f)
            assertEquals(original.topLeft.y, restored.topLeft.y, 1e-4f)
            assertEquals(original.bottomRight.x, restored.bottomRight.x, 1e-4f)
            assertEquals(original.bottomRight.y, restored.bottomRight.y, 1e-4f)
        }
    }
}
