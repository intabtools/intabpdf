package org.intabtools.intabpdf.scanner.data

import org.intabtools.intabpdf.scanner.ui.theme.ScannerThemeController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
        assertEquals(ScannerThemeMode.LIGHT, defaults.theme)
    }

    @Test
    fun `theme wire parsing defaults safely to light and controller clears stale session state`() {
        assertEquals(ScannerThemeMode.LIGHT, ScannerThemeMode.fromWireValue(null))
        assertEquals(ScannerThemeMode.LIGHT, ScannerThemeMode.fromWireValue("system"))
        assertEquals(ScannerThemeMode.LIGHT, ScannerThemeMode.fromWireValue("light"))
        assertEquals(ScannerThemeMode.DARK, ScannerThemeMode.fromWireValue(" DARK "))

        ScannerThemeController.clearSession()
        assertFalse(ScannerThemeController.updateActiveTheme(ScannerThemeMode.DARK))
        assertNull(ScannerThemeController.liveTheme.value)

        ScannerThemeController.beginSession(ScannerThemeMode.LIGHT)
        assertEquals(ScannerThemeMode.LIGHT, ScannerThemeController.liveTheme.value)

        assertTrue(ScannerThemeController.updateActiveTheme(ScannerThemeMode.DARK))
        assertEquals(ScannerThemeMode.DARK, ScannerThemeController.liveTheme.value)

        assertTrue(ScannerThemeController.updateActiveTheme(ScannerThemeMode.LIGHT))
        assertEquals(ScannerThemeMode.LIGHT, ScannerThemeController.liveTheme.value)

        ScannerThemeController.clearSession()
        assertNull(ScannerThemeController.liveTheme.value)
        assertFalse(ScannerThemeController.updateActiveTheme(ScannerThemeMode.DARK))

        ScannerThemeController.beginSession(ScannerThemeMode.DARK)
        assertEquals(ScannerThemeMode.DARK, ScannerThemeController.liveTheme.value)
        ScannerThemeController.clearSession()
    }
}
