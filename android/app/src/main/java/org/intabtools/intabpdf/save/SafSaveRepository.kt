package org.intabtools.intabpdf.save

import android.provider.DocumentsContract
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

sealed class DestinationCheckResult {
    data class Ready(
        val destination: PersistedSafDestination,
        val folderFlags: Int,
        val existingChildren: List<SafChildEntry>,
    ) : DestinationCheckResult()

    data object NeedsSelection : DestinationCheckResult()

    data class Failed(val code: String, val message: String) : DestinationCheckResult()
}

/**
 * Coordinates SAF destination setup (Documents/InTabPDF/), permission verification,
 * duplicate detection, and non-destructive replacement with rollback and recovery safeguards.
 */
class SafSaveRepository(
    private val storage: SafDestinationStorage,
    private val gateway: SafTreeGateway,
    private val stagingDir: File,
    private val recoveryBackupDir: File,
    private val clockMillis: () -> Long = { System.currentTimeMillis() },
) {

    fun checkOrValidateDestination(): DestinationCheckResult {
        val persisted = storage.load() ?: return DestinationCheckResult.NeedsSelection

        if (!gateway.hasPersistedReadWritePermission(persisted.treeUriString)) {
            gateway.releasePersistedPermissionBestEffort(persisted.treeUriString)
            storage.clear()
            return DestinationCheckResult.NeedsSelection
        }

        val folderMeta = try {
            gateway.queryDocumentMetadata(persisted.folderUriString)
        } catch (_: SecurityException) {
            gateway.releasePersistedPermissionBestEffort(persisted.treeUriString)
            storage.clear()
            return DestinationCheckResult.NeedsSelection
        } catch (_: Exception) {
            storage.clear()
            return DestinationCheckResult.NeedsSelection
        }

        if (folderMeta == null || !folderMeta.isDirectory) {
            storage.clear()
            return DestinationCheckResult.NeedsSelection
        }

        val children = try {
            gateway.listChildren(persisted.treeUriString, persisted.folderDocumentId)
        } catch (_: SecurityException) {
            gateway.releasePersistedPermissionBestEffort(persisted.treeUriString)
            storage.clear()
            return DestinationCheckResult.NeedsSelection
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
     * - If the user selected `InTabPDF` itself, use it directly.
     * - Otherwise reuse or create the `InTabPDF` child folder inside the selected folder.
     */
    fun bindGrantedTreeUri(treeUriString: String): DestinationCheckResult {
        if (!gateway.hasPersistedReadWritePermission(treeUriString)) {
            return DestinationCheckResult.Failed(
                code = "PERMISSION_NOT_PERSISTED",
                message = "Read/write permission was not granted for the selected folder.",
            )
        }

        val rootDocId = try {
            gateway.getTreeRootDocumentId(treeUriString)
        } catch (ex: Exception) {
            return DestinationCheckResult.Failed(
                code = "INVALID_TREE_URI",
                message = ex.message ?: "Selected folder URI could not be resolved.",
            )
        }

        val rootUri = gateway.buildDocumentUriUsingTree(treeUriString, rootDocId)
        val rootMeta = try {
            gateway.queryDocumentMetadata(rootUri)
        } catch (ex: Exception) {
            return DestinationCheckResult.Failed(
                code = "FOLDER_UNAVAILABLE",
                message = ex.message ?: "Selected folder could not be accessed.",
            )
        }

        if (rootMeta == null || !rootMeta.isDirectory) {
            return DestinationCheckResult.Failed(
                code = "NOT_A_DIRECTORY",
                message = "The selected destination is not an accessible directory.",
            )
        }

        val rootChildren = try {
            gateway.listChildren(treeUriString, rootDocId)
        } catch (ex: Exception) {
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
                    return DestinationCheckResult.Failed(
                        code = "SUBFOLDER_BLOCKED_BY_FILE",
                        message = "Cannot create Documents/${SafDocumentRules.TARGET_SUBFOLDER_NAME} because a file with that name already exists.",
                    )
                }
                existingChild
            } else {
                val canCreateDir = (rootMeta.flags and DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE) != 0
                if (!canCreateDir) {
                    return DestinationCheckResult.Failed(
                        code = "DIRECTORY_CREATE_UNSUPPORTED",
                        message = "The selected folder provider does not allow creating the ${SafDocumentRules.TARGET_SUBFOLDER_NAME} subfolder.",
                    )
                }
                gateway.createDirectory(rootUri, SafDocumentRules.TARGET_SUBFOLDER_NAME)
                    ?: return DestinationCheckResult.Failed(
                        code = "DIRECTORY_CREATE_FAILED",
                        message = "Could not create the ${SafDocumentRules.TARGET_SUBFOLDER_NAME} subfolder in the selected location.",
                    )
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
        if (!stagingDir.exists()) {
            stagingDir.mkdirs()
        }
        val file = File(stagingDir, "stage_${clockMillis()}_${UUID.randomUUID()}.bin")
        FileOutputStream(file, false).use { out ->
            out.write(payload)
            out.flush()
        }
        if (!file.exists() || file.length() != payload.size.toLong()) {
            file.delete()
            throw IllegalStateException("Prepared payload staging verification failed.")
        }
        return file
    }

    fun saveStagedPayload(
        stagedFile: File,
        requestedFileName: String,
        mimeType: String,
        replaceExisting: Boolean,
    ): SafSaveOutcome {
        if (!stagedFile.exists() || stagedFile.length() <= 0L) {
            return SafSaveOutcome.Failed("INVALID_SOURCE_PAYLOAD", "Prepared file data is missing or empty.")
        }

        val check = checkOrValidateDestination()
        if (check is DestinationCheckResult.NeedsSelection) {
            return SafSaveOutcome.NeedsFolderSelection
        }
        if (check is DestinationCheckResult.Failed) {
            return SafSaveOutcome.Failed(check.code, check.message)
        }

        val ready = check as DestinationCheckResult.Ready
        val destination = ready.destination
        val cleanName = SafDocumentRules.sanitizeTargetFileName(requestedFileName)
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
            )
        }

        val createdDoc = try {
            gateway.createDocument(destination.folderUriString, mimeType, cleanName)
        } catch (ex: Exception) {
            return SafSaveOutcome.Failed(
                "CREATE_FAILED",
                ex.message ?: "Could not create destination document \"$cleanName\".",
            )
        } ?: return SafSaveOutcome.Failed("CREATE_FAILED", "Provider returned no document for \"$cleanName\".")

        return try {
            val bytesWritten = gateway.copyLocalFileToDocument(
                localFile = stagedFile,
                destUriString = createdDoc.uriString,
                strictTruncate = false,
            )
            val verified = runCatching { gateway.queryDocumentMetadata(createdDoc.uriString) }.getOrNull()
            SafSaveOutcome.Success(
                savedFileName = verified?.displayName?.ifBlank { cleanName } ?: cleanName,
                displayPath = destination.displayPath,
                documentUriString = verified?.uriString ?: createdDoc.uriString,
                bytesWritten = bytesWritten,
                replaced = false,
            )
        } catch (ex: Throwable) {
            gateway.deleteDocument(createdDoc.uriString)
            SafSaveOutcome.Failed("WRITE_FAILED", ex.message ?: "Failed to write file bytes to destination.")
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
        val tempCandidateName = SafDocumentRules.suggestUniqueName(
            "intabpdf_tmp_${ts}_${existingEntry.displayName}",
            existingNames,
        )
        existingNames.add(tempCandidateName)
        val backupCandidateName = SafDocumentRules.suggestUniqueName(
            "intabpdf_bak_${ts}_${existingEntry.displayName}",
            existingNames,
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

        val bytesWritten = try {
            gateway.copyLocalFileToDocument(
                localFile = stagedFile,
                destUriString = tempDoc.uriString,
                strictTruncate = false,
            )
        } catch (ex: Throwable) {
            gateway.deleteDocument(tempDoc.uriString)
            return SafSaveOutcome.Failed(
                "STAGED_WRITE_FAILED",
                ex.message ?: "Could not write replacement data; original file was not modified.",
            )
        }

        // Verify staged temp document exists with full byte count (when provider reports size)
        val verifiedTemp = runCatching { gateway.queryDocumentMetadata(tempDoc.uriString) }.getOrNull()
        if (verifiedTemp == null || (verifiedTemp.sizeBytes != null && verifiedTemp.sizeBytes != stagedFile.length())) {
            gateway.deleteDocument(tempDoc.uriString)
            return SafSaveOutcome.Failed(
                "STAGED_VERIFY_FAILED",
                "Staged replacement verification failed; original file was not modified.",
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
            val warning = if (!backupDeleted) {
                "Replaced file, though temporary backup ${currentBackupDoc.displayName} could not be removed."
            } else {
                null
            }
            return SafSaveOutcome.Success(
                savedFileName = finalTargetDoc.displayName.ifBlank { existingEntry.displayName },
                displayPath = destination.displayPath,
                documentUriString = finalTargetDoc.uriString,
                bytesWritten = bytesWritten,
                replaced = true,
                warningMessage = warning,
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
            gateway.deleteDocument(verifiedTemp.uriString)
            return SafSaveOutcome.Failed(
                "REPLACE_ROLLED_BACK",
                "Could not finalize file replacement, so the original file was restored safely.",
            )
        }

        // Both final rename and rollback failed: preserve BOTH backup document and staged recovery file!
        val recoveryCopy = preserveRecoveryStageFile(stagedFile, existingEntry.displayName)
        return SafSaveOutcome.RecoveryFailed(
            errorMessage = "Replace failed and automatic restore did not complete. Your previous file is preserved in ${destination.displayPath} as \"${currentBackupDoc.displayName}\".",
            recoveryLocation = recoveryCopy?.absolutePath ?: currentBackupDoc.uriString,
        )
    }

    private fun performCacheBackupTruncateReplace(
        stagedFile: File,
        destination: PersistedSafDestination,
        existingEntry: SafChildEntry,
        suggestedAlternative: String,
    ): SafSaveOutcome {
        if (!recoveryBackupDir.exists()) {
            recoveryBackupDir.mkdirs()
        }
        val backupFile = File(
            recoveryBackupDir,
            "orig_${clockMillis()}_${SafDocumentRules.sanitizeTargetFileName(existingEntry.displayName)}",
        )

        // Prepare safety backup of original BEFORE touching destination with "wt"
        try {
            gateway.copyDocumentToLocalFile(existingEntry.uriString, backupFile)
        } catch (_: Throwable) {
            backupFile.delete()
            return SafSaveOutcome.ReplaceUnsupported(
                existingFileName = existingEntry.displayName,
                suggestedFileName = suggestedAlternative,
                reason = "Could not create a safety backup before overwriting. Original file remains untouched.",
            )
        }

        return try {
            val written = gateway.copyLocalFileToDocument(
                localFile = stagedFile,
                destUriString = existingEntry.uriString,
                strictTruncate = true,
            )
            backupFile.delete()
            val refreshed = runCatching { gateway.queryDocumentMetadata(existingEntry.uriString) }.getOrNull()
            SafSaveOutcome.Success(
                savedFileName = refreshed?.displayName?.ifBlank { existingEntry.displayName } ?: existingEntry.displayName,
                displayPath = destination.displayPath,
                documentUriString = refreshed?.uriString ?: existingEntry.uriString,
                bytesWritten = written,
                replaced = true,
            )
        } catch (unsupported: UnsupportedTruncateModeException) {
            backupFile.delete()
            SafSaveOutcome.ReplaceUnsupported(
                existingFileName = existingEntry.displayName,
                suggestedFileName = suggestedAlternative,
                reason = unsupported.message ?: "Provider does not guarantee safe truncating replace.",
            )
        } catch (writeErr: Throwable) {
            // Write failed after "wt" truncated target: attempt restore from backupFile
            val restoredOk = try {
                gateway.copyLocalFileToDocument(
                    localFile = backupFile,
                    destUriString = existingEntry.uriString,
                    strictTruncate = true,
                )
                true
            } catch (_: Throwable) {
                false
            }

            if (restoredOk) {
                backupFile.delete()
                SafSaveOutcome.Failed(
                    "REPLACE_WRITE_FAILED_RESTORED",
                    "Write failed (${writeErr.message ?: "I/O error"}), and your original file was restored from backup.",
                )
            } else {
                // Keep backupFile on disk for recovery!
                SafSaveOutcome.RecoveryFailed(
                    errorMessage = "Replace failed and automatic restore of the original file failed. A local backup was preserved.",
                    recoveryLocation = backupFile.absolutePath,
                )
            }
        }
    }

    private fun findChildRequery(destination: PersistedSafDestination, displayName: String): SafChildEntry? {
        val children = runCatching {
            gateway.listChildren(destination.treeUriString, destination.folderDocumentId)
        }.getOrDefault(emptyList())
        return SafDocumentRules.findEntryByNameCaseInsensitive(children, displayName)
    }

    private fun preserveRecoveryStageFile(stagedFile: File, originalName: String): File? {
        return try {
            if (!recoveryBackupDir.exists()) {
                recoveryBackupDir.mkdirs()
            }
            val recoveryFile = File(
                recoveryBackupDir,
                "staged_${clockMillis()}_${SafDocumentRules.sanitizeTargetFileName(originalName)}",
            )
            stagedFile.copyTo(recoveryFile, overwrite = true)
            recoveryFile
        } catch (_: Exception) {
            null
        }
    }
}
