package org.intabtools.intabpdf.scanner.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.SystemClock
import android.view.KeyEvent
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.intabtools.intabpdf.scanner.data.ScannerLaunchOptions
import org.intabtools.intabpdf.scanner.ui.camera.CameraBindState
import org.intabtools.intabpdf.scanner.ui.camera.CaptureFeedbackState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Live Android device/emulator instrumentation tests verifying CameraX preview binding,
 * OpenCV frame analysis, auto-capture toggle default, full-resolution manual still capture
 * via CameraX virtualscene, background/foreground rebind, and Back cancellation.
 */
@RunWith(AndroidJUnit4::class)
class ScannerActivityTest {

    @Test
    fun liveCameraPreviewManualCaptureAndBackCancellation() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
            context.packageName,
            Manifest.permission.CAMERA,
        )

        val intent = ScannerLaunchOptions(autoCaptureDefault = true)
            .applyToIntent(Intent(context, ScannerActivity::class.java))

        ActivityScenario.launchActivityForResult<ScannerActivity>(intent).use { scenario ->
            val readyState = waitUntil(scenario, timeoutMs = 10_000L) {
                it.bindState is CameraBindState.Ready
            }
            assertTrue("Expected CameraX preview Ready, got ${readyState?.bindState}", readyState?.bindState is CameraBindState.Ready)
            assertTrue("Auto-Capture should default ON", readyState!!.autoCaptureEnabled)
            assertTrue("OpenCV runtime should initialize cleanly", readyState.openCvAvailable)

            scenario.onActivity { activity ->
                activity.onKeyDown(KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_DOWN))
            }

            val capturedState = waitUntil(scenario, timeoutMs = 12_000L) {
                it.capturedCount >= 1 && it.captureFeedback !is CaptureFeedbackState.Capturing
            }
            assertNotNull("Expected manual still capture to complete", capturedState)
            assertEquals(1, capturedState!!.capturedCount)
            val savedPage = capturedState.lastCapturedPage
            assertNotNull("Expected persisted ScannedPageSource", savedPage)
            val sourceFile = File(savedPage!!.sourceFilePath)
            assertTrue("Full-resolution captured file must exist", sourceFile.exists() && sourceFile.length() > 1000L)
            assertFalse("Manual capture must mark autoCaptured = false", savedPage.autoCaptured)

            sourceFile.delete()

            scenario.onActivity { activity ->
                activity.onBackPressedDispatcher.onBackPressed()
            }
            assertEquals(Activity.RESULT_CANCELED, scenario.result.resultCode)
        }
    }

    @Test
    fun backgroundAndForegroundLifecycleUnbindsAndRebindsCamera() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
            context.packageName,
            Manifest.permission.CAMERA,
        )

        val intent = ScannerLaunchOptions(autoCaptureDefault = true)
            .applyToIntent(Intent(context, ScannerActivity::class.java))

        ActivityScenario.launch<ScannerActivity>(intent).use { scenario ->
            val initial = waitUntil(scenario, timeoutMs = 10_000L) {
                it.bindState is CameraBindState.Ready
            }
            assertTrue("Expected initial CameraX Ready state", initial?.bindState is CameraBindState.Ready)

            scenario.moveToState(Lifecycle.State.CREATED)
            val stopped = waitUntil(scenario, timeoutMs = 5_000L) {
                it.bindState !is CameraBindState.Ready
            }
            assertTrue("CameraX should unbind when stopped, got ${stopped?.bindState}", stopped?.bindState !is CameraBindState.Ready)

            scenario.moveToState(Lifecycle.State.RESUMED)
            val resumed = waitUntil(scenario, timeoutMs = 10_000L) {
                it.bindState is CameraBindState.Ready
            }
            assertTrue("CameraX should rebind Ready after foreground resume, got ${resumed?.bindState}", resumed?.bindState is CameraBindState.Ready)
        }
    }

    private fun waitUntil(
        scenario: ActivityScenario<ScannerActivity>,
        timeoutMs: Long,
        predicate: (org.intabtools.intabpdf.scanner.ui.camera.CameraUiState) -> Boolean,
    ): org.intabtools.intabpdf.scanner.ui.camera.CameraUiState? {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        var latest: org.intabtools.intabpdf.scanner.ui.camera.CameraUiState? = null
        while (SystemClock.uptimeMillis() < deadline) {
            scenario.onActivity { activity ->
                latest = activity.currentUiStateForTest()
            }
            val current = latest
            if (current != null && predicate(current)) {
                return current
            }
            Thread.sleep(150L)
        }
        return latest
    }
}
