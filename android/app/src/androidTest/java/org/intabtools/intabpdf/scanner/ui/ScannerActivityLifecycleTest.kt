package org.intabtools.intabpdf.scanner.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.SystemClock
import android.view.KeyEvent
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.core.view.WindowCompat
import org.intabtools.intabpdf.scanner.data.ScanFilter
import org.intabtools.intabpdf.scanner.data.ScannerLaunchOptions
import org.intabtools.intabpdf.scanner.data.ScannerRoute
import org.intabtools.intabpdf.scanner.data.ScannerThemeMode
import org.intabtools.intabpdf.scanner.ui.camera.CameraBindState
import org.intabtools.intabpdf.scanner.ui.camera.CaptureFeedbackState
import org.intabtools.intabpdf.scanner.ui.theme.ScannerThemeController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ScannerActivityLifecycleTest {

    @Test
    fun activityRecreationPreservesCapturedPagesEditsAndReviewRoute() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
            context.packageName,
            Manifest.permission.CAMERA,
        )

        val intent = ScannerLaunchOptions(autoCaptureDefault = false)
            .applyToIntent(Intent(context, ScannerActivity::class.java))

        ActivityScenario.launch<ScannerActivity>(intent).use { scenario ->
            waitUntilCamera(scenario) { it.bindState is CameraBindState.Ready }

            // Capture one page, open Review, rotate 90° and switch filter to GRAYSCALE
            scenario.onActivity { activity ->
                activity.onKeyDown(KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_DOWN))
            }
            waitUntilCamera(scenario) { it.capturedCount == 1 && it.captureFeedback !is CaptureFeedbackState.Capturing }

            scenario.onActivity { activity ->
                val sc = activity.sessionControllerForTest()
                sc.openReview()
                sc.rotateSelectedPage(90)
                sc.selectFilter(ScanFilter.GRAYSCALE)
            }
            waitUntilSession(scenario) {
                it.route is ScannerRoute.Review &&
                    it.pages.size == 1 &&
                    it.pages.first().rotationDegrees == 90 &&
                    it.pages.first().selectedFilter == ScanFilter.GRAYSCALE
            }

            // Recreate Activity (simulates OS process/memory recreation) -> session & edits must survive
            scenario.recreate()
            val restored = waitUntilSession(scenario, timeoutMs = 10_000L) {
                it.route is ScannerRoute.Review && it.pages.size == 1
            }
            assertNotNull(restored)
            assertEquals(90, restored!!.pages.first().rotationDegrees)
            assertEquals(ScanFilter.GRAYSCALE, restored.pages.first().selectedFilter)

            // Back moves Review -> Camera, then Back cancels cleanly
            scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            waitUntilSession(scenario) { it.route is ScannerRoute.Camera }
        }
    }

    @Test
    fun repeatedScanLaunchesWorkCleanlyAfterCancellation() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
            context.packageName,
            Manifest.permission.CAMERA,
        )

        val intent = ScannerLaunchOptions(autoCaptureDefault = false)
            .applyToIntent(Intent(context, ScannerActivity::class.java))

        ActivityScenario.launchActivityForResult<ScannerActivity>(intent).use { first ->
            waitUntilCamera(first) { it.bindState is CameraBindState.Ready }
            first.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            assertEquals(Activity.RESULT_CANCELED, first.result.resultCode)
        }

        ActivityScenario.launchActivityForResult<ScannerActivity>(intent).use { second ->
            val state = waitUntilCamera(second) { it.bindState is CameraBindState.Ready }
            assertTrue("Second sequential launch must bind Ready", state?.bindState is CameraBindState.Ready)
            second.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            assertEquals(Activity.RESULT_CANCELED, second.result.resultCode)
        }
    }

    @Test
    fun scannerFollowsExplicitThemeOnOpenLiveUpdatesAndReopen() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
            context.packageName,
            Manifest.permission.CAMERA,
        )

        val lightIntent = ScannerLaunchOptions(
            autoCaptureDefault = false,
            theme = ScannerThemeMode.LIGHT,
        ).applyToIntent(Intent(context, ScannerActivity::class.java))

        ActivityScenario.launchActivityForResult<ScannerActivity>(lightIntent).use { lightScenario ->
            waitUntilCamera(lightScenario) { it.bindState is CameraBindState.Ready }
            lightScenario.onActivity { activity ->
                assertEquals(ScannerThemeMode.LIGHT, activity.currentThemeModeForTest())
                val insetsController = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
                assertTrue("Light scanner mode should use light status bars", insetsController.isAppearanceLightStatusBars)
            }

            // Live change light -> dark while scanner is active
            assertTrue(ScannerThemeController.updateActiveTheme(ScannerThemeMode.DARK))
            val becameDarkBars = waitUntilActivity(lightScenario, timeoutMs = 3_000L) { activity ->
                val ic = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
                activity.currentThemeModeForTest() == ScannerThemeMode.DARK && !ic.isAppearanceLightStatusBars
            }
            assertTrue("Dark scanner mode should clear light status bars", becameDarkBars)

            // Live change dark -> light while scanner is active
            assertTrue(ScannerThemeController.updateActiveTheme(ScannerThemeMode.LIGHT))
            val becameLightBars = waitUntilActivity(lightScenario, timeoutMs = 3_000L) { activity ->
                val ic = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
                activity.currentThemeModeForTest() == ScannerThemeMode.LIGHT && ic.isAppearanceLightStatusBars
            }
            assertTrue("Light scanner mode should restore light status bars", becameLightBars)

            lightScenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            assertEquals(Activity.RESULT_CANCELED, lightScenario.result.resultCode)
        }

        // Reopen in explicit dark mode without leaking prior light state
        val darkIntent = ScannerLaunchOptions(
            autoCaptureDefault = false,
            theme = ScannerThemeMode.DARK,
        ).applyToIntent(Intent(context, ScannerActivity::class.java))

        ActivityScenario.launchActivityForResult<ScannerActivity>(darkIntent).use { darkScenario ->
            waitUntilCamera(darkScenario) { it.bindState is CameraBindState.Ready }
            darkScenario.onActivity { activity ->
                assertEquals(ScannerThemeMode.DARK, activity.currentThemeModeForTest())
                val insetsController = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
                assertFalse("Reopened dark scanner must stay dark", insetsController.isAppearanceLightStatusBars)
                activity.onBackPressedDispatcher.onBackPressed()
            }
            assertEquals(Activity.RESULT_CANCELED, darkScenario.result.resultCode)
        }
    }

    private fun waitUntilCamera(
        scenario: ActivityScenario<ScannerActivity>,
        timeoutMs: Long = 10_000L,
        predicate: (org.intabtools.intabpdf.scanner.ui.camera.CameraUiState) -> Boolean,
    ): org.intabtools.intabpdf.scanner.ui.camera.CameraUiState? {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        var latest: org.intabtools.intabpdf.scanner.ui.camera.CameraUiState? = null
        while (SystemClock.uptimeMillis() < deadline) {
            scenario.onActivity { latest = it.currentUiStateForTest() }
            if (latest != null && predicate(latest!!)) return latest
            Thread.sleep(100L)
        }
        return latest
    }

    private fun waitUntilSession(
        scenario: ActivityScenario<ScannerActivity>,
        timeoutMs: Long = 10_000L,
        predicate: (org.intabtools.intabpdf.scanner.data.ScannerSessionUiState) -> Boolean,
    ): org.intabtools.intabpdf.scanner.data.ScannerSessionUiState? {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        var latest: org.intabtools.intabpdf.scanner.data.ScannerSessionUiState? = null
        while (SystemClock.uptimeMillis() < deadline) {
            scenario.onActivity { latest = it.currentSessionStateForTest() }
            if (latest != null && predicate(latest!!)) return latest
            Thread.sleep(100L)
        }
        return latest
    }

    private fun waitUntilActivity(
        scenario: ActivityScenario<ScannerActivity>,
        timeoutMs: Long = 3_000L,
        predicate: (ScannerActivity) -> Boolean,
    ): Boolean {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            var matched = false
            scenario.onActivity { matched = predicate(it) }
            if (matched) return true
            Thread.sleep(50L)
        }
        return false
    }
}
