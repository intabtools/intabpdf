package org.intabtools.intabpdf.scanner.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NormalizedQuadTest {

    @Test
    fun `orderClockwise sorts shuffled corners into TL TR BR BL`() {
        val shuffled = listOf(
            NormalizedPoint(0.85f, 0.90f), // BR
            NormalizedPoint(0.12f, 0.15f), // TL
            NormalizedPoint(0.10f, 0.88f), // BL
            NormalizedPoint(0.82f, 0.12f), // TR
        )

        val ordered = NormalizedQuad.orderClockwise(shuffled)
        assertNotNull(ordered)
        ordered!!
        assertEquals(0.12f, ordered.topLeft.x, 1e-4f)
        assertEquals(0.15f, ordered.topLeft.y, 1e-4f)
        assertEquals(0.82f, ordered.topRight.x, 1e-4f)
        assertEquals(0.12f, ordered.topRight.y, 1e-4f)
        assertEquals(0.85f, ordered.bottomRight.x, 1e-4f)
        assertEquals(0.90f, ordered.bottomRight.y, 1e-4f)
        assertEquals(0.10f, ordered.bottomLeft.x, 1e-4f)
        assertEquals(0.88f, ordered.bottomLeft.y, 1e-4f)
        assertTrue(ordered.isValidConvex())
    }

    @Test
    fun `orderClockwise rejects wrong vertex counts`() {
        assertNull(NormalizedQuad.orderClockwise(emptyList()))
        assertNull(
            NormalizedQuad.orderClockwise(
                listOf(NormalizedPoint(0f, 0f), NormalizedPoint(1f, 0f), NormalizedPoint(1f, 1f))
            )
        )
    }

    @Test
    fun `isValidConvex rejects concave self-intersecting and tiny quads`() {
        // Concave boomerang shape
        val concave = NormalizedQuad(
            topLeft = NormalizedPoint(0.1f, 0.1f),
            topRight = NormalizedPoint(0.9f, 0.1f),
            bottomRight = NormalizedPoint(0.45f, 0.35f),
            bottomLeft = NormalizedPoint(0.1f, 0.9f),
        )
        assertFalse(concave.isValidConvex())

        // Bowtie self-intersecting
        val bowtie = NormalizedQuad(
            topLeft = NormalizedPoint(0.1f, 0.1f),
            topRight = NormalizedPoint(0.9f, 0.9f),
            bottomRight = NormalizedPoint(0.9f, 0.1f),
            bottomLeft = NormalizedPoint(0.1f, 0.9f),
        )
        assertFalse(bowtie.isValidConvex())

        // Tiny quad under minimum area threshold
        val tiny = NormalizedQuad(
            topLeft = NormalizedPoint(0.45f, 0.45f),
            topRight = NormalizedPoint(0.55f, 0.45f),
            bottomRight = NormalizedPoint(0.55f, 0.55f),
            bottomLeft = NormalizedPoint(0.45f, 0.55f),
        )
        assertEquals(0.01f, tiny.areaFraction(), 1e-4f)
        assertFalse(tiny.isValidConvex(minAreaFraction = 0.04f))
    }

    @Test
    fun `isValidConvex rejects extreme acute corners`() {
        val needle = NormalizedQuad(
            topLeft = NormalizedPoint(0.48f, 0.1f),
            topRight = NormalizedPoint(0.52f, 0.1f),
            bottomRight = NormalizedPoint(0.9f, 0.9f),
            bottomLeft = NormalizedPoint(0.1f, 0.9f),
        )
        assertFalse(needle.isValidConvex())
    }

    @Test
    fun `areaFraction maxCornerDistance lerpTo and outer margin work accurately`() {
        val inset = NormalizedQuad.defaultInset(0.10f)
        assertEquals(0.64f, inset.areaFraction(), 1e-4f)
        assertFalse(inset.touchesOuterMargin())

        val full = NormalizedQuad.fullFrame()
        assertEquals(1.0f, full.areaFraction(), 1e-4f)
        assertTrue(full.touchesOuterMargin())

        val mid = inset.lerpTo(full, 0.5f)
        assertEquals(0.05f, mid.topLeft.x, 1e-4f)
        assertEquals(0.95f, mid.bottomRight.x, 1e-4f)
    }

    @Test
    fun `alignCornersTo prevents 45-degree corner index flips against reference`() {
        val reference = NormalizedQuad(
            topLeft = NormalizedPoint(0.20f, 0.20f),
            topRight = NormalizedPoint(0.80f, 0.22f),
            bottomRight = NormalizedPoint(0.78f, 0.82f),
            bottomLeft = NormalizedPoint(0.18f, 0.80f),
        )
        // Same quad shifted cyclically by 1 (as happens around 45-degree rotation tie-breaks)
        val cyclicallyShifted = NormalizedQuad(
            topLeft = reference.topRight,
            topRight = reference.bottomRight,
            bottomRight = reference.bottomLeft,
            bottomLeft = reference.topLeft,
        )

        val aligned = cyclicallyShifted.alignCornersTo(reference)
        assertEquals(reference.topLeft.x, aligned.topLeft.x, 1e-5f)
        assertEquals(reference.topLeft.y, aligned.topLeft.y, 1e-5f)
        assertEquals(reference.topRight.x, aligned.topRight.x, 1e-5f)
        assertEquals(reference.bottomRight.x, aligned.bottomRight.x, 1e-5f)
        assertEquals(reference.bottomLeft.x, aligned.bottomLeft.x, 1e-5f)
    }
}
