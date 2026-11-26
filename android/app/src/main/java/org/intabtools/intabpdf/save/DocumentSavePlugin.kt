package org.intabtools.intabpdf.save

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.util.Collections
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@CapacitorPlugin(name = "DocumentSave")
class DocumentSavePlugin : Plugin() {

    private val ioExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private lateinit var repository: SafSaveRepository
    private val pluginActiveExportIds: MutableSet<String> = Collections.synchronizedSet(HashSet())
    private var activePickerCallId: String? = null
    private var activeExportCallId: String? = null

    override fun load() {
        super.load()
        val appContext = context.applicationContext
        val stagingDir = File(appContext.cacheDir, "saf_save_staging")
        val recoveryDir = File(appContext.filesDir, "saf_recovery_backups")
        repository = SafSaveRepository(
            storage = SharedPrefsSafDestinationStorage(appContext),
            gateway = AndroidSafTreeGateway(appContext),
            stagingDir = stagingDir,
            recoveryBackupDir = recoveryDir,
        )
        ioExecutor.execute {
            val report = repository.cleanupStaleStagingFiles()
            for (diag in report.diagnosticErrors) {
                Log.w(TAG, diag)
            }
        }
    }

    override fun handleOnDestroy() {
        activePickerCallId = null
        activeExportCallId = null
        val activeIds = synchronized(pluginActiveExportIds) {
            pluginActiveExportIds.toList().also { pluginActiveExportIds.clear() }
        }
        if (::repository.isInitialized) {
            for (id in activeIds) {
                repository.endRecoveryExport(id)
            }
        }
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

                is DestinationCheckResult.NeedsSelection -> {
                    launchFolderPickerOnMainThread(call, status.repromptMessage)
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
                                outcome.cleanupWarning?.let { w ->
                                    put("cleanupWarning", serializeCleanupWarning(w))
                                }
                            },
                        )
                    }

                    is SafSaveOutcome.NeedsFolderSelection -> {
                        call.resolve(
                            JSObject().apply {
                                put("status", "needs_folder_selection")
                                if (outcome.repromptMessage != null) {
                                    put("reason", outcome.repromptMessage)
                                }
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
                        call.resolve(
                            JSObject().apply {
                                put("status", "recovery_failed")
                                put("recoveryId", outcome.recoveryId)
                                put("originalFileName", outcome.originalFileName)
                                put("attemptedDestination", outcome.attemptedDestination)
                                put("explanation", outcome.errorMessage)
                                put("failureKind", outcome.failureKind.wireValue)
                                put("backupAvailable", outcome.backupAvailable)
                                put("safBackupAvailable", outcome.safBackupAvailable)
                                put("recoverySource", outcome.recoverySource)
                                put("createdAtMillis", outcome.createdAtMillis)
                                put("sizeBytes", outcome.sizeBytes)
                                if (outcome.safBackupDocumentName != null) {
                                    put("safBackupDocumentName", outcome.safBackupDocumentName)
                                }
                            },
                        )
                    }

                    is SafSaveOutcome.Failed -> {
                        call.resolve(
                            JSObject().apply {
                                put("status", "failed")
                                put("code", outcome.code)
                                put("errorMessage", outcome.errorMessage)
                                put("originalIntact", outcome.originalIntact)
                                outcome.cleanupWarning?.let { w ->
                                    put("cleanupWarning", serializeCleanupWarning(w))
                                }
                            },
                        )
                    }
                }
            } catch (ex: Throwable) {
                call.reject(ex.localizedMessage ?: "Failed to save file.", "SAVE_FAILED")
            } finally {
                repository.releaseStagedFile(stagedFile)
            }
        }
    }

    @PluginMethod
    fun listRecoveryBackups(call: PluginCall) {
        ioExecutor.execute {
            val records = repository.listRecoveryBackups()
            val array = JSArray()
            for (record in records) {
                array.put(serializeRecoveryRecord(record))
            }
            call.resolve(
                JSObject().apply {
                    put("backups", array)
                },
            )
        }
    }

    @PluginMethod
    fun exportRecoveryBackup(call: PluginCall) {
        val recoveryId = call.getString("recoveryId")?.trim()
        if (recoveryId.isNullOrEmpty()) {
            call.reject("Missing recovery identifier.", "INVALID_RECOVERY_ID")
            return
        }

        if (!repository.beginRecoveryExport(recoveryId)) {
            call.resolve(
                JSObject().apply {
                    put("status", "export_failed")
                    put("recoveryId", recoveryId)
                    put("code", "EXPORT_IN_PROGRESS")
                    put("errorMessage", "A recovery export is already in progress for this backup.")
                    put("backupPreserved", true)
                },
            )
            return
        }
        pluginActiveExportIds.add(recoveryId)

        ioExecutor.execute {
            val prep = repository.prepareRecoveryExport(recoveryId)
            val record = prep.getOrNull()
            if (record == null) {
                pluginActiveExportIds.remove(recoveryId)
                repository.endRecoveryExport(recoveryId)
                val errMsg = prep.exceptionOrNull()?.message ?: "Recovery backup is unavailable."
                call.resolve(
                    JSObject().apply {
                        put("status", "export_failed")
                        put("recoveryId", recoveryId)
                        put("errorMessage", errMsg)
                        put("backupPreserved", false)
                    },
                )
                return@execute
            }
            launchExportPickerOnMainThread(call, record)
        }
    }

    @PluginMethod
    fun confirmDeleteRecoveryBackup(call: PluginCall) {
        val recoveryId = call.getString("recoveryId")?.trim()
        if (recoveryId.isNullOrEmpty()) {
            call.reject("Missing recovery identifier.", "INVALID_RECOVERY_ID")
            return
        }

        ioExecutor.execute {
            when (val outcome = repository.confirmDeleteRecoveryBackup(recoveryId)) {
                is SafDeleteBackupOutcome.Deleted -> {
                    call.resolve(
                        JSObject().apply {
                            put("status", "deleted")
                            put("recoveryId", outcome.recoveryId)
                        },
                    )
                }

                is SafDeleteBackupOutcome.Failed -> {
                    call.resolve(
                        JSObject().apply {
                            put("status", "delete_failed")
                            put("recoveryId", outcome.recoveryId)
                            put("code", outcome.code)
                            put("errorMessage", outcome.errorMessage)
                            put("backupPreserved", outcome.backupPreserved)
                        },
                    )
                }
            }
        }
    }

    @PluginMethod
    fun cleanupLeftoverSafFile(call: PluginCall) {
        val leftoverUri = call.getString("leftoverDocumentUri")?.trim()
        val verifiedTargetUri = call.getString("verifiedTargetUri")?.trim()
        val expectedSizeBytes = if (call.data.has("expectedSizeBytes")) {
            call.data.optLong("expectedSizeBytes", -1L).takeIf { it >= 0L }
        } else {
            null
        }

        if (leftoverUri.isNullOrEmpty()) {
            call.reject("Missing leftover document reference.", "INVALID_CLEANUP_TARGET")
            return
        }

        ioExecutor.execute {
            when (val outcome = repository.attemptCleanupLeftoverSafFile(leftoverUri, verifiedTargetUri, expectedSizeBytes)) {
                is SafLeftoverCleanupOutcome.Removed -> {
                    call.resolve(
                        JSObject().apply {
                            put("status", "removed")
                            put("leftoverFileName", outcome.leftoverFileName)
                        },
                    )
                }

                is SafLeftoverCleanupOutcome.Failed -> {
                    call.resolve(
                        JSObject().apply {
                            put("status", "failed")
                            put("code", outcome.code)
                            put("errorMessage", outcome.errorMessage)
                        },
                    )
                }
            }
        }
    }

    private fun launchFolderPickerOnMainThread(call: PluginCall, noticeMessage: String? = null) {
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

                is DestinationCheckResult.NeedsSelection -> {
                    call.resolve(
                        JSObject().apply {
                            put("ready", false)
                            put("cancelled", false)
                            put("reprompt", true)
                            if (bound.repromptMessage != null) {
                                put("reason", bound.repromptMessage)
                            }
                        },
                    )
                }

                is DestinationCheckResult.Failed -> {
                    call.reject(bound.message, bound.code)
                }
            }
        }
    }

    private fun launchExportPickerOnMainThread(call: PluginCall, record: RecoveryBackupRecord) {
        val releaseExportLock = {
            pluginActiveExportIds.remove(record.recoveryId)
            repository.endRecoveryExport(record.recoveryId)
        }
        val currentActivity = activity
        if (currentActivity == null || currentActivity.isFinishing || currentActivity.isDestroyed) {
            releaseExportLock()
            call.reject("Host activity is unavailable.", "ACTIVITY_UNAVAILABLE")
            return
        }

        currentActivity.runOnUiThread {
            if (currentActivity.isFinishing || currentActivity.isDestroyed) {
                releaseExportLock()
                call.reject("Host activity is unavailable.", "ACTIVITY_UNAVAILABLE")
                return@runOnUiThread
            }

            val existingExport = activeExportCallId
            if (existingExport != null) {
                if (bridge?.getSavedCall(existingExport) != null) {
                    releaseExportLock()
                    call.reject("A recovery export picker is already open.", "EXPORT_IN_PROGRESS")
                    return@runOnUiThread
                } else {
                    activeExportCallId = null
                }
            }

            val safeTitle = SafDocumentRules.sanitizeTargetFileName(record.originalFileName)
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = record.mimeType.ifBlank { "application/pdf" }
                putExtra(Intent.EXTRA_TITLE, safeTitle)
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

            activeExportCallId = call.callbackId
            try {
                startActivityForResult(call, intent, "handleExportDocumentResult")
            } catch (ex: Throwable) {
                activeExportCallId = null
                releaseExportLock()
                call.resolve(
                    JSObject().apply {
                        put("status", "export_failed")
                        put("recoveryId", record.recoveryId)
                        put("errorMessage", "Could not open Android file picker for recovery export.")
                        put("backupPreserved", true)
                    },
                )
            }
        }
    }

    @ActivityCallback
    fun handleExportDocumentResult(call: PluginCall?, result: ActivityResult) {
        activeExportCallId = null
        if (call == null) return

        val recoveryId = call.getString("recoveryId")?.trim().orEmpty()
        if (recoveryId.isEmpty()) {
            call.reject("Missing recovery identifier.", "INVALID_RECOVERY_ID")
            return
        }

        val releaseExportLock = {
            pluginActiveExportIds.remove(recoveryId)
            repository.endRecoveryExport(recoveryId)
        }

        val destUri: Uri? = result.data?.data
        if (result.resultCode == Activity.RESULT_CANCELED || destUri == null) {
            releaseExportLock()
            call.resolve(
                JSObject().apply {
                    put("status", "cancelled")
                    put("recoveryId", recoveryId)
                    put("backupPreserved", true)
                },
            )
            return
        }

        val displayName = resolveDisplayNameBestEffort(destUri)
        ioExecutor.execute {
            try {
                when (val outcome = repository.exportRecoveryBackupToUri(recoveryId, destUri.toString(), displayName)) {
                    is SafExportOutcome.Exported -> {
                        call.resolve(
                            JSObject().apply {
                                put("status", "exported")
                                put("recoveryId", outcome.recoveryId)
                                put("exportedFileName", outcome.exportedFileName)
                                put("exportedUri", outcome.exportedUriString)
                                put("bytesWritten", outcome.bytesWritten)
                                put("backupPreserved", outcome.backupPreserved)
                                put("awaitingDeleteConfirmation", outcome.awaitingDeleteConfirmation)
                            },
                        )
                    }

                    is SafExportOutcome.Cancelled -> {
                        call.resolve(
                            JSObject().apply {
                                put("status", "cancelled")
                                put("recoveryId", outcome.recoveryId)
                                put("backupPreserved", outcome.backupPreserved)
                            },
                        )
                    }

                    is SafExportOutcome.Failed -> {
                        call.resolve(
                            JSObject().apply {
                                put("status", "export_failed")
                                put("recoveryId", outcome.recoveryId)
                                put("code", outcome.code)
                                put("errorMessage", outcome.errorMessage)
                                put("backupPreserved", outcome.backupPreserved)
                            },
                        )
                    }
                }
            } finally {
                releaseExportLock()
            }
        }
    }

    private fun resolveDisplayNameBestEffort(uri: Uri): String? {
        return try {
            context.applicationContext.contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0 && !cursor.isNull(idx)) cursor.getString(idx) else null
                } else {
                    null
                }
            }
        } catch (_: Exception) {
            null
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

    private fun serializeRecoveryRecord(record: RecoveryBackupRecord): JSObject =
        JSObject().apply {
            put("recoveryId", record.recoveryId)
            put("originalFileName", record.originalFileName)
            put("attemptedDestination", record.attemptedDestination)
            put("explanation", record.explanation)
            put("failureKind", record.failureKind.wireValue)
            put("createdAtMillis", record.createdAtMillis)
            put("sizeBytes", record.sizeBytes)
            put("status", record.status.wireValue)
            put("backupAvailable", record.backupAvailable)
            put("safBackupAvailable", record.safBackupAvailable)
            put("recoverySource", record.recoverySource)
            if (record.safBackupDocumentName != null) {
                put("safBackupDocumentName", record.safBackupDocumentName)
            }
            if (record.exportedFileName != null) {
                put("exportedFileName", record.exportedFileName)
            }
        }

    private fun serializeCleanupWarning(warning: SafCleanupWarning): JSObject =
        JSObject().apply {
            put("code", warning.code)
            put("message", warning.message)
            if (warning.leftoverFileName != null) {
                put("leftoverFileName", warning.leftoverFileName)
            }
            if (warning.leftoverDocumentUriString != null) {
                put("leftoverDocumentUri", warning.leftoverDocumentUriString)
            }
            if (warning.verifiedTargetUriString != null) {
                put("verifiedTargetUri", warning.verifiedTargetUriString)
            }
            if (warning.verifiedTargetSizeBytes != null) {
                put("expectedSizeBytes", warning.verifiedTargetSizeBytes)
            }
        }

    companion object {
        private const val TAG = "DocumentSavePlugin"
    }
}
