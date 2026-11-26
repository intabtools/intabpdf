package org.intabtools.intabpdf

import android.os.SystemClock
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityStartupTest {

    @Test
    fun mainActivityHoldsUntilWebUiReadyAndDoesNotResetOnBackgroundReturn() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val deadline = SystemClock.uptimeMillis() + 10_000L
            var ready = false
            var overlayAttached = true
            while (SystemClock.uptimeMillis() < deadline) {
                scenario.onActivity { activity ->
                    ready = activity.isWebUiReadyForTest()
                    overlayAttached = activity.isSplashOverlayAttachedForTest()
                }
                if (ready && !overlayAttached) break
                Thread.sleep(40L)
            }
            assertTrue("Expected WebView + React initial UI to signal ready", ready)
            assertFalse("Expected splash overlay to be detached once UI is ready", overlayAttached)

            // Backgrounding and returning must not re-lock or re-attach the splash overlay
            scenario.moveToState(Lifecycle.State.CREATED)
            scenario.moveToState(Lifecycle.State.RESUMED)
            var stillReady = false
            var stillDetached = false
            scenario.onActivity { activity ->
                stillReady = activity.isWebUiReadyForTest()
                stillDetached = !activity.isSplashOverlayAttachedForTest()
            }
            assertTrue("Returning from background must remain ready without re-showing splash", stillReady)
            assertTrue("Returning from background must not re-attach splash overlay", stillDetached)
        }
    }
}
