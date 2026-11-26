package org.intabtools.intabpdf.save

import android.provider.DocumentsContract
import java.io.File
import java.io.FileOutputStream
import java.util.Collections
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

sealed class DestinationCheckResult {
    data class Ready(
        val destination: PersistedSafDestination,
        val folderFlags: Int,
        val existingChildren: List<SafChildEntry>,
    ) : DestinationCheckResult()

    data class NeedsSelection(val repromptMessage: String? = null) : DestinationCheckResult()

    data class Failed(val code: String, val message: String) : DestinationCheckResult()
}

/**
 * Coordinates SAF destination setup (Documents/InTabPDF/), permission verification,
 * duplicate detection, non-destructive replacement with rollback, recovery backup lifecycle,
 * and safe staging directory cleanup.
 */
class SafSaveRepository(
    private val storage: SafDestinationStorage,
    private val gateway: SafTreeGateway,
    private val stagingDir: File,
    private val recoveryBackupDir: File,
    private val recoveryStore: RecoveryBackupIndexStore = SafRecoveryStore(recoveryBackupDir),
    private val clockMillis: () -> Long = { System.currentTimeMillis() },
    private val stagingMaxAgeMillis: Long = DEFAULT_STAGING_MAX_AGE_MILLIS,
) {

    private val stagingLock = Any()
    private val destinationConfigLock = Any()
    private val fileSaveLocks = ConcurrentHashMap<String, Any>()
    private val recoveryLocks = ConcurrentHashMap<String, Any>()
    private val activeStagingPaths: MutableSet<String> = Collections.synchronizedSet(HashSet())
    private val activeExportRecoveryIds: MutableSet<String> = Collections.synchronizedSet(HashSet())
    private val stagingDiagnostics: MutableList<String> = Collections.synchronizedList(ArrayList())

    fun beginRecoveryExport(recoveryId: String): Boolean =
        activeExportRecoveryIds.add(recoveryId)

    fun endRecoveryExport(recoveryId: String) {
        activeExportRecoveryIds.remove(recoveryId)
    }

    fun isRecoveryExportActive(recoveryId: String): Boolean =
        activeExportRecoveryIds.contains(recoveryId)

    fun checkOrValidateDestination(): DestinationCheckResult = synchronized(destinationConfigLock) {
        val persisted = storage.load() ?: return DestinationCheckResult.NeedsSelection()

        if (!gateway.hasPersistedReadWritePermission(persisted.treeUriString)) {
            val hadReadOnly = gateway.hasAnyPersistedPermission(persisted.treeUriString)
            gateway.releasePersistedPermissionBestEffort(persisted.treeUriString)
            storage.clear()
            val message = if (hadReadOnly) {
                "Folder permission is read-only. Please select a writable destination folder."
            } else {
                null
            }
            return DestinationCheckResult.NeedsSelection(message)
        }

        val folderMeta = try {
            gateway.queryDocumentMetadata(persisted.folderUriString)
        } catch (_: SecurityException) {
            gateway.releasePersistedPermissionBestEffort(persisted.treeUriString)
            storage.clear()
            return DestinationCheckResult.NeedsSelection()
        } catch (_: Exception) {
            storage.clear()
            return DestinationCheckResult.NeedsSelection()
        }

        if (folderMeta == null || !folderMeta.isDirectory) {
            gateway.releasePersistedPermissionBestEffort(persisted.treeUriString)
            storage.clear()
            return DestinationCheckResult.NeedsSelection()
        }

        val children = try {
            gateway.listChildren(persisted.treeUriString, persisted.folderDocumentId)
        } catch (_: SecurityException) {
            gateway.releasePersistedPermissionBestEffort(persisted.treeUriString)
            storage.clear()
            return DestinationCheckResult.NeedsSelection()
        } catch (ex: Exception) {
            return DestinationCheckResult.Failed(
                code = "FOLDER_LIST_FAILED",
                message = ex.message ?: "Could not inspect destination folder contents.",
            )
        }

        return DestinationCheckResult.Ready(
            destination = persisted,
            folderFlags = folderMeta.flags,
            existingChildren = children,
        )
    }

    /**
     * Resolves a user-granted SAF tree into the target folder:
     * - Releases read-only tree grants immediately without touching unrelated URIs.
     * - If the user selected `InTabPDF` itself, use it directly.
     * - Otherwise reuse or create the `InTabPDF` child folder inside the selected folder.
     */
    fun bindGrantedTreeUri(treeUriString: String): DestinationCheckResult = synchronized(destinationConfigLock) {
        if (!gateway.hasPersistedReadWritePermission(treeUriString)) {
            val hadReadOnly = gateway.hasAnyPersistedPermission(treeUriString)
            gateway.releasePersistedPermissionBestEffort(treeUriString)
            storage.clear()
            return if (hadReadOnly) {
                DestinationCheckResult.NeedsSelection(
                    repromptMessage = "The selected folder only granted read access. Please choose a writable folder such as Documents/InTabPDF.",
                )
            } else {
                DestinationCheckResult.Failed(
                    code = "PERMISSION_NOT_PERSISTED",
                    message = "Read/write permission was not granted for the selected folder.",
                )
            }
        }

        val releaseOnFailureIfUnbound = {
            if (storage.load()?.treeUriString != treeUriString) {
                gateway.releasePersistedPermissionBestEffort(treeUriString)
            }
        }

        val rootDocId = try {
            gateway.getTreeRootDocumentId(treeUriString)
        } catch (ex: Exception) {
            releaseOnFailureIfUnbound()
            return DestinationCheckResult.Failed(
                code = "INVALID_TREE_URI",
                message = ex.message ?: "Selected folder URI could not be resolved.",
            )
        }

        val rootUri = gateway.buildDocumentUriUsingTree(treeUriString, rootDocId)
        val rootMeta = try {
            gateway.queryDocumentMetadata(rootUri)
        } catch (ex: Exception) {
            releaseOnFailureIfUnbound()
            return DestinationCheckResult.Failed(
                code = "FOLDER_UNAVAILABLE",
                message = ex.message ?: "Selected folder could not be accessed.",
            )
        }

        if (rootMeta == null || !rootMeta.isDirectory) {
            releaseOnFailureIfUnbound()
            return DestinationCheckResult.Failed(
                code = "NOT_A_DIRECTORY",
                message = "The selected destination is not an accessible directory.",
            )
        }

        val rootChildren = try {
            gateway.listChildren(treeUriString, rootDocId)
        } catch (ex: Exception) {
            releaseOnFailureIfUnbound()
            return DestinationCheckResult.Failed(
                code = "FOLDER_LIST_FAILED",
                message = ex.message ?: "Could not list contents of the selected folder.",
            )
        }

        val destination: PersistedSafDestination
        val finalFolderFlags: Int
        val finalChildren: List<SafChildEntry>

        if (rootMeta.displayName.equals(SafDocumentRules.TARGET_SUBFOLDER_NAME, ignoreCase = true)) {
            destination = PersistedSafDestination(
                treeUriString = treeUriString,
                folderUriString = rootUri,
                folderDocumentId = rootDocId,
                folderDisplayName = rootMeta.displayName,
                displayPath = SafDocumentRules.resolveDisplayPathForTree(
                    rootDisplayName = rootMeta.displayName,
                    treeDocumentId = rootDocId,
                    childCreatedOrFound = false,
                ),
            )
            finalFolderFlags = rootMeta.flags
            finalChildren = rootChildren
        } else {
            val existingChild = SafDocumentRules.findEntryByNameCaseInsensitive(
                rootChildren,
                SafDocumentRules.TARGET_SUBFOLDER_NAME,
            )
            val resolvedFolder = if (existingChild != null) {
                if (!existingChild.isDirectory) {
                    releaseOnFailureIfUnbound()
                    return DestinationCheckResult.Failed(
                        code = "SUBFOLDER_BLOCKED_BY_FILE",
                        message = "Cannot create Documents/${SafDocumentRules.TARGET_SUBFOLDER_NAME} because a file with that name already exists.",
                    )
                }
                existingChild
            } else {
                val canCreateDir = (rootMeta.flags and DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE) != 0
                if (!canCreateDir) {
                    releaseOnFailureIfUnbound()
                    return DestinationCheckResult.Failed(
                        code = "DIRECTORY_CREATE_UNSUPPORTED",
                        message = "The selected folder provider does not allow creating the ${SafDocumentRules.TARGET_SUBFOLDER_NAME} subfolder.",
                    )
                }
                gateway.createDirectory(rootUri, SafDocumentRules.TARGET_SUBFOLDER_NAME)
                    ?: run {
                        releaseOnFailureIfUnbound()
                        return DestinationCheckResult.Failed(
                            code = "DIRECTORY_CREATE_FAILED",
                            message = "Could not create the ${SafDocumentRules.TARGET_SUBFOLDER_NAME} subfolder in the selected location.",
                        )
                    }
            }

            destination = PersistedSafDestination(
                treeUriString = treeUriString,
                folderUriString = resolvedFolder.uriString,
                folderDocumentId = resolvedFolder.documentId,
                folderDisplayName = resolvedFolder.displayName,
                displayPath = SafDocumentRules.resolveDisplayPathForTree(
                    rootDisplayName = rootMeta.displayName,
                    treeDocumentId = rootDocId,
                    childCreatedOrFound = true,
                ),
            )
            finalFolderFlags = resolvedFolder.flags
            finalChildren = try {
                gateway.listChildren(treeUriString, resolvedFolder.documentId)
            } catch (_: Exception) {
                emptyList()
            }
        }

        storage.save(destination)
        return DestinationCheckResult.Ready(
            destination = destination,
            folderFlags = finalFolderFlags,
            existingChildren = finalChildren,
        )
    }

    fun stageBytesToCache(payload: ByteArray): File {
        if (payload.isEmpty()) {
            throw IllegalArgumentException("Source payload is empty.")
        }
        synchronized(stagingLock) {
            if (!stagingDir.exists()) {
                stagingDir.mkdirs()
            }
            val file = File(stagingDir, "stage_${clockMillis()}_${UUID.randomUUID()}.bin")
            activeStagingPaths.add(file.absolutePath)
            try {
                FileOutputStream(file, false).use { out ->
                    out.write(payload)
                    out.flush()
                }
                if (!file.exists() || file.length() != payload.size.toLong()) {
                    file.delete()
                    activeStagingPaths.remove(file.absolutePath)
                    throw IllegalStateException("Prepared payload staging verification failed.")
                }
                return file
            } catch (ex: Throwable) {
                file.delete()
                activeStagingPaths.remove(file.absolutePath)
                throw ex
            }
        }
    }

    fun releaseStagedFile(stagedFile: File?) {
        if (stagedFile == null) return
        synchronized(stagingLock) {
            try {
                if (stagedFile.exists()) {
                    stagedFile.delete()
                }
            } finally {
                activeStagingPaths.remove(stagedFile.absolutePath)
            }
        }
    }

    /**
     * Safely removes abandoned staging files strictly inside [stagingDir] older than [maxAgeMillis].
     * Never recurses outside [stagingDir], never touches recovery backups, skips active operations,
     * and records diagnostics without throwing.
     */
    fun cleanupStaleStagingFiles(maxAgeMillis: Long = stagingMaxAgeMillis): StagingCleanupReport {
        val diagnostics = ArrayList<String>()
        var removed = 0
        var preservedRecent = 0
        var skippedActive = 0

        try {
            synchronized(stagingLock) {
                if (!stagingDir.exists() || !stagingDir.isDirectory) {
                    return StagingCleanupReport(0, 0, 0, diagnostics)
                }
                val children = stagingDir.listFiles()
                if (children == null) {
                    val msg = "Unable to list SAF staging directory for cleanup."
                    recordStagingDiagnostic(msg)
                    diagnostics.add(msg)
                    return StagingCleanupReport(0, 0, 0, diagnostics)
                }

                val now = clockMillis()
                val cutoff = now - maxAgeMillis
                for (entry in children) {
                    if (!entry.isFile) continue
                    if (activeStagingPaths.contains(entry.absolutePath)) {
                        skippedActive++
                        continue
                    }
                    val modified = entry.lastModified()
                    if (modified > cutoff) {
                        preservedRecent++
                        continue
                    }
                    try {
                        if (entry.delete()) {
                            removed++
                        } else {
                            val msg = "Failed to delete stale staging file ${entry.name}."
                            recordStagingDiagnostic(msg)
                            diagnostics.add(msg)
                        }
                    } catch (ex: Throwable) {
                        val msg = "Error deleting stale staging file ${entry.name}: ${ex.message ?: "security/IO error"}"
                        recordStagingDiagnostic(msg)
                        diagnostics.add(msg)
                    }
                }
            }
        } catch (ex: Throwable) {
            val msg = "Staging directory cleanup encountered an error: ${ex.message ?: "unknown error"}"
            recordStagingDiagnostic(msg)
            diagnostics.add(msg)
        }

        return StagingCleanupReport(
            removedCount = removed,
            preservedRecentCount = preservedRecent,
            skippedActiveCount = skippedActive,
            diagnosticErrors = diagnostics,
        )
    }

    fun getDiagnosticMessages(): List<String> =
        stagingDiagnostics.toList() + recoveryStore.getDiagnostics()

    fun saveStagedPayload(
        stagedFile: File,
        requestedFileName: String,
        mimeType: String,
        replaceExisting: Boolean,
    ): SafSaveOutcome {
        if (!stagedFile.exists() || stagedFile.length() <= 0L) {
            return SafSaveOutcome.Failed("INVALID_SOURCE_PAYLOAD", "Prepared file data is missing or empty.", originalIntact = true)
        }

        val cleanName = SafDocumentRules.sanitizeTargetFileName(requestedFileName)
        val fileLock = fileSaveLocks.computeIfAbsent(cleanName.lowercase(Locale.ROOT)) { Any() }
        synchronized(fileLock) {
            val check = checkOrValidateDestination()
            if (check is DestinationCheckResult.NeedsSelection) {
                return SafSaveOutcome.NeedsFolderSelection(check.repromptMessage)
            }
            if (check is DestinationCheckResult.Failed) {
                return SafSaveOutcome.Failed(check.code, check.message, originalIntact = true)
            }

            val ready = check as DestinationCheckResult.Ready
            val destination = ready.destination
            val children = ready.existingChildren
            val existingMatch = SafDocumentRules.findEntryByNameCaseInsensitive(children, cleanName)

            if (existingMatch != null) {
                if (existingMatch.isDirectory) {
                    val suggested = SafDocumentRules.suggestUniqueName(
                        cleanName,
                        children.map { it.displayName },
                    )
                    return SafSaveOutcome.ReplaceUnsupported(
                        existingFileName = existingMatch.displayName,
                        suggestedFileName = suggested,
                        reason = "A folder named \"${existingMatch.displayName}\" exists at the destination and cannot be replaced.",
                    )
                }

                if (!replaceExisting) {
                    val suggested = SafDocumentRules.suggestUniqueName(
                        cleanName,
                        children.map { it.displayName },
                    )
                    return SafSaveOutcome.ConflictDetected(
                        existingFileName = existingMatch.displayName,
                        suggestedFileName = suggested,
                    )
                }

                return executeSafeReplace(
                    stagedFile = stagedFile,
                    destination = destination,
                    folderFlags = ready.folderFlags,
                    existingEntry = existingMatch,
                    allChildren = children,
                    mimeType = mimeType,
                )
            }

            // No conflict: create new SAF document and write staged payload
            if ((ready.folderFlags and DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE) == 0) {
                return SafSaveOutcome.Failed(
                    "CREATE_UNSUPPORTED",
                    "Destination folder no longer allows creating files.",
                    originalIntact = true,
                )
            }

            val createdDoc = try {
                gateway.createDocument(destination.folderUriString, mimeType, cleanName)
            } catch (ex: Exception) {
                return SafSaveOutcome.Failed(
                    "CREATE_FAILED",
                    ex.message ?: "Could not create destination document \"$cleanName\".",
                    originalIntact = true,
                )
            } ?: return SafSaveOutcome.Failed("CREATE_FAILED", "Provider returned no document for \"$cleanName\".", originalIntact = true)

            return try {
                val expectedBytes = stagedFile.length()
                val bytesWritten = gateway.copyLocalFileToDocument(
                    localFile = stagedFile,
                    destUriString = createdDoc.uriString,
                    strictTruncate = false,
                )
                val verified = runCatching { gateway.queryDocumentMetadata(createdDoc.uriString) }.getOrNull()
                val reportedSize = verified?.sizeBytes
                if (bytesWritten != expectedBytes || (reportedSize != null && reportedSize != expectedBytes)) {
                    gateway.deleteDocument(createdDoc.uriString)
                    return SafSaveOutcome.Failed(
                        "WRITE_VERIFY_FAILED",
                        "Written file size verification failed (expected $expectedBytes bytes, wrote $bytesWritten).",
                        originalIntact = true,
                    )
                }
                SafSaveOutcome.Success(
                    savedFileName = verified?.displayName?.ifBlank { cleanName } ?: cleanName,
                    displayPath = destination.displayPath,
                    documentUriString = verified?.uriString ?: createdDoc.uriString,
                    bytesWritten = bytesWritten,
                    replaced = false,
                )
            } catch (ex: Throwable) {
                gateway.deleteDocument(createdDoc.uriString)
                SafSaveOutcome.Failed(
                    "WRITE_FAILED",
                    ex.message ?: "Failed to write file bytes to destination.",
                    originalIntact = true,
                )
            }
        }
    }

    fun listRecoveryBackups(): List<RecoveryBackupRecord> =
        recoveryStore.listRecords().map(::enrichRecordAvailability)

    fun prepareRecoveryExport(recoveryId: String): Result<RecoveryBackupRecord> {
        val record = recoveryStore.findRecord(recoveryId)?.let(::enrichRecordAvailability)
            ?: return Result.failure(IllegalStateException("The selected recovery backup record was not found."))
        val dataFile = resolveRecordFile(record)
        val hasLocal = dataFile != null && dataFile.exists() && dataFile.isFile &&
            (record.sizeBytes == 0L || dataFile.length() > 0L)
        if (hasLocal) {
            return Result.success(
                record.copy(
                    backupAvailable = true,
                    recoverySource = "local",
                    sizeBytes = dataFile!!.length(),
                ),
            )
        }
        if (record.safBackupAvailable && record.safBackupUriString != null) {
            return Result.success(record)
        }
        return Result.failure(
            IllegalStateException(
                if (record.safBackupDocumentName != null) {
                    "Neither the app backup nor the SAF folder backup (\"${record.safBackupDocumentName}\") is accessible."
                } else {
                    "The preserved recovery backup file is missing or unreadable."
                },
            ),
        )
    }

    fun exportRecoveryBackupToUri(
        recoveryId: String,
        destUriString: String,
        destDisplayName: String?,
    ): SafExportOutcome {
        val lock = recoveryLocks.computeIfAbsent(recoveryId) { Any() }
        synchronized(lock) {
            val record = recoveryStore.findRecord(recoveryId)?.let(::enrichRecordAvailability)
                ?: return SafExportOutcome.Failed(
                    recoveryId = recoveryId,
                    code = "RECOVERY_RECORD_NOT_FOUND",
                    errorMessage = "Could not locate that recovery backup record.",
                    backupPreserved = false,
                )

            val dataFile = resolveRecordFile(record)
            val hasLocal = dataFile != null && dataFile.exists() && dataFile.isFile &&
                (record.sizeBytes == 0L || dataFile.length() > 0L)

            var tempSafSource: File? = null
            val sourceFile: File = if (hasLocal) {
                dataFile!!
            } else if (record.safBackupAvailable && record.safBackupUriString != null) {
                try {
                    if (!stagingDir.exists()) {
                        stagingDir.mkdirs()
                    }
                    val staged = File(stagingDir, "saf_export_${clockMillis()}_${UUID.randomUUID()}.bin")
                    activeStagingPaths.add(staged.absolutePath)
                    tempSafSource = staged
                    val copied = gateway.copyDocumentToLocalFile(record.safBackupUriString, staged)
                    val safMeta = runCatching { gateway.queryDocumentMetadata(record.safBackupUriString) }.getOrNull()
                    val expectedSaf = safMeta?.sizeBytes
                    if (!staged.exists() || staged.length() != copied || (expectedSaf != null && copied != expectedSaf)) {
                        throw IllegalStateException("Could not read complete SAF backup document for export.")
                    }
                    staged
                } catch (ex: Throwable) {
                    releaseStagedFile(tempSafSource)
                    return SafExportOutcome.Failed(
                        recoveryId = recoveryId,
                        code = "SAF_BACKUP_UNAVAILABLE",
                        errorMessage = ex.message?.takeIf { it.isNotBlank() }
                            ?: "Could not read the preserved SAF folder backup.",
                        backupPreserved = record.safBackupAvailable,
                    )
                }
            } else {
                return SafExportOutcome.Failed(
                    recoveryId = recoveryId,
                    code = "RECOVERY_BACKUP_MISSING",
                    errorMessage = "The preserved recovery backup file is no longer present or accessible.",
                    backupPreserved = false,
                )
            }

            val expectedBytes = sourceFile.length()
            val existingDestMeta = runCatching { gateway.queryDocumentMetadata(destUriString) }.getOrNull()
            val existingDestSize = existingDestMeta?.sizeBytes
                ?: runCatching { gateway.measureDocumentByteSize(destUriString) }.getOrNull()
            val requireTruncate = existingDestSize != null && existingDestSize > 0L
            // Only clean up destinations verified to have been empty before this export started
            val canSafelyDeleteFailedTarget = existingDestSize == 0L
            return try {
                val writtenBytes = gateway.copyLocalFileToDocument(
                    localFile = sourceFile,
                    destUriString = destUriString,
                    strictTruncate = requireTruncate,
                )
                if (writtenBytes != expectedBytes) {
                    if (canSafelyDeleteFailedTarget) {
                        gateway.deleteDocument(destUriString)
                    }
                    return SafExportOutcome.Failed(
                        recoveryId = recoveryId,
                        code = "EXPORT_VERIFY_FAILED",
                        errorMessage = "Export verification failed (expected $expectedBytes bytes, wrote $writtenBytes). Backup remains safely preserved.",
                        backupPreserved = true,
                    )
                }

                val meta = runCatching { gateway.queryDocumentMetadata(destUriString) }.getOrNull()
                val metaSize = meta?.sizeBytes
                if (metaSize != null && metaSize != expectedBytes) {
                    if (canSafelyDeleteFailedTarget) {
                        gateway.deleteDocument(destUriString)
                    }
                    return SafExportOutcome.Failed(
                        recoveryId = recoveryId,
                        code = "EXPORT_VERIFY_FAILED",
                        errorMessage = "Exported document size could not be verified ($metaSize vs $expectedBytes bytes). Backup remains safely preserved.",
                        backupPreserved = true,
                    )
                }

                if (metaSize == null) {
                    val measured = runCatching { gateway.measureDocumentByteSize(destUriString) }.getOrNull()
                    if (measured != null && measured != expectedBytes) {
                        if (canSafelyDeleteFailedTarget) {
                            gateway.deleteDocument(destUriString)
                        }
                        return SafExportOutcome.Failed(
                            recoveryId = recoveryId,
                            code = "EXPORT_VERIFY_FAILED",
                            errorMessage = "Exported document verification failed ($measured vs $expectedBytes bytes). Backup remains safely preserved.",
                            backupPreserved = true,
                        )
                    }
                }

                val verifiedName = meta?.displayName?.ifBlank { null }
                    ?: destDisplayName?.ifBlank { null }
                    ?: record.originalFileName

                // Preserve backup until explicit user confirmation!
                val updatedRecord = record.copy(
                    status = RecoveryBackupStatus.EXPORTED_AWAITING_CONFIRMATION,
                    exportedFileName = verifiedName,
                    backupAvailable = true,
                    sizeBytes = expectedBytes,
                )
                recoveryStore.upsertRecord(updatedRecord)

                SafExportOutcome.Exported(
                    recoveryId = recoveryId,
                    exportedFileName = verifiedName,
                    exportedUriString = meta?.uriString ?: destUriString,
                    bytesWritten = writtenBytes,
                    backupPreserved = true,
                    awaitingDeleteConfirmation = true,
                )
            } catch (unsupported: UnsupportedTruncateModeException) {
                SafExportOutcome.Failed(
                    recoveryId = recoveryId,
                    code = "EXPORT_TRUNCATE_UNSUPPORTED",
                    errorMessage = "The selected export destination cannot be safely overwritten in place. Choose a new filename instead; your recovery backup remains safely preserved.",
                    backupPreserved = true,
                )
            } catch (ex: Throwable) {
                if (canSafelyDeleteFailedTarget) {
                    gateway.deleteDocument(destUriString)
                }
                SafExportOutcome.Failed(
                    recoveryId = recoveryId,
                    code = "EXPORT_FAILED",
                    errorMessage = ex.message?.takeIf { it.isNotBlank() }
                        ?: "Could not export the recovery backup. The backup remains safely preserved.",
                    backupPreserved = true,
                )
            } finally {
                releaseStagedFile(tempSafSource)
            }
        }
    }

    fun confirmDeleteRecoveryBackup(recoveryId: String): SafDeleteBackupOutcome {
        val lock = recoveryLocks.computeIfAbsent(recoveryId) { Any() }
        synchronized(lock) {
            if (activeExportRecoveryIds.contains(recoveryId)) {
                return SafDeleteBackupOutcome.Failed(
                    recoveryId = recoveryId,
                    code = "EXPORT_IN_PROGRESS",
                    errorMessage = "Cannot delete this backup while an export is in progress.",
                    backupPreserved = true,
                )
            }

            val record = recoveryStore.findRecord(recoveryId)
                ?: return SafDeleteBackupOutcome.Failed(
                    recoveryId = recoveryId,
                    code = "RECOVERY_RECORD_NOT_FOUND",
                    errorMessage = "Recovery backup was not found.",
                    backupPreserved = false,
                )

            val dataFile = resolveRecordFile(record)
            if (dataFile != null && dataFile.exists()) {
                val deleted = try {
                    dataFile.delete() && !dataFile.exists()
                } catch (_: Throwable) {
                    false
                }
                if (!deleted) {
                    recoveryStore.upsertRecord(record.copy(status = RecoveryBackupStatus.DELETE_FAILED))
                    return SafDeleteBackupOutcome.Failed(
                        recoveryId = recoveryId,
                        code = "RECOVERY_DELETE_FAILED",
                        errorMessage = "Could not delete the app backup copy for \"${record.originalFileName}\". Cleanup is still pending.",
                        backupPreserved = true,
                    )
                }
            }

            recoveryStore.removeRecord(recoveryId)
            return SafDeleteBackupOutcome.Deleted(recoveryId = recoveryId)
        }
    }

    /**
     * Safely removes a leftover SAF temp/backup document ONLY after verifying the active destination
     * target file exists with matching size when reported.
     */
    fun attemptCleanupLeftoverSafFile(
        leftoverUriString: String,
        verifiedTargetUriString: String?,
        expectedSizeBytes: Long?,
    ): SafLeftoverCleanupOutcome {
        if (leftoverUriString.isBlank() || verifiedTargetUriString.isNullOrBlank()) {
            return SafLeftoverCleanupOutcome.Failed(
                code = "CLEANUP_UNVERIFIED",
                errorMessage = "Cannot remove backup because the saved destination file could not be verified.",
            )
        }

        val targetMeta = runCatching { gateway.queryDocumentMetadata(verifiedTargetUriString) }.getOrNull()
        if (targetMeta == null || targetMeta.isDirectory) {
            return SafLeftoverCleanupOutcome.Failed(
                code = "TARGET_UNVERIFIED",
                errorMessage = "Saved destination file could not be verified; leftover backup was kept intact.",
            )
        }
        val reportedSize = targetMeta.sizeBytes
        if (expectedSizeBytes != null && reportedSize != null && reportedSize != expectedSizeBytes) {
            return SafLeftoverCleanupOutcome.Failed(
                code = "TARGET_SIZE_MISMATCH",
                errorMessage = "Saved destination file size does not match expected output; leftover backup was kept intact.",
            )
        }

        val leftoverMeta = runCatching { gateway.queryDocumentMetadata(leftoverUriString) }.getOrNull()
        val leftoverName = leftoverMeta?.displayName ?: "backup file"
        val deleted = gateway.deleteDocument(leftoverUriString)
        return if (deleted) {
            SafLeftoverCleanupOutcome.Removed(leftoverName)
        } else {
            SafLeftoverCleanupOutcome.Failed(
                code = "SAF_DELETE_FAILED",
                errorMessage = "Storage provider still did not allow removing \"$leftoverName\".",
            )
        }
    }

    private fun executeSafeReplace(
        stagedFile: File,
        destination: PersistedSafDestination,
        folderFlags: Int,
        existingEntry: SafChildEntry,
        allChildren: List<SafChildEntry>,
        mimeType: String,
    ): SafSaveOutcome {
        val suggestedAlternative = SafDocumentRules.suggestUniqueName(
            existingEntry.displayName,
            allChildren.map { it.displayName },
        )
        val strategy = SafDocumentRules.chooseReplaceStrategy(
            existingFlags = existingEntry.flags,
            parentFlags = folderFlags,
        )

        return when (strategy) {
            SafReplaceStrategy.STAGED_SWAP -> performStagedSwap(
                stagedFile = stagedFile,
                destination = destination,
                existingEntry = existingEntry,
                allChildren = allChildren,
                mimeType = mimeType,
                suggestedAlternative = suggestedAlternative,
            )

            SafReplaceStrategy.CACHE_BACKUP_WT -> performCacheBackupTruncateReplace(
                stagedFile = stagedFile,
                destination = destination,
                existingEntry = existingEntry,
                mimeType = mimeType,
                suggestedAlternative = suggestedAlternative,
            )

            SafReplaceStrategy.UNSUPPORTED_PRESERVE_ORIGINAL -> SafSaveOutcome.ReplaceUnsupported(
                existingFileName = existingEntry.displayName,
                suggestedFileName = suggestedAlternative,
                reason = "This storage provider does not allow safe replacement. Original file was kept untouched.",
            )
        }
    }

    private fun performStagedSwap(
        stagedFile: File,
        destination: PersistedSafDestination,
        existingEntry: SafChildEntry,
        allChildren: List<SafChildEntry>,
        mimeType: String,
        suggestedAlternative: String,
    ): SafSaveOutcome {
        val existingNames = allChildren.mapTo(HashSet()) { it.displayName }
        val ts = clockMillis()
        val tempCandidateName = SafDocumentRules.buildBoundedPrefixedName(
            prefix = "intabpdf_tmp_${ts}_",
            targetName = existingEntry.displayName,
            existingNames = existingNames,
        )
        existingNames.add(tempCandidateName)
        val backupCandidateName = SafDocumentRules.buildBoundedPrefixedName(
            prefix = "intabpdf_bak_${ts}_",
            targetName = existingEntry.displayName,
            existingNames = existingNames,
        )

        val tempDoc = try {
            gateway.createDocument(destination.folderUriString, mimeType, tempCandidateName)
        } catch (_: Exception) {
            null
        } ?: return SafSaveOutcome.ReplaceUnsupported(
            existingFileName = existingEntry.displayName,
            suggestedFileName = suggestedAlternative,
            reason = "Could not stage a temporary file at destination. Original file remains intact.",
        )

        val expectedBytes = stagedFile.length()
        val bytesWritten = try {
            gateway.copyLocalFileToDocument(
                localFile = stagedFile,
                destUriString = tempDoc.uriString,
                strictTruncate = false,
            )
        } catch (ex: Throwable) {
            gateway.deleteDocument(tempDoc.uriString)
            return SafSaveOutcome.Failed(
                code = "STAGED_WRITE_FAILED",
                errorMessage = ex.message ?: "Could not write replacement data; original file was not modified.",
                originalIntact = true,
            )
        }

        // Verify both written byte count and staged temp metadata (when provider reports size)
        val verifiedTemp = runCatching { gateway.queryDocumentMetadata(tempDoc.uriString) }.getOrNull()
        if (bytesWritten != expectedBytes ||
            verifiedTemp == null ||
            (verifiedTemp.sizeBytes != null && verifiedTemp.sizeBytes != expectedBytes)
        ) {
            gateway.deleteDocument(tempDoc.uriString)
            return SafSaveOutcome.Failed(
                code = "STAGED_VERIFY_FAILED",
                errorMessage = "Staged replacement verification failed; original file was not modified.",
                originalIntact = true,
            )
        }

        // Step 2: Rename original -> backup and re-query updated document ID
        val backupDocAfterRename = try {
            gateway.renameDocument(
                treeUriString = destination.treeUriString,
                folderDocumentId = destination.folderDocumentId,
                documentUriString = existingEntry.uriString,
                newDisplayName = backupCandidateName,
            )
        } catch (_: Exception) {
            null
        }

        val currentBackupDoc = backupDocAfterRename ?: findChildRequery(destination, backupCandidateName)
        if (currentBackupDoc == null) {
            // Rename of original failed before modifying original; clean temp and try guarded "wt" if supported.
            gateway.deleteDocument(verifiedTemp.uriString)
            if ((existingEntry.flags and DocumentsContract.Document.FLAG_SUPPORTS_WRITE) != 0) {
                return performCacheBackupTruncateReplace(
                    stagedFile = stagedFile,
                    destination = destination,
                    existingEntry = existingEntry,
                    mimeType = mimeType,
                    suggestedAlternative = suggestedAlternative,
                )
            }
            return SafSaveOutcome.ReplaceUnsupported(
                existingFileName = existingEntry.displayName,
                suggestedFileName = suggestedAlternative,
                reason = "Provider did not permit renaming the existing file for swap replacement. Original file was kept.",
            )
        }

        // Step 3: Rename staged temp -> original name and re-query final document ID
        val targetDocAfterRename = try {
            gateway.renameDocument(
                treeUriString = destination.treeUriString,
                folderDocumentId = destination.folderDocumentId,
                documentUriString = verifiedTemp.uriString,
                newDisplayName = existingEntry.displayName,
            )
        } catch (_: Exception) {
            null
        }

        val finalTargetDoc = targetDocAfterRename ?: findChildRequery(destination, existingEntry.displayName)
        if (finalTargetDoc != null) {
            val backupDeleted = gateway.deleteDocument(currentBackupDoc.uriString)
            val cleanupWarning = if (!backupDeleted) {
                SafCleanupWarning(
                    code = "BACKUP_DELETE_FAILED",
                    message = "${finalTargetDoc.displayName.ifBlank { existingEntry.displayName }} was saved to ${destination.displayPath}, but extra backup \"${currentBackupDoc.displayName}\" could not be removed automatically.",
                    leftoverFileName = currentBackupDoc.displayName,
                    leftoverDocumentUriString = currentBackupDoc.uriString,
                    verifiedTargetUriString = finalTargetDoc.uriString,
                    verifiedTargetSizeBytes = bytesWritten,
                )
            } else {
                null
            }
            return SafSaveOutcome.Success(
                savedFileName = finalTargetDoc.displayName.ifBlank { existingEntry.displayName },
                displayPath = destination.displayPath,
                documentUriString = finalTargetDoc.uriString,
                bytesWritten = bytesWritten,
                replaced = true,
                warningMessage = cleanupWarning?.message,
                cleanupWarning = cleanupWarning,
            )
        }

        // Step 3 failed: attempt rollback of backup -> original filename
        val restored = try {
            gateway.renameDocument(
                treeUriString = destination.treeUriString,
                folderDocumentId = destination.folderDocumentId,
                documentUriString = currentBackupDoc.uriString,
                newDisplayName = existingEntry.displayName,
            )
        } catch (_: Exception) {
            null
        } ?: findChildRequery(destination, existingEntry.displayName)

        if (restored != null) {
            val tempDeleted = gateway.deleteDocument(verifiedTemp.uriString)
            val tempCleanupWarning = if (!tempDeleted) {
                SafCleanupWarning(
                    code = "TEMP_DELETE_FAILED",
                    message = "Replacement did not finish; your original file \"${existingEntry.displayName}\" was restored safely, though temporary file \"${verifiedTemp.displayName}\" could not be removed.",
                    leftoverFileName = verifiedTemp.displayName,
                    leftoverDocumentUriString = verifiedTemp.uriString,
                    verifiedTargetUriString = restored.uriString,
                    verifiedTargetSizeBytes = restored.sizeBytes,
                )
            } else {
                null
            }
            return SafSaveOutcome.Failed(
                code = "REPLACE_ROLLED_BACK",
                errorMessage = tempCleanupWarning?.message
                    ?: "Could not finalize file replacement, so the original file was restored safely.",
                originalIntact = true,
                cleanupWarning = tempCleanupWarning,
            )
        }

        // Both final rename and rollback failed: preserve backup in SAF AND try saving a local recoverable copy of original
        val recoveryId = "rec_${UUID.randomUUID()}"
        val internalName = "$recoveryId.bin"
        val expectedSafSize = currentBackupDoc.sizeBytes
        var localBackupAvailable = false
        var localSize = expectedSafSize ?: 0L
        var partialCopyKept = false

        if (!recoveryBackupDir.exists()) {
            recoveryBackupDir.mkdirs()
        }
        val partFile = File(recoveryBackupDir, "$internalName.part")
        val recoveryDataFile = File(recoveryBackupDir, internalName)
        try {
            val copiedBytes = gateway.copyDocumentToLocalFile(currentBackupDoc.uriString, partFile)
            val sizeValid = partFile.exists() && partFile.length() == copiedBytes &&
                (expectedSafSize == null || copiedBytes == expectedSafSize) &&
                (copiedBytes > 0L || expectedSafSize == 0L)
            if (!sizeValid) {
                throw IllegalStateException("Local backup copy verification failed.")
            }
            if (!partFile.renameTo(recoveryDataFile)) {
                FileOutputStream(recoveryDataFile, false).use { out ->
                    partFile.inputStream().use { input -> input.copyTo(out) }
                    out.flush()
                    out.fd.sync()
                }
                partFile.delete()
            }
            localBackupAvailable = recoveryDataFile.exists()
            localSize = recoveryDataFile.length()
        } catch (_: Throwable) {
            val safStillIntact = runCatching { gateway.queryDocumentMetadata(currentBackupDoc.uriString) }.getOrNull()?.let { meta ->
                !meta.isDirectory && (expectedSafSize == null || meta.sizeBytes == null || meta.sizeBytes == expectedSafSize)
            } == true
            if (safStillIntact) {
                partFile.delete()
                localBackupAvailable = false
            } else if (partFile.exists() && partFile.length() > 0L) {
                if (partFile.renameTo(recoveryDataFile)) {
                    localBackupAvailable = true
                    partialCopyKept = true
                    localSize = recoveryDataFile.length()
                }
            } else {
                partFile.delete()
                localBackupAvailable = false
            }
        }

        val safAccessible = isSafUriAccessible(destination.treeUriString, currentBackupDoc.uriString, localSize)
        val effectiveAvailable = localBackupAvailable || safAccessible
        val sourceLabel = when {
            localBackupAvailable -> "local"
            safAccessible -> "saf"
            else -> "unavailable"
        }

        val explanation = when {
            partialCopyKept ->
                "Replacement failed and automatic restore did not complete. A partial local backup copy was preserved in app recovery storage, and \"${currentBackupDoc.displayName}\" may remain in ${destination.displayPath}."
            localBackupAvailable ->
                "Replacement failed and automatic restore did not complete. Your previous \"${existingEntry.displayName}\" has been preserved in app recovery storage (and in ${destination.displayPath} as \"${currentBackupDoc.displayName}\")."
            safAccessible ->
                "Replacement failed and automatic restore did not complete. Copying to app storage failed, but your previous file remains accessible in ${destination.displayPath} as \"${currentBackupDoc.displayName}\" and can be exported from recovery."
            else ->
                "Replacement failed and automatic restore did not complete. Neither a local copy nor verified SAF access to \"${currentBackupDoc.displayName}\" in ${destination.displayPath} could be confirmed; check that folder in your device Files app."
        }

        val createdAt = clockMillis()
        // Always persist a durable record even when local copy failed so user retains recovery visibility across restarts
        recoveryStore.upsertRecord(
            RecoveryBackupRecord(
                recoveryId = recoveryId,
                backupFileName = internalName,
                originalFileName = existingEntry.displayName,
                mimeType = mimeType,
                attemptedDestination = destination.displayPath,
                explanation = explanation,
                failureKind = RecoveryFailureKind.SWAP_AND_ROLLBACK_FAILED,
                createdAtMillis = createdAt,
                sizeBytes = localSize,
                status = RecoveryBackupStatus.PENDING_ACTION,
                safBackupDocumentName = currentBackupDoc.displayName,
                safBackupUriString = currentBackupDoc.uriString,
                safTreeUriString = destination.treeUriString,
                backupAvailable = effectiveAvailable,
                safBackupAvailable = safAccessible,
                recoverySource = sourceLabel,
            ),
        )

        return SafSaveOutcome.RecoveryFailed(
            recoveryId = recoveryId,
            originalFileName = existingEntry.displayName,
            attemptedDestination = destination.displayPath,
            errorMessage = explanation,
            failureKind = RecoveryFailureKind.SWAP_AND_ROLLBACK_FAILED,
            backupAvailable = effectiveAvailable,
            createdAtMillis = createdAt,
            sizeBytes = localSize,
            safBackupDocumentName = currentBackupDoc.displayName,
            safBackupAvailable = safAccessible,
            recoverySource = sourceLabel,
        )
    }

    private fun performCacheBackupTruncateReplace(
        stagedFile: File,
        destination: PersistedSafDestination,
        existingEntry: SafChildEntry,
        mimeType: String,
        suggestedAlternative: String,
    ): SafSaveOutcome {
        if (!recoveryBackupDir.exists()) {
            recoveryBackupDir.mkdirs()
        }
        val recoveryId = "rec_${UUID.randomUUID()}"
        val internalBackupName = "$recoveryId.bin"
        val partFile = File(recoveryBackupDir, "$internalBackupName.part")
        val backupFile = File(recoveryBackupDir, internalBackupName)

        // Prepare durable safety backup of original BEFORE touching destination with "wt"
        val backupSize = try {
            val copied = gateway.copyDocumentToLocalFile(existingEntry.uriString, partFile)
            val expectedOrigSize = existingEntry.sizeBytes
            if (!partFile.exists() || partFile.length() != copied || (expectedOrigSize != null && copied != expectedOrigSize)) {
                throw IllegalStateException("Safety backup byte count verification failed.")
            }
            if (!partFile.renameTo(backupFile)) {
                FileOutputStream(backupFile, false).use { out ->
                    partFile.inputStream().use { input -> input.copyTo(out) }
                    out.flush()
                    out.fd.sync()
                }
                partFile.delete()
            }
            backupFile.length()
        } catch (_: Throwable) {
            partFile.delete()
            backupFile.delete()
            return SafSaveOutcome.ReplaceUnsupported(
                existingFileName = existingEntry.displayName,
                suggestedFileName = suggestedAlternative,
                reason = "Could not create a safety backup before overwriting. Original file remains untouched.",
            )
        }

        // Persist durable recovery metadata BEFORE opening the target with truncating "wt"
        val createdAt = clockMillis()
        val preWriteRecord = RecoveryBackupRecord(
            recoveryId = recoveryId,
            backupFileName = internalBackupName,
            originalFileName = existingEntry.displayName,
            mimeType = mimeType,
            attemptedDestination = destination.displayPath,
            explanation = "Replacement of \"${existingEntry.displayName}\" was interrupted before completion. A recovery copy of the original file was preserved in app recovery storage.",
            failureKind = RecoveryFailureKind.INTERRUPTED_REPLACEMENT,
            createdAtMillis = createdAt,
            sizeBytes = backupSize,
            status = RecoveryBackupStatus.PENDING_ACTION,
            backupAvailable = true,
        )
        try {
            recoveryStore.upsertRecord(preWriteRecord)
        } catch (_: Throwable) {
            backupFile.delete()
            return SafSaveOutcome.ReplaceUnsupported(
                existingFileName = existingEntry.displayName,
                suggestedFileName = suggestedAlternative,
                reason = "Could not persist a safety backup record before overwriting. Original file remains untouched.",
            )
        }

        return try {
            val expectedNewSize = stagedFile.length()
            val written = gateway.copyLocalFileToDocument(
                localFile = stagedFile,
                destUriString = existingEntry.uriString,
                strictTruncate = true,
            )
            val refreshed = runCatching { gateway.queryDocumentMetadata(existingEntry.uriString) }.getOrNull()
            val reportedNewSize = refreshed?.sizeBytes
            if (written != expectedNewSize || (reportedNewSize != null && reportedNewSize != expectedNewSize)) {
                throw IllegalStateException(
                    "Replacement verification failed (expected $expectedNewSize bytes, wrote $written, reported ${reportedNewSize ?: "unknown"}).",
                )
            }

            recoveryStore.removeRecord(recoveryId)
            backupFile.delete()
            SafSaveOutcome.Success(
                savedFileName = refreshed?.displayName?.ifBlank { existingEntry.displayName } ?: existingEntry.displayName,
                displayPath = destination.displayPath,
                documentUriString = refreshed?.uriString ?: existingEntry.uriString,
                bytesWritten = written,
                replaced = true,
            )
        } catch (unsupported: UnsupportedTruncateModeException) {
            recoveryStore.removeRecord(recoveryId)
            backupFile.delete()
            SafSaveOutcome.ReplaceUnsupported(
                existingFileName = existingEntry.displayName,
                suggestedFileName = suggestedAlternative,
                reason = unsupported.message ?: "Provider does not guarantee safe truncating replace.",
            )
        } catch (writeErr: Throwable) {
            // Write failed or failed verification after "wt" truncated target: attempt verified restore
            val expectedBackupSize = if (backupFile.exists()) backupFile.length() else backupSize
            val restoredOk = try {
                val restoredBytes = gateway.copyLocalFileToDocument(
                    localFile = backupFile,
                    destUriString = existingEntry.uriString,
                    strictTruncate = true,
                )
                val restoredMeta = runCatching { gateway.queryDocumentMetadata(existingEntry.uriString) }.getOrNull()
                val restoredMetaSize = restoredMeta?.sizeBytes
                restoredBytes == expectedBackupSize && (restoredMetaSize == null || restoredMetaSize == expectedBackupSize)
            } catch (_: Throwable) {
                false
            }

            if (restoredOk) {
                recoveryStore.removeRecord(recoveryId)
                backupFile.delete()
                SafSaveOutcome.Failed(
                    code = "REPLACE_WRITE_FAILED_RESTORED",
                    errorMessage = "Replacement write failed (${writeErr.message ?: "storage I/O error"}), and your original file was restored from backup.",
                    originalIntact = true,
                )
            } else {
                // Keep backupFile on disk + update recovery metadata for user export!
                val actualSize = if (backupFile.exists()) backupFile.length() else backupSize
                val explanation = "Replacement failed and automatic restore of \"${existingEntry.displayName}\" did not complete. A recovery copy of the original file has been preserved in app recovery storage."
                recoveryStore.upsertRecord(
                    preWriteRecord.copy(
                        explanation = explanation,
                        failureKind = RecoveryFailureKind.REPLACE_WRITE_AND_RESTORE_FAILED,
                        sizeBytes = actualSize,
                        status = RecoveryBackupStatus.PENDING_ACTION,
                        backupAvailable = backupFile.exists(),
                    ),
                )
                SafSaveOutcome.RecoveryFailed(
                    recoveryId = recoveryId,
                    originalFileName = existingEntry.displayName,
                    attemptedDestination = destination.displayPath,
                    errorMessage = explanation,
                    failureKind = RecoveryFailureKind.REPLACE_WRITE_AND_RESTORE_FAILED,
                    backupAvailable = backupFile.exists(),
                    createdAtMillis = createdAt,
                    sizeBytes = actualSize,
                )
            }
        }
    }

    private fun enrichRecordAvailability(record: RecoveryBackupRecord): RecoveryBackupRecord {
        val dataFile = resolveRecordFile(record)
        val localAvailable = dataFile != null && dataFile.isFile &&
            (record.sizeBytes == 0L || dataFile.length() > 0L)
        val safAvailable = if (record.safBackupUriString != null) {
            isSafUriAccessible(record.safTreeUriString, record.safBackupUriString, record.sizeBytes)
        } else {
            false
        }
        val effectiveAvailable = localAvailable || safAvailable
        val source = when {
            localAvailable -> "local"
            safAvailable -> "saf"
            else -> "unavailable"
        }
        val effectiveSize = if (localAvailable) dataFile.length() else record.sizeBytes
        return record.copy(
            backupAvailable = effectiveAvailable,
            safBackupAvailable = safAvailable,
            recoverySource = source,
            sizeBytes = effectiveSize,
        )
    }

    private fun isSafUriAccessible(
        treeUriString: String?,
        docUriString: String,
        expectedSizeBytes: Long,
    ): Boolean {
        if (treeUriString.isNullOrBlank()) {
            return false
        }
        if (!gateway.hasAnyPersistedPermission(treeUriString)) {
            return false
        }
        val meta = runCatching { gateway.queryDocumentMetadata(docUriString) }.getOrNull() ?: return false
        if (meta.isDirectory) return false
        val reported = meta.sizeBytes
        if (reported != null && expectedSizeBytes > 0L && reported <= 0L) {
            return false
        }
        return true
    }

    private fun resolveRecordFile(record: RecoveryBackupRecord): File? {
        if (recoveryStore is SafRecoveryStore) {
            return recoveryStore.resolveDataFileForRecord(record)
        }
        return SafRecoveryStore.resolveSafeDataFile(recoveryBackupDir, record.backupFileName)
    }

    private fun findChildRequery(destination: PersistedSafDestination, displayName: String): SafChildEntry? {
        val children = runCatching {
            gateway.listChildren(destination.treeUriString, destination.folderDocumentId)
        }.getOrDefault(emptyList())
        return SafDocumentRules.findEntryByNameCaseInsensitive(children, displayName)
    }

    private fun recordStagingDiagnostic(message: String) {
        if (stagingDiagnostics.size >= 32) {
            stagingDiagnostics.removeAt(0)
        }
        stagingDiagnostics.add(message)
    }

    companion object {
        const val DEFAULT_STAGING_MAX_AGE_MILLIS = 6L * 60L * 60L * 1000L
    }
}
