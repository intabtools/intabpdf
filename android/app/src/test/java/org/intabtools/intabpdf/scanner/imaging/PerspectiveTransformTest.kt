package org.intabtools.intabpdf.scanner.imaging

import org.intabtools.intabpdf.scanner.vision.NormalizedPoint
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PerspectiveTransformTest {

    @Test
    fun `estimateWarpedDimensions preserves portrait aspect ratio and enforces max pixel budget`() {
        val portraitDoc = NormalizedQuad(
            topLeft = NormalizedPoint(0.20f, 0.10f),
            topRight = NormalizedPoint(0.80f, 0.10f),
            bottomRight = NormalizedPoint(0.85f, 0.90f),
            bottomLeft = NormalizedPoint(0.15f, 0.90f),
        )

        val uncapped = PerspectiveTransform.estimateWarpedDimensions(
            quad = portraitDoc,
            sourceWidth = 3000,
            sourceHeight = 4000,
            maxOutputPixels = 20_000_000L,
        )
        assertTrue("Portrait document width (${uncapped.width}) must stay narrower than height (${uncapped.height})", uncapped.width < uncapped.height)
        assertEquals(2100.0, uncapped.width.toDouble(), 120.0)
        assertEquals(3200.0, uncapped.height.toDouble(), 120.0)

        val capped = PerspectiveTransform.estimateWarpedDimensions(
            quad = portraitDoc,
            sourceWidth = 3000,
            sourceHeight = 4000,
            maxOutputPixels = 2_000_000L,
        )
        assertTrue(capped.width.toLong() * capped.height.toLong() <= 2_050_000L)
        assertTrue(capped.width < capped.height)
    }
}
