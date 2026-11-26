package org.intabtools.intabpdf.scanner.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class CoordinateTransformTest {

    @Test
    fun `rotatedDimensions swaps width and height for 90 and 270 degrees`() {
        assertEquals(ImageDimensions(640, 480), CoordinateTransform.rotatedDimensions(640, 480, 0))
        assertEquals(ImageDimensions(480, 640), CoordinateTransform.rotatedDimensions(640, 480, 90))
        assertEquals(ImageDimensions(640, 480), CoordinateTransform.rotatedDimensions(640, 480, 180))
        assertEquals(ImageDimensions(480, 640), CoordinateTransform.rotatedDimensions(640, 480, 270))
        assertEquals(ImageDimensions(480, 640), CoordinateTransform.rotatedDimensions(640, 480, -90))
    }

    @Test
    fun `rotateNormalizedPoint accurately maps across 0 90 180 270`() {
        val pt = NormalizedPoint(0.2f, 0.3f)

        val r0 = CoordinateTransform.rotateNormalizedPoint(pt, 0)
        assertEquals(0.2f, r0.x, 1e-5f)
        assertEquals(0.3f, r0.y, 1e-5f)

        val r90 = CoordinateTransform.rotateNormalizedPoint(pt, 90)
        assertEquals(0.7f, r90.x, 1e-5f)
        assertEquals(0.2f, r90.y, 1e-5f)

        val r180 = CoordinateTransform.rotateNormalizedPoint(pt, 180)
        assertEquals(0.8f, r180.x, 1e-5f)
        assertEquals(0.7f, r180.y, 1e-5f)

        val r270 = CoordinateTransform.rotateNormalizedPoint(pt, 270)
        assertEquals(0.3f, r270.x, 1e-5f)
        assertEquals(0.8f, r270.y, 1e-5f)
    }

    @Test
    fun `rotateNormalizedQuad re-orders corners clockwise after 90 degree rotation`() {
        val sensorQuad = NormalizedQuad(
            topLeft = NormalizedPoint(0.1f, 0.2f),
            topRight = NormalizedPoint(0.8f, 0.2f),
            bottomRight = NormalizedPoint(0.8f, 0.9f),
            bottomLeft = NormalizedPoint(0.1f, 0.9f),
        )

        val upright = CoordinateTransform.rotateNormalizedQuad(sensorQuad, 90)
        assertNotNull(upright)
        upright!!
        // After 90 CW rotation, upright TL came from sensor BL (0.1, 0.9) -> (0.1, 0.1)
        assertEquals(0.1f, upright.topLeft.x, 1e-4f)
        assertEquals(0.1f, upright.topLeft.y, 1e-4f)
        assertEquals(0.8f, upright.topRight.x, 1e-4f)
        assertEquals(0.1f, upright.topRight.y, 1e-4f)
        assertEquals(0.8f, upright.bottomRight.x, 1e-4f)
        assertEquals(0.8f, upright.bottomRight.y, 1e-4f)
        assertEquals(0.1f, upright.bottomLeft.x, 1e-4f)
        assertEquals(0.8f, upright.bottomLeft.y, 1e-4f)
    }

    @Test
    fun `mapNormalizedToFitCenterCanvas centers content for pillarbox and letterbox viewports`() {
        // 3:4 portrait image inside a wide 1000x800 canvas -> height=800, width=600, offsetX=200
        val pillarLeft = CoordinateTransform.mapNormalizedToFitCenterCanvas(
            point = NormalizedPoint(0f, 0f),
            imageAspectRatio = 0.75f,
            canvasWidth = 1000f,
            canvasHeight = 800f,
        )
        assertEquals(200f, pillarLeft.x, 1e-3f)
        assertEquals(0f, pillarLeft.y, 1e-3f)

        val pillarRight = CoordinateTransform.mapNormalizedToFitCenterCanvas(
            point = NormalizedPoint(1f, 1f),
            imageAspectRatio = 0.75f,
            canvasWidth = 1000f,
            canvasHeight = 800f,
        )
        assertEquals(800f, pillarRight.x, 1e-3f)
        assertEquals(800f, pillarRight.y, 1e-3f)

        // 3:4 portrait image inside a narrow tall 600x1000 canvas -> width=600, height=800, offsetY=100
        val letterTop = CoordinateTransform.mapNormalizedToFitCenterCanvas(
            point = NormalizedPoint(0f, 0f),
            imageAspectRatio = 0.75f,
            canvasWidth = 600f,
            canvasHeight = 1000f,
        )
        assertEquals(0f, letterTop.x, 1e-3f)
        assertEquals(100f, letterTop.y, 1e-3f)

        val letterBottom = CoordinateTransform.mapNormalizedToFitCenterCanvas(
            point = NormalizedPoint(1f, 1f),
            imageAspectRatio = 0.75f,
            canvasWidth = 600f,
            canvasHeight = 1000f,
        )
        assertEquals(600f, letterBottom.x, 1e-3f)
        assertEquals(900f, letterBottom.y, 1e-3f)
    }
}
