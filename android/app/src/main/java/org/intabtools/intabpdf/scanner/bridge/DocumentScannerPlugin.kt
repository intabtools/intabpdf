package org.intabtools.intabpdf.scanner.bridge

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import org.intabtools.intabpdf.scanner.data.PostExportAction
import org.intabtools.intabpdf.scanner.data.ScanFilter
import org.intabtools.intabpdf.scanner.data.ScanQuality
import org.intabtools.intabpdf.scanner.data.ScannerLaunchOptions
import org.intabtools.intabpdf.scanner.data.ScannerPaths
import org.intabtools.intabpdf.scanner.data.ScannerThemeMode
import org.intabtools.intabpdf.scanner.ui.ScannerActivity
import org.intabtools.intabpdf.scanner.ui.theme.ScannerThemeController
import java.io.File

@CapacitorPlugin(
    name = "DocumentScanner",
    permissions = [
        Permission(strings = [Manifest.permission.CAMERA], alias = "camera")
    ]
)
class DocumentScannerPlugin : Plugin() {

    private var activeCallId: String? = null

    override fun load() {
        super.load()
        val appContext = context.applicationContext
        Thread(
            {
                ScannerPaths.pruneStaleDirectory(ScannerPaths.outputDir(appContext))
                ScannerPaths.pruneStaleDirectory(ScannerPaths.sessionsDir(appContext))
            },
            "intab-scanner-prune",
        ).apply {
            isDaemon = true
            start()
        }
    }

    override fun handleOnDestroy() {
        activeCallId = null
        ScannerThemeController.clearSession()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val hasCameraHardware = context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        val cameraPermState = getPermissionState("camera")
        val ret = JSObject().apply {
            put("available", hasCameraHardware)
            put("hasCameraHardware", hasCameraHardware)
            put("hasCameraPermission", cameraPermState == PermissionState.GRANTED)
        }
        call.resolve(ret)
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        val currentActivity = activity
        if (currentActivity == null || currentActivity.isFinishing || currentActivity.isDestroyed) {
            call.reject("Host activity is unavailable.", "ACTIVITY_UNAVAILABLE")
            return
        }

        val existingId = activeCallId
        if (existingId != null) {
            if (bridge?.getSavedCall(existingId) != null) {
                call.reject("A scan session is already active.", "SCAN_IN_PROGRESS")
                return
            } else {
                activeCallId = null
            }
        }

        val options = ScannerLaunchOptions(
            defaultFilter = ScanFilter.fromWireValue(call.getString("defaultFilter")),
            quality = ScanQuality.fromWireValue(call.getString("quality")),
            autoCaptureDefault = call.getBoolean("autoCaptureDefault", true) ?: true,
            suggestedFileName = call.getString("suggestedFileName"),
            theme = ScannerThemeMode.fromWireValue(call.getString("theme")),
        )

        val intent = Intent(context, ScannerActivity::class.java).apply {
            options.applyToIntent(this)
        }
        ScannerThemeController.beginSession(options.theme)
        activeCallId = call.callbackId
        try {
            startActivityForResult(call, intent, "handleScanResult")
        } catch (ex: Throwable) {
            activeCallId = null
            ScannerThemeController.clearSession()
            call.reject("Failed to launch document scanner: ${ex.localizedMessage ?: "unknown error"}", "LAUNCH_FAILED")
        }
    }

    @PluginMethod
    fun setTheme(call: PluginCall) {
        val rawTheme = call.getString("theme")?.trim()?.lowercase()
        if (rawTheme != ScannerThemeMode.LIGHT.wireValue && rawTheme != ScannerThemeMode.DARK.wireValue) {
            call.reject("Expected theme to be 'light' or 'dark'.", "INVALID_THEME")
            return
        }
        val mode = ScannerThemeMode.fromWireValue(rawTheme)
        val updated = ScannerThemeController.updateActiveTheme(mode)
        call.resolve(
            JSObject().apply {
                put("updated", updated)
                put("theme", mode.wireValue)
            },
        )
    }

    @ActivityCallback
    fun handleScanResult(call: PluginCall?, result: ActivityResult) {
        activeCallId = null
        ScannerThemeController.clearSession()
        if (call == null) return

        val data = result.data
        val errorCode = data?.getStringExtra(ScannerLaunchOptions.EXTRA_ERROR_CODE)
        val errorMessage = data?.getStringExtra(ScannerLaunchOptions.EXTRA_ERROR_MESSAGE)

        if (!errorMessage.isNullOrBlank()) {
            call.reject(errorMessage, errorCode ?: "SCAN_FAILED")
            return
        }

        if (result.resultCode == Activity.RESULT_CANCELED) {
            call.resolve(JSObject().apply { put("status", "cancelled") })
            return
        }

        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("Document scanner terminated unexpectedly.", "SCAN_FAILED")
            return
        }

        val pdfFileUrl = data?.getStringExtra(ScannerLaunchOptions.EXTRA_PDF_FILE_URL)
        val pageCount = data?.getIntExtra(ScannerLaunchOptions.EXTRA_PAGE_COUNT, 0) ?: 0
        val fileName = data?.getStringExtra(ScannerLaunchOptions.EXTRA_FILE_NAME) ?: "scan.pdf"
        val action = PostExportAction.fromWireValue(
            data?.getStringExtra(ScannerLaunchOptions.EXTRA_POST_EXPORT_ACTION)
        ).wireValue

        if (pdfFileUrl.isNullOrBlank() || pageCount <= 0) {
            call.reject("Scanner completed without a valid PDF output.", "INVALID_OUTPUT")
            return
        }

        val parsedUri = runCatching { Uri.parse(pdfFileUrl) }.getOrNull()
        val path = parsedUri?.path
        if (parsedUri?.scheme != "file" || path.isNullOrBlank()) {
            call.reject("Invalid PDF URI returned by scanner.", "INVALID_URI")
            return
        }

        val file = File(path)
        if (!ScannerPaths.isOwnedOutputFile(context, file) || !file.exists() || !file.isFile || file.length() <= 0L) {
            call.reject("Generated PDF file is missing or inaccessible.", "MISSING_OUTPUT_FILE")
            return
        }

        val ret = JSObject().apply {
            put("status", "completed")
            put("action", action)
            put("pdfFileUrl", pdfFileUrl)
            put("fileName", fileName)
            put("pageCount", pageCount)
            put("sizeBytes", file.length())
        }
        call.resolve(ret)
    }

    @PluginMethod
    fun cleanupOutput(call: PluginCall) {
        val rawUrl = call.getString("pdfFileUrl")
        if (rawUrl.isNullOrBlank()) {
            call.resolve(JSObject().apply { put("deleted", false) })
            return
        }
        val uri = runCatching { Uri.parse(rawUrl) }.getOrNull()
        val path = uri?.path
        if (uri?.scheme != "file" || path.isNullOrBlank()) {
            call.reject("Expected a valid file:// URI for cleanup.", "INVALID_URI")
            return
        }

        val target = File(path)
        if (!ScannerPaths.isOwnedOutputFile(context, target)) {
            call.reject("Refusing cleanup outside scanner cache directory.", "FORBIDDEN_PATH")
            return
        }

        val deleted = if (target.exists() && target.isFile) target.delete() else false
        call.resolve(JSObject().apply { put("deleted", deleted) })
    }
}
