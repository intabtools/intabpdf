package org.intabtools.intabpdf.scanner.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanSessionModelsTest {

    @Test
    fun `filter and quality wire parsing handles unknown and case variants`() {
        assertEquals(ScanFilter.AUTO, ScanFilter.fromWireValue(null))
        assertEquals(ScanFilter.AUTO, ScanFilter.fromWireValue("unknown"))
        assertEquals(ScanFilter.BLACK_AND_WHITE, ScanFilter.fromWireValue(" BW "))
        assertEquals(ScanFilter.GRAYSCALE, ScanFilter.fromWireValue("grayscale"))

        assertEquals(ScanQuality.BALANCED, ScanQuality.fromWireValue(null))
        assertEquals(ScanQuality.BALANCED, ScanQuality.fromWireValue("invalid"))
        assertEquals(ScanQuality.HIGH, ScanQuality.fromWireValue("high"))
        assertEquals(ScanQuality.LOW, ScanQuality.fromWireValue("LOW"))
    }

    @Test
    fun `default scanner launch options enable auto-capture by default`() {
        val defaults = ScannerLaunchOptions()
        assertTrue(defaults.autoCaptureDefault)
        assertEquals(ScanFilter.AUTO, defaults.defaultFilter)
        assertEquals(ScanQuality.BALANCED, defaults.quality)

        val disabled = ScannerLaunchOptions(autoCaptureDefault = false)
        assertFalse(disabled.autoCaptureDefault)
    }
}
