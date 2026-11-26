package org.intabtools.intabpdf.scanner.imaging

import org.intabtools.intabpdf.scanner.data.ScanFilter
import org.intabtools.intabpdf.scanner.data.ScanQuality
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MemoryBudgetTest {

    @Test
    fun `calculateInSampleSize keeps ultra high resolution decodes within pixel ceiling`() {
        // 48 MP (8000x6000) constrained to 12 MP -> needs sampleSize = 2 (12 MP exact)
        assertEquals(2, MemoryBudget.calculateInSampleSize(8000, 6000, 12_000_000L))
        // 48 MP constrained to 3 MP -> sampleSize = 4 (3 MP exact)
        assertEquals(4, MemoryBudget.calculateInSampleSize(8000, 6000, 3_000_000L))
        // 2 MP stays unscaled
        assertEquals(1, MemoryBudget.calculateInSampleSize(1600, 1200, 6_000_000L))
    }

    @Test
    fun `low RAM profile tightens decode and B&W render caps below normal devices`() {
        val normal = DeviceMemoryProfile(isLowRamDevice = false, memoryClassMb = 384)
        val lowRam = DeviceMemoryProfile(isLowRamDevice = true, memoryClassMb = 128)

        assertTrue(lowRam.isConstrained)
        assertTrue(lowRam.maxDecodePixels(ScanQuality.HIGH) < normal.maxDecodePixels(ScanQuality.HIGH))
        assertTrue(lowRam.maxRenderedPixels(ScanQuality.HIGH, ScanFilter.BLACK_AND_WHITE) < normal.maxRenderedPixels(ScanQuality.HIGH, ScanFilter.BLACK_AND_WHITE))
    }
}
