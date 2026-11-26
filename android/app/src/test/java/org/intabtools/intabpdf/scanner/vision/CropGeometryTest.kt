package org.intabtools.intabpdf.scanner.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CropGeometryTest {

    @Test
    fun isValidEditableQuadRejectsBowtieConcaveTinyAndCounterClockwiseQuads() {
        val valid = NormalizedQuad.defaultInset(0.10f)
        assertTrue(CropGeometry.isValidEditableQuad(valid))

        // Bowtie / crossed corners (topLeft & topRight swapped across bottom edge)
        val bowtie = NormalizedQuad(
            topLeft = NormalizedPoint(0.15f, 0.15f),
            topRight = NormalizedPoint(0.85f, 0.85f),
            bottomRight = NormalizedPoint(0.85f, 0.15f),
            bottomLeft = NormalizedPoint(0.15f, 0.85f),
        )
        assertFalse(CropGeometry.isValidEditableQuad(bowtie))

        // Concave quad (topLeft pushed inward past diagonal TR -> BL)
        val concave = NormalizedQuad(
            topLeft = NormalizedPoint(0.65f, 0.65f),
            topRight = NormalizedPoint(0.90f, 0.10f),
            bottomRight = NormalizedPoint(0.90f, 0.90f),
            bottomLeft = NormalizedPoint(0.10f, 0.90f),
        )
        assertFalse(CropGeometry.isValidEditableQuad(concave))

        // Counterclockwise mirror flip (TL/TR swapped with BL/BR)
        val flipped = NormalizedQuad(
            topLeft = NormalizedPoint(0.10f, 0.90f),
            topRight = NormalizedPoint(0.90f, 0.90f),
            bottomRight = NormalizedPoint(0.90f, 0.10f),
            bottomLeft = NormalizedPoint(0.10f, 0.10f),
        )
        assertFalse(CropGeometry.isValidEditableQuad(flipped))

        // Tiny sub-threshold area
        val tiny = NormalizedQuad(
            topLeft = NormalizedPoint(0.45f, 0.45f),
            topRight = NormalizedPoint(0.55f, 0.45f),
            bottomRight = NormalizedPoint(0.55f, 0.55f),
            bottomLeft = NormalizedPoint(0.45f, 0.55f),
        )
        assertFalse(CropGeometry.isValidEditableQuad(tiny))
    }

    @Test
    fun updateCornerSafelyPreventsCrossingOppositeEdgeWhenDraggedTooFar() {
        val initial = NormalizedQuad(
            topLeft = NormalizedPoint(0.15f, 0.15f),
            topRight = NormalizedPoint(0.85f, 0.15f),
            bottomRight = NormalizedPoint(0.85f, 0.85f),
            bottomLeft = NormalizedPoint(0.15f, 0.85f),
        )

        // Try dragging topLeft all the way past bottomRight (crossing diagonal & edges)
        val clamped = CropGeometry.updateCornerSafely(
            current = initial,
            handle = CropHandle.TOP_LEFT,
            candidatePoint = NormalizedPoint(0.95f, 0.95f),
        )
        assertTrue(
            "Updated quad must remain convex & non-crossing after aggressive corner drag",
            CropGeometry.isValidEditableQuad(clamped),
        )
        assertTrue(clamped.topLeft.x < clamped.topRight.x)
        assertTrue(clamped.topLeft.y < clamped.bottomLeft.y)
    }

    @Test
    fun canvasPointToNormalizedImagePointIsInverseOfFitCenterMapping() {
        val imageAspect = 3f / 4f
        val viewports = listOf(
            1080f to 1920f, // letterboxed (canvas narrower aspect than 3:4 -> top/bottom bars)
            1440f to 1080f, // pillarboxed (canvas wider aspect than 3:4 -> left/right bars)
        )
        val samplePoints = listOf(
            NormalizedPoint(0.12f, 0.18f),
            NormalizedPoint(0.84f, 0.22f),
            NormalizedPoint(0.79f, 0.88f),
            NormalizedPoint(0.25f, 0.75f),
        )

        for ((w, h) in viewports) {
            for (pt in samplePoints) {
                val canvasPt = CoordinateTransform.mapNormalizedToFitCenterCanvas(pt, imageAspect, w, h)
                val roundTripped = CropGeometry.canvasPointToNormalizedImagePoint(canvasPt.x, canvasPt.y, imageAspect, w, h)
                assertNotNull(roundTripped)
                assertEquals(pt.x, roundTripped!!.x, 0.002f)
                assertEquals(pt.y, roundTripped.y, 0.002f)
            }
        }
    }

    @Test
    fun visibleAndSourceCropQuadTransformRoundTripsAcrossAllRotations() {
        val sourceQuad = NormalizedQuad(
            topLeft = NormalizedPoint(0.12f, 0.08f),
            topRight = NormalizedPoint(0.86f, 0.14f),
            bottomRight = NormalizedPoint(0.90f, 0.92f),
            bottomLeft = NormalizedPoint(0.10f, 0.84f),
        )

        for (rotation in listOf(0, 90, 180, 270)) {
            val visible = CropGeometry.visibleQuadFromSource(sourceQuad, rotation)
            val restored = CropGeometry.sourceQuadFromVisible(visible, rotation)
            assertTrue("Restored quad must remain valid for $rotation deg", CropGeometry.isValidEditableQuad(restored))
            assertEquals(sourceQuad.topLeft.x, restored.topLeft.x, 0.002f)
            assertEquals(sourceQuad.topLeft.y, restored.topLeft.y, 0.002f)
            assertEquals(sourceQuad.bottomRight.x, restored.bottomRight.x, 0.002f)
            assertEquals(sourceQuad.bottomRight.y, restored.bottomRight.y, 0.002f)
        }
    }

    @Test
    fun loupeRectAndClosestHandleHitTestingBehaveAccuratelyAtEdges() {
        val edgeRect = CropGeometry.computeLoupeSourceRect(NormalizedPoint(0.02f, 0.98f), halfWidth = 0.12f, halfHeight = 0.12f)
        assertTrue(edgeRect.left >= 0f && edgeRect.top >= 0f)
        assertTrue(edgeRect.right <= 1f && edgeRect.bottom <= 1f)
        assertEquals(0.24f, edgeRect.width, 0.001f)
        assertEquals(0.24f, edgeRect.height, 0.001f)

        val quad = NormalizedQuad.defaultInset(0.15f)
        val brCanvas = CoordinateTransform.mapNormalizedToFitCenterCanvas(quad.bottomRight, 0.75f, 800f, 1200f)
        val hit = CropGeometry.findClosestHandle(
            tapX = brCanvas.x + 12f,
            tapY = brCanvas.y - 10f,
            quad = quad,
            imageAspectRatio = 0.75f,
            canvasWidth = 800f,
            canvasHeight = 1200f,
            maxDistancePx = 80f,
        )
        assertEquals(CropHandle.BOTTOM_RIGHT, hit)
    }
}
