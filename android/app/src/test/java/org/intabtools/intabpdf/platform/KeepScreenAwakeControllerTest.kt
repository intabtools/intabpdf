package org.intabtools.intabpdf.platform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KeepScreenAwakeControllerTest {

    private class FakeWakeTarget : ScreenWakeFlagTarget {
        var isOn: Boolean = false
        val history = mutableListOf<Boolean>()

        override fun setKeepScreenOn(keepOn: Boolean) {
            isOn = keepOn
            history += keepOn
        }
    }

    @Test
    fun idleStateDoesNotKeepScreenAwake() {
        val target = FakeWakeTarget()
        val controller = KeepScreenAwakeController(target, initialForeground = true)
        controller.onStart()
        assertFalse(controller.isScreenAwake())
        assertFalse(target.isOn)
        assertTrue(target.history.isEmpty())
    }

    @Test
    fun enablesDuringActiveProcessingAndRestoresOnCompletionFailureOrCancellation() {
        val target = FakeWakeTarget()
        val controller = KeepScreenAwakeController(target, initialForeground = true)

        controller.setActive("compress", true)
        assertTrue(controller.isScreenAwake())
        assertTrue(target.isOn)

        controller.setActive("compress", false)
        assertFalse(controller.isScreenAwake())
        assertFalse(target.isOn)

        controller.setActive("export", true)
        assertTrue(target.isOn)
        controller.clearAll()
        assertFalse(controller.isScreenAwake())
        assertFalse(target.isOn)
        assertEquals(listOf(true, false, true, false), target.history)
    }

    @Test
    fun concurrentTokensKeepAwakeUntilAllComplete() {
        val target = FakeWakeTarget()
        val controller = KeepScreenAwakeController(target, initialForeground = true)

        controller.setActive("scanner_export", true)
        controller.setActive("saf_write", true)
        assertTrue(target.isOn)

        controller.setActive("scanner_export", false)
        assertTrue("Screen must remain awake while second token is active", target.isOn)

        controller.setActive("saf_write", false)
        assertFalse("Screen must restore after last active token ends", target.isOn)
    }

    @Test
    fun clearsOnStopAndRestoresOnlyIfStillProcessingOnRestart() {
        val target = FakeWakeTarget()
        val controller = KeepScreenAwakeController(target, initialForeground = true)

        controller.setActive("ocr", true)
        assertTrue(target.isOn)

        // User leaves screen while still processing -> clears window flag immediately
        controller.onStop()
        assertFalse(target.isOn)
        assertTrue(controller.hasActiveTokens())

        // User returns while operation is still active -> re-enables cleanly
        controller.onStart()
        assertTrue(target.isOn)

        // User leaves again and operation completes in background before return
        controller.onStop()
        assertFalse(target.isOn)
        controller.setActive("ocr", false)
        controller.onStart()
        assertFalse("Must stay idle when returning after completion", target.isOn)
    }

    @Test
    fun onDestroyClearsTokensAndFlag() {
        val target = FakeWakeTarget()
        val controller = KeepScreenAwakeController(target, initialForeground = true)
        controller.setActive("pdf_convert", true)
        assertTrue(target.isOn)

        controller.onDestroy()
        assertFalse(controller.hasActiveTokens())
        assertFalse(controller.isScreenAwake())
        assertFalse(target.isOn)

        // Subsequent onStart without re-activation stays off
        controller.onStart()
        assertFalse(target.isOn)
    }
}
