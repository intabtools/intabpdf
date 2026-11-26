package org.intabtools.intabpdf.save

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.provider.DocumentsContract
import android.util.Base64
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@CapacitorPlugin(name = "DocumentSave")
class DocumentSavePlugin : Plugin() {

    private val ioExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private lateinit var repository: SafSaveRepository
    private var activePickerCallId: String? = null

    override fun load() {
        super.load()
        val appContext = context.applicationContext
        repository = SafSaveRepository(
            storage = SharedPrefsSafDestinationStorage(appContext),
            gateway = AndroidSafTreeGateway(appContext),
            stagingDir = File(appContext.cacheDir, "saf_save_staging"),
            recoveryBackupDir = File(appContext.filesDir, "saf_recovery_backups"),
        )
    }

    override fun handleOnDestroy() {
        activePickerCallId = null
        ioExecutor.shutdown()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun prepareSaveDestination(call: PluginCall) {
        ioExecutor.execute {
            when (val status = repository.checkOrValidateDestination()) {
                is DestinationCheckResult.Ready -> {
                    call.resolve(buildReadyResponse(status))
                }

                DestinationCheckResult.NeedsSelection -> {
                    launchFolderPickerOnMainThread(call)
                }

                is DestinationCheckResult.Failed -> {
                    call.reject(status.message, status.code)
                }
            }
        }
    }

    @PluginMethod
    fun writeToDestination(call: PluginCall) {
        val rawFileName = call.getString("fileName")
        val mimeType = call.getString("mimeType") ?: "application/pdf"
        val base64Data = call.getString("base64Data")
        val replaceExisting = call.getBoolean("replaceExisting", false) ?: false

        if (rawFileName.isNullOrBlank()) {
            call.reject("Missing target filename.", "INVALID_FILE_NAME")
            return
        }
        if (base64Data.isNullOrEmpty()) {
            call.reject("Missing file data payload.", "INVALID_SOURCE_PAYLOAD")
            return
        }

        ioExecutor.execute {
            var stagedFile: File? = null
            try {
                val decodedBytes = try {
                    Base64.decode(base64Data, Base64.DEFAULT)
                } catch (ex: IllegalArgumentException) {
                    call.reject("Invalid base64 payload.", "INVALID_SOURCE_PAYLOAD")
                    return@execute
                }
                if (decodedBytes.isEmpty()) {
                    call.reject("File data payload is empty.", "INVALID_SOURCE_PAYLOAD")
                    return@execute
                }

                stagedFile = repository.stageBytesToCache(decodedBytes)

                when (
                    val outcome = repository.saveStagedPayload(
                        stagedFile = stagedFile,
                        requestedFileName = rawFileName,
                        mimeType = mimeType,
                        replaceExisting = replaceExisting,
                    )
                ) {
                    is SafSaveOutcome.Success -> {
                        call.resolve(
                            JSObject().apply {
                                put("status", "saved")
                                put("fileName", outcome.savedFileName)
                                put("displayPath", outcome.displayPath)
                                put("documentUri", outcome.documentUriString)
                                put("bytesWritten", outcome.bytesWritten)
                                put("replaced", outcome.replaced)
                                if (outcome.warningMessage != null) {
                                    put("warning", outcome.warningMessage)
                                }
                            },
                        )
                    }

                    SafSaveOutcome.NeedsFolderSelection -> {
                        call.resolve(
                            JSObject().apply {
                                put("status", "needs_folder_selection")
                            },
                        )
                    }

                    is SafSaveOutcome.ConflictDetected -> {
                        call.resolve(
                            JSObject().apply {
                                put("status", "conflict")
                                put("existingFileName", outcome.existingFileName)
                                put("suggestedFileName", outcome.suggestedFileName)
                            },
                        )
                    }

                    is SafSaveOutcome.ReplaceUnsupported -> {
                        call.resolve(
                            JSObject().apply {
                                put("status", "replace_unsupported")
                                put("existingFileName", outcome.existingFileName)
                                put("suggestedFileName", outcome.suggestedFileName)
                                put("reason", outcome.reason)
                            },
                        )
                    }

                    is SafSaveOutcome.RecoveryFailed -> {
                        call.reject(outcome.errorMessage, "RECOVERY_FAILED")
                    }

                    is SafSaveOutcome.Failed -> {
                        call.reject(outcome.errorMessage, outcome.code)
                    }
                }
            } catch (ex: Throwable) {
                call.reject(ex.localizedMessage ?: "Failed to save file.", "SAVE_FAILED")
            } finally {
                stagedFile?.delete()
            }
        }
    }

    private fun launchFolderPickerOnMainThread(call: PluginCall) {
        val currentActivity = activity
        if (currentActivity == null || currentActivity.isFinishing || currentActivity.isDestroyed) {
            call.reject("Host activity is unavailable.", "ACTIVITY_UNAVAILABLE")
            return
        }

        currentActivity.runOnUiThread {
            if (currentActivity.isFinishing || currentActivity.isDestroyed) {
                call.reject("Host activity is unavailable.", "ACTIVITY_UNAVAILABLE")
                return@runOnUiThread
            }

            val existingId = activePickerCallId
            if (existingId != null) {
                if (bridge?.getSavedCall(existingId) != null) {
                    call.reject("A folder selection prompt is already open.", "PICKER_IN_PROGRESS")
                    return@runOnUiThread
                } else {
                    activePickerCallId = null
                }
            }

            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                        Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
                )
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    runCatching {
                        DocumentsContract.buildDocumentUri(
                            "com.android.externalstorage.documents",
                            "primary:Documents",
                        )
                    }.getOrNull()?.let { initialUri ->
                        putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri)
                    }
                }
            }

            activePickerCallId = call.callbackId
            try {
                startActivityForResult(call, intent, "handleTreePickerResult")
            } catch (ex: Throwable) {
                activePickerCallId = null
                call.reject(
                    "Could not open Android folder picker: ${ex.localizedMessage ?: "unknown error"}",
                    "PICKER_LAUNCH_FAILED",
                )
            }
        }
    }

    @ActivityCallback
    fun handleTreePickerResult(call: PluginCall?, result: ActivityResult) {
        activePickerCallId = null
        if (call == null) return

        if (result.resultCode == Activity.RESULT_CANCELED || result.data?.data == null) {
            call.resolve(
                JSObject().apply {
                    put("ready", false)
                    put("cancelled", true)
                },
            )
            return
        }

        val dataIntent = result.data!!
        val treeUri = dataIntent.data!!
        val requestedFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        val grantedMask = dataIntent.flags and requestedFlags
        val persistFlags = if (grantedMask != 0) grantedMask else requestedFlags

        try {
            context.applicationContext.contentResolver.takePersistableUriPermission(treeUri, persistFlags)
        } catch (sec: SecurityException) {
            call.reject(
                "Could not retain permission for the selected folder: ${sec.localizedMessage ?: "access denied"}",
                "PERMISSION_PERSIST_FAILED",
            )
            return
        }

        ioExecutor.execute {
            when (val bound = repository.bindGrantedTreeUri(treeUri.toString())) {
                is DestinationCheckResult.Ready -> {
                    call.resolve(buildReadyResponse(bound))
                }

                DestinationCheckResult.NeedsSelection -> {
                    call.resolve(
                        JSObject().apply {
                            put("ready", false)
                            put("cancelled", true)
                        },
                    )
                }

                is DestinationCheckResult.Failed -> {
                    call.reject(bound.message, bound.code)
                }
            }
        }
    }

    private fun buildReadyResponse(ready: DestinationCheckResult.Ready): JSObject {
        val existingNames = JSArray()
        for (entry in ready.existingChildren) {
            existingNames.put(entry.displayName)
        }
        return JSObject().apply {
            put("ready", true)
            put("cancelled", false)
            put("folderUri", ready.destination.folderUriString)
            put("displayPath", ready.destination.displayPath)
            put("existingNames", existingNames)
        }
    }
}
