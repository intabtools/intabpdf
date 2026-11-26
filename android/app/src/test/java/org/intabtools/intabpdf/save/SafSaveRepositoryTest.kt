package org.intabtools.intabpdf.save

import android.provider.DocumentsContract
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

class SafSaveRepositoryTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    private class InMemoryDestinationStorage : SafDestinationStorage {
        var current: PersistedSafDestination? = null
        override fun load(): PersistedSafDestination? = current
        override fun save(destination: PersistedSafDestination) {
            current = destination
        }
        override fun clear() {
            current = null
        }
    }

    private data class FakeDocNode(
        var documentId: String,
        var parentDocumentId: String?,
        var displayName: String,
        var mimeType: String,
        var flags: Int,
        var data: ByteArray = ByteArray(0),
    ) {
        val isDirectory: Boolean
            get() = mimeType == DocumentsContract.Document.MIME_TYPE_DIR
    }

    private class FakeSafTreeGateway : SafTreeGateway {
        val treeUri = "content://com.android.externalstorage.documents/tree/primary%3ADocuments"
        val nodes = LinkedHashMap<String, FakeDocNode>()
        val uriToDocId = LinkedHashMap<String, String>()
        val persistedPermissions = HashSet<String>()
        var nextIdCounter = 100

        var failCreateDocumentForName: ((String) -> Boolean)? = null
        var failWriteToDocId: ((String, Boolean) -> Throwable?)? = null
        var onBeforeWriteToDocId: ((String, Boolean) -> Unit)? = null
        var overrideWriteByteCount: ((String) -> Long?)? = null
        var failReadFromDocId: ((String) -> Throwable?)? = null
        var failRenameFromTo: ((String, String) -> Boolean)? = null
        var failDeleteDocId: ((String) -> Boolean)? = null
        var strictWtUnsupported = false
        var legacyNonTruncatingWModeUsed = false
        var rotateIdOnRename = true
        var forceListChildrenFailure = false
        var omitReportedSizeForDocId: ((String) -> Boolean)? = null
        var overrideReportedSizeForDocId: ((String, ByteArray) -> Long?)? = null

        fun seedRoot(documentId: String, displayName: String, flags: Int = DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE): FakeDocNode {
            val node = FakeDocNode(
                documentId = documentId,
                parentDocumentId = null,
                displayName = displayName,
                mimeType = DocumentsContract.Document.MIME_TYPE_DIR,
                flags = flags,
            )
            nodes[documentId] = node
            uriToDocId[buildDocumentUriUsingTree(treeUri, documentId)] = documentId
            return node
        }

        fun seedFile(
            parentDocumentId: String,
            displayName: String,
            content: ByteArray,
            flags: Int = DocumentsContract.Document.FLAG_SUPPORTS_WRITE or
                DocumentsContract.Document.FLAG_SUPPORTS_RENAME or
                DocumentsContract.Document.FLAG_SUPPORTS_DELETE,
            mimeType: String = "application/pdf",
        ): FakeDocNode {
            val docId = "$parentDocumentId/$displayName#${nextIdCounter++}"
            val node = FakeDocNode(
                documentId = docId,
                parentDocumentId = parentDocumentId,
                displayName = displayName,
                mimeType = mimeType,
                flags = flags,
                data = content.copyOf(),
            )
            nodes[docId] = node
            uriToDocId[buildDocumentUriUsingTree(treeUri, docId)] = docId
            return node
        }

        private fun resolveNode(uriString: String): FakeDocNode? {
            val id = uriToDocId[uriString] ?: return null
            return nodes[id]
        }

        override fun hasPersistedReadWritePermission(treeUriString: String): Boolean =
            persistedPermissions.contains(treeUriString)

        val readOnlyPermissions = HashSet<String>()

        override fun hasAnyPersistedPermission(treeUriString: String): Boolean =
            persistedPermissions.contains(treeUriString) || readOnlyPermissions.contains(treeUriString)

        override fun releasePersistedPermissionBestEffort(treeUriString: String) {
            persistedPermissions.remove(treeUriString)
            readOnlyPermissions.remove(treeUriString)
        }

        override fun getTreeRootDocumentId(treeUriString: String): String =
            nodes.values.first { it.parentDocumentId == null }.documentId

        override fun buildDocumentUriUsingTree(treeUriString: String, documentId: String): String =
            "$treeUriString/document/${documentId.replace("/", "%2F")}"

        override fun queryDocumentMetadata(documentUriString: String): SafChildEntry? {
            val node = resolveNode(documentUriString) ?: return null
            return node.toEntry(buildDocumentUriUsingTree(treeUri, node.documentId))
        }

        override fun listChildren(treeUriString: String, folderDocumentId: String): List<SafChildEntry> {
            if (forceListChildrenFailure) {
                throw IOException("Provider listing failed")
            }
            return nodes.values
                .filter { it.parentDocumentId == folderDocumentId }
                .map { it.toEntry(buildDocumentUriUsingTree(treeUriString, it.documentId)) }
        }

        override fun createDirectory(folderUriString: String, name: String): SafChildEntry? {
            val parent = resolveNode(folderUriString) ?: return null
            val docId = "${parent.documentId}/$name#${nextIdCounter++}"
            val dir = FakeDocNode(
                documentId = docId,
                parentDocumentId = parent.documentId,
                displayName = name,
                mimeType = DocumentsContract.Document.MIME_TYPE_DIR,
                flags = DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE,
            )
            nodes[docId] = dir
            val uri = buildDocumentUriUsingTree(treeUri, docId)
            uriToDocId[uri] = docId
            return dir.toEntry(uri)
        }

        override fun createDocument(folderUriString: String, mimeType: String, displayName: String): SafChildEntry? {
            if (failCreateDocumentForName?.invoke(displayName) == true) {
                return null
            }
            val parent = resolveNode(folderUriString) ?: return null
            val docId = "${parent.documentId}/$displayName#${nextIdCounter++}"
            val file = FakeDocNode(
                documentId = docId,
                parentDocumentId = parent.documentId,
                displayName = displayName,
                mimeType = mimeType,
                flags = DocumentsContract.Document.FLAG_SUPPORTS_WRITE or
                    DocumentsContract.Document.FLAG_SUPPORTS_RENAME or
                    DocumentsContract.Document.FLAG_SUPPORTS_DELETE,
            )
            nodes[docId] = file
            val uri = buildDocumentUriUsingTree(treeUri, docId)
            uriToDocId[uri] = docId
            return file.toEntry(uri)
        }

        override fun renameDocument(
            treeUriString: String,
            folderDocumentId: String,
            documentUriString: String,
            newDisplayName: String,
        ): SafChildEntry? {
            val existing = resolveNode(documentUriString) ?: return null
            if (failRenameFromTo?.invoke(existing.displayName, newDisplayName) == true) {
                return null
            }
            // Refuse overwrite-on-rename just like Android DocumentsProvider
            val collision = nodes.values.any {
                it.parentDocumentId == existing.parentDocumentId &&
                    it.documentId != existing.documentId &&
                    it.displayName.equals(newDisplayName, ignoreCase = true)
            }
            if (collision) return null

            if (rotateIdOnRename) {
                nodes.remove(existing.documentId)
                uriToDocId.remove(documentUriString)
                val newDocId = "${existing.parentDocumentId}/$newDisplayName#${nextIdCounter++}"
                val rotated = existing.copy(documentId = newDocId, displayName = newDisplayName)
                nodes[newDocId] = rotated
                val newUri = buildDocumentUriUsingTree(treeUriString, newDocId)
                uriToDocId[newUri] = newDocId
                return rotated.toEntry(newUri)
            }

            existing.displayName = newDisplayName
            return existing.toEntry(documentUriString)
        }

        override fun deleteDocument(documentUriString: String): Boolean {
            val node = resolveNode(documentUriString) ?: return false
            if (failDeleteDocId?.invoke(node.documentId) == true) {
                return false
            }
            nodes.remove(node.documentId)
            uriToDocId.remove(documentUriString)
            return true
        }

        override fun copyLocalFileToDocument(
            localFile: File,
            destUriString: String,
            strictTruncate: Boolean,
        ): Long {
            val node = resolveNode(destUriString) ?: throw IOException("Document not found")
            if (!strictTruncate && node.data.isNotEmpty()) {
                legacyNonTruncatingWModeUsed = true
            }
            if (strictTruncate && strictWtUnsupported) {
                throw UnsupportedTruncateModeException(IllegalArgumentException("wt unsupported"))
            }
            val injectedError = failWriteToDocId?.invoke(node.documentId, strictTruncate)
            if (injectedError != null) {
                if (strictTruncate) {
                    // Simulate "wt" O_TRUNC wiping the target before mid-stream failure
                    node.data = ByteArray(0)
                }
                throw injectedError
            }
            onBeforeWriteToDocId?.invoke(node.documentId, strictTruncate)
            val bytes = localFile.readBytes()
            val overrideCount = overrideWriteByteCount?.invoke(node.documentId)
            if (overrideCount != null) {
                val sliced = bytes.copyOf(overrideCount.toInt().coerceAtMost(bytes.size))
                node.data = sliced
                return overrideCount
            }
            node.data = bytes
            return bytes.size.toLong()
        }

        override fun copyDocumentToLocalFile(sourceUriString: String, localFile: File): Long {
            val node = resolveNode(sourceUriString) ?: throw IOException("Source document missing")
            val injected = failReadFromDocId?.invoke(node.documentId)
            if (injected != null) throw injected
            localFile.writeBytes(node.data)
            return node.data.size.toLong()
        }

        override fun measureDocumentByteSize(documentUriString: String): Long? {
            val node = resolveNode(documentUriString) ?: return null
            return node.data.size.toLong()
        }

        private fun FakeDocNode.toEntry(uri: String) = SafChildEntry(
            documentId = documentId,
            displayName = displayName,
            mimeType = mimeType,
            flags = flags,
            sizeBytes = when {
                isDirectory || omitReportedSizeForDocId?.invoke(documentId) == true -> null
                else -> overrideReportedSizeForDocId?.invoke(documentId, data) ?: data.size.toLong()
            },
            uriString = uri,
        )
    }

    private fun newRepo(
        storage: InMemoryDestinationStorage = InMemoryDestinationStorage(),
        gateway: FakeSafTreeGateway = FakeSafTreeGateway(),
    ): Triple<SafSaveRepository, InMemoryDestinationStorage, FakeSafTreeGateway> {
        var nowMillis = 1_700_000_000_000L
        val stagingDir = tempFolder.newFolder("staging_${System.nanoTime()}")
        val recoveryDir = tempFolder.newFolder("recovery_${System.nanoTime()}")
        val repo = SafSaveRepository(
            storage = storage,
            gateway = gateway,
            stagingDir = stagingDir,
            recoveryBackupDir = recoveryDir,
            clockMillis = { nowMillis },
        )
        return Triple(repo, storage, gateway)
    }

    private fun newControlledRepo(
        initialNowMillis: Long = 1_700_000_000_000L,
        stagingMaxAgeMillis: Long = 60_000L,
    ): ControlledRepo {
        val storage = InMemoryDestinationStorage()
        val gateway = FakeSafTreeGateway()
        val stagingDir = tempFolder.newFolder("staging_ctrl_${System.nanoTime()}")
        val recoveryDir = tempFolder.newFolder("recovery_ctrl_${System.nanoTime()}")
        val clock = longArrayOf(initialNowMillis)
        val repo = SafSaveRepository(
            storage = storage,
            gateway = gateway,
            stagingDir = stagingDir,
            recoveryBackupDir = recoveryDir,
            clockMillis = { clock[0] },
            stagingMaxAgeMillis = stagingMaxAgeMillis,
        )
        return ControlledRepo(repo, storage, gateway, stagingDir, recoveryDir, clock)
    }

    private class ControlledRepo(
        val repo: SafSaveRepository,
        val storage: InMemoryDestinationStorage,
        val gateway: FakeSafTreeGateway,
        val stagingDir: File,
        val recoveryDir: File,
        val clock: LongArray,
    )

    @Test
    fun firstTimeSelectionCreatesInTabPdfSubfolderAndReusesExistingChild() {
        val (repo, storage, gateway) = newRepo()
        gateway.seedRoot("primary:Documents", "Documents")
        gateway.persistedPermissions.add(gateway.treeUri)

        // First selection under Documents auto-creates InTabPDF
        val bound = repo.bindGrantedTreeUri(gateway.treeUri) as DestinationCheckResult.Ready
        assertEquals("Documents/InTabPDF", bound.destination.displayPath)
        assertEquals("InTabPDF", bound.destination.folderDisplayName)
        assertTrue(gateway.nodes.values.any { it.displayName == "InTabPDF" && it.isDirectory })

        // Subsequent validation reuses existing subfolder cleanly
        val rechecked = repo.checkOrValidateDestination() as DestinationCheckResult.Ready
        assertEquals(bound.destination.folderDocumentId, rechecked.destination.folderDocumentId)
        assertEquals(storage.load(), rechecked.destination)
    }

    @Test
    fun selectingInTabPdfFolderDirectlyUsesItWithoutNesting() {
        val (repo, _, gateway) = newRepo()
        gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        gateway.persistedPermissions.add(gateway.treeUri)

        val bound = repo.bindGrantedTreeUri(gateway.treeUri) as DestinationCheckResult.Ready
        assertEquals("Documents/InTabPDF", bound.destination.displayPath)
        assertEquals("primary:Documents/InTabPDF", bound.destination.folderDocumentId)
        assertEquals(1, gateway.nodes.size)
    }

    @Test
    fun revokedPermissionsOrDeletedFolderTriggersReSelectionCleanly() {
        val (repo, storage, gateway) = newRepo()
        gateway.seedRoot("primary:Documents", "Documents")
        gateway.persistedPermissions.add(gateway.treeUri)
        val bound = repo.bindGrantedTreeUri(gateway.treeUri) as DestinationCheckResult.Ready

        // Revoke persistable permission -> validation clears stale destination and asks to re-select
        gateway.persistedPermissions.remove(gateway.treeUri)
        assertTrue(repo.checkOrValidateDestination() is DestinationCheckResult.NeedsSelection)
        assertNull(storage.load())

        // Re-grant & bind, then delete the InTabPDF folder -> also forces re-selection cleanly
        gateway.persistedPermissions.add(gateway.treeUri)
        repo.bindGrantedTreeUri(gateway.treeUri)
        gateway.nodes.remove(bound.destination.folderDocumentId)
        assertTrue(repo.checkOrValidateDestination() is DestinationCheckResult.NeedsSelection)
        assertNull(storage.load())
    }

    @Test
    fun stagedSwapReplacesWithChangedDocumentIdsWithoutPrematurelyDeletingOriginal() {
        val (repo, _, gateway) = newRepo()
        val root = gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        gateway.persistedPermissions.add(gateway.treeUri)
        repo.bindGrantedTreeUri(gateway.treeUri)

        val oldBytes = "OLD_PDF_BYTES".toByteArray()
        val newBytes = "NEW_REPLACED_PDF_BYTES".toByteArray()
        val oldFile = gateway.seedFile(root.documentId, "Report.pdf", oldBytes)

        val staged = repo.stageBytesToCache(newBytes)
        // Without replaceExisting, conflict is detected case-insensitively
        val conflict = repo.saveStagedPayload(staged, "report.pdf", "application/pdf", replaceExisting = false)
        assertTrue(conflict is SafSaveOutcome.ConflictDetected)
        conflict as SafSaveOutcome.ConflictDetected
        assertEquals("Report.pdf", conflict.existingFileName)
        assertEquals("report (1).pdf", conflict.suggestedFileName)

        // With explicit Replace, staged swap handles rotated document IDs cleanly
        val outcome = repo.saveStagedPayload(staged, "Report.pdf", "application/pdf", replaceExisting = true)
        assertTrue(outcome is SafSaveOutcome.Success)
        outcome as SafSaveOutcome.Success
        assertTrue(outcome.replaced)
        assertFalse(gateway.nodes.containsKey(oldFile.documentId))
        val activeFile = gateway.nodes.values.first { it.displayName == "Report.pdf" }
        assertArrayEquals(newBytes, activeFile.data)
        assertEquals(1, gateway.nodes.values.count { !it.isDirectory })
    }

    @Test
    fun stagedSwapRollbackRestoresOriginalWhenFinalRenameFails() {
        val (repo, _, gateway) = newRepo()
        val root = gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        gateway.persistedPermissions.add(gateway.treeUri)
        repo.bindGrantedTreeUri(gateway.treeUri)

        val oldBytes = "ORIGINAL_MUST_SURVIVE".toByteArray()
        gateway.seedFile(root.documentId, "Contract.pdf", oldBytes)

        // Allow original -> backup rename, then fail temp -> original rename
        gateway.failRenameFromTo = { from, to ->
            from.startsWith("intabpdf_tmp_") && to == "Contract.pdf"
        }

        val staged = repo.stageBytesToCache("NEW_VERSION".toByteArray())
        val outcome = repo.saveStagedPayload(staged, "Contract.pdf", "application/pdf", replaceExisting = true)
        assertTrue(outcome is SafSaveOutcome.Failed)
        assertEquals("REPLACE_ROLLED_BACK", (outcome as SafSaveOutcome.Failed).code)

        val surviving = gateway.nodes.values.firstOrNull { it.displayName == "Contract.pdf" }
        assertArrayEquals(oldBytes, surviving?.data)
        assertEquals(1, gateway.nodes.values.count { !it.isDirectory })
    }

    @Test
    fun stagedSwapPreservesBackupAndRecoveryFileWhenRollbackAlsoFails() {
        val (repo, _, gateway) = newRepo()
        val root = gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        gateway.persistedPermissions.add(gateway.treeUri)
        repo.bindGrantedTreeUri(gateway.treeUri)

        val oldBytes = "CRITICAL_ORIGINAL".toByteArray()
        gateway.seedFile(root.documentId, "TaxReturn.pdf", oldBytes)

        // Succeed backup rename, then fail temp -> target AND fail backup -> target rollback
        gateway.failRenameFromTo = { _, to -> to == "TaxReturn.pdf" }

        val staged = repo.stageBytesToCache("REPLACEMENT_DATA".toByteArray())
        val outcome = repo.saveStagedPayload(staged, "TaxReturn.pdf", "application/pdf", replaceExisting = true)
        assertTrue(outcome is SafSaveOutcome.RecoveryFailed)
        outcome as SafSaveOutcome.RecoveryFailed
        assertTrue(outcome.recoveryId.startsWith("rec_"))
        assertEquals("TaxReturn.pdf", outcome.originalFileName)
        assertEquals("Documents/InTabPDF", outcome.attemptedDestination)
        assertEquals(RecoveryFailureKind.SWAP_AND_ROLLBACK_FAILED, outcome.failureKind)
        assertTrue(outcome.backupAvailable)
        assertEquals(oldBytes.size.toLong(), outcome.sizeBytes)
        // Original backup document remains untouched in SAF directory AND listed in SafRecoveryStore
        val backupInSaf = gateway.nodes.values.firstOrNull { it.displayName.startsWith("intabpdf_bak_") }
        assertArrayEquals(oldBytes, backupInSaf?.data)
        val listed = repo.listRecoveryBackups()
        assertEquals(1, listed.size)
        assertEquals(outcome.recoveryId, listed[0].recoveryId)
    }

    @Test
    fun cacheBackupWtFallbackNeverDowngradesToWModeAndRestoresOnWriteFailure() {
        val (repo, _, gateway) = newRepo()
        val root = gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        gateway.persistedPermissions.add(gateway.treeUri)
        repo.bindGrantedTreeUri(gateway.treeUri)

        // Provider supports WRITE only (no RENAME/DELETE flags) -> selects CACHE_BACKUP_WT
        val oldBytes = "PREVIOUS_CONTENT".toByteArray()
        val doc = gateway.seedFile(
            root.documentId,
            "WriteOnlyDoc.pdf",
            oldBytes,
            flags = DocumentsContract.Document.FLAG_SUPPORTS_WRITE,
        )
        assertEquals(
            SafReplaceStrategy.CACHE_BACKUP_WT,
            SafDocumentRules.chooseReplaceStrategy(doc.flags, root.flags),
        )

        // 1. If "wt" is unsupported, NEVER silently downgrade to "w"; original remains untouched
        gateway.strictWtUnsupported = true
        val staged1 = repo.stageBytesToCache("SHORTER".toByteArray())
        val unsupported = repo.saveStagedPayload(staged1, "WriteOnlyDoc.pdf", "application/pdf", replaceExisting = true)
        assertTrue(unsupported is SafSaveOutcome.ReplaceUnsupported)
        assertFalse(gateway.legacyNonTruncatingWModeUsed)
        assertArrayEquals(oldBytes, doc.data)

        // 2. If "wt" truncates target and first write fails, restore from local backup succeeds cleanly
        gateway.strictWtUnsupported = false
        var failNextWtWrite = true
        gateway.failWriteToDocId = { _, strict ->
            if (strict && failNextWtWrite) {
                failNextWtWrite = false
                IOException("Disk full mid-stream")
            } else {
                null
            }
        }
        val restored = repo.saveStagedPayload(staged1, "WriteOnlyDoc.pdf", "application/pdf", replaceExisting = true)
        assertTrue(restored is SafSaveOutcome.Failed)
        assertEquals("REPLACE_WRITE_FAILED_RESTORED", (restored as SafSaveOutcome.Failed).code)
        assertArrayEquals(oldBytes, doc.data)

        // 3. If both write AND backup restore fail, RecoveryFailed preserves recovery backup on disk
        gateway.failWriteToDocId = { _, _ -> IOException("Persistent write failure") }
        val disaster = repo.saveStagedPayload(staged1, "WriteOnlyDoc.pdf", "application/pdf", replaceExisting = true)
        assertTrue(disaster is SafSaveOutcome.RecoveryFailed)
        disaster as SafSaveOutcome.RecoveryFailed
        assertEquals("WriteOnlyDoc.pdf", disaster.originalFileName)
        assertEquals("Documents/InTabPDF", disaster.attemptedDestination)
        assertTrue(disaster.backupAvailable)
        assertEquals(oldBytes.size.toLong(), disaster.sizeBytes)
        val listed = repo.listRecoveryBackups()
        assertEquals(1, listed.size)
        assertEquals(RecoveryBackupStatus.PENDING_ACTION, listed[0].status)
    }

    @Test
    fun replaceStrategyRefusesDestructiveReplaceWhenWriteRenameDeleteUnsupported() {
        val strategy = SafDocumentRules.chooseReplaceStrategy(
            existingFlags = 0,
            parentFlags = DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE,
        )
        assertEquals(SafReplaceStrategy.UNSUPPORTED_PRESERVE_ORIGINAL, strategy)

        val (repo, _, gateway) = newRepo()
        val root = gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        gateway.persistedPermissions.add(gateway.treeUri)
        repo.bindGrantedTreeUri(gateway.treeUri)
        val readOnlyBytes = "IMMUTABLE_PROVIDER_FILE".toByteArray()
        val readOnlyDoc = gateway.seedFile(root.documentId, "ReadOnly.pdf", readOnlyBytes, flags = 0)

        val staged = repo.stageBytesToCache("NEW".toByteArray())
        val outcome = repo.saveStagedPayload(staged, "ReadOnly.pdf", "application/pdf", replaceExisting = true)
        assertTrue(outcome is SafSaveOutcome.ReplaceUnsupported)
        assertEquals("ReadOnly (1).pdf", (outcome as SafSaveOutcome.ReplaceUnsupported).suggestedFileName)
        assertArrayEquals(readOnlyBytes, readOnlyDoc.data)
    }

    @Test
    fun saveAsNewCopyCreatesUniqueDocumentWithoutModifyingOriginal() {
        val (repo, _, gateway) = newRepo()
        val root = gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        gateway.persistedPermissions.add(gateway.treeUri)
        repo.bindGrantedTreeUri(gateway.treeUri)

        val originalBytes = "ORIGINAL_DOC_BYTES".toByteArray()
        val copyBytes = "NEW_COPY_DOC_BYTES".toByteArray()
        gateway.seedFile(root.documentId, "Invoice.pdf", originalBytes)

        val staged = repo.stageBytesToCache(copyBytes)
        val conflict = repo.saveStagedPayload(staged, "Invoice.pdf", "application/pdf", replaceExisting = false)
        assertTrue(conflict is SafSaveOutcome.ConflictDetected)
        conflict as SafSaveOutcome.ConflictDetected
        assertEquals("Invoice (1).pdf", conflict.suggestedFileName)

        val savedCopy = repo.saveStagedPayload(staged, conflict.suggestedFileName, "application/pdf", replaceExisting = false)
        assertTrue(savedCopy is SafSaveOutcome.Success)
        savedCopy as SafSaveOutcome.Success
        assertEquals("Invoice (1).pdf", savedCopy.savedFileName)
        assertFalse(savedCopy.replaced)

        val origNode = gateway.nodes.values.first { it.displayName == "Invoice.pdf" }
        val copyNode = gateway.nodes.values.first { it.displayName == "Invoice (1).pdf" }
        assertArrayEquals(originalBytes, origNode.data)
        assertArrayEquals(copyBytes, copyNode.data)
    }

    @Test
    fun recoveryBackupSurvivesReloadExportsWithByteVerificationAndDeletesOnlyOnConfirmation() {
        val ctrl = newControlledRepo()
        val root = ctrl.gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        ctrl.gateway.persistedPermissions.add(ctrl.gateway.treeUri)
        ctrl.repo.bindGrantedTreeUri(ctrl.gateway.treeUri)

        val oldBytes = "CRITICAL_BACKUP_BYTES_V1".toByteArray()
        ctrl.gateway.seedFile(
            root.documentId,
            "WriteFail.pdf",
            oldBytes,
            flags = DocumentsContract.Document.FLAG_SUPPORTS_WRITE,
        )
        ctrl.gateway.failWriteToDocId = { _, _ -> IOException("Persistent I/O failure") }

        val staged = ctrl.repo.stageBytesToCache("NEW_OVERWRITE".toByteArray())
        val failed = ctrl.repo.saveStagedPayload(staged, "WriteFail.pdf", "application/pdf", replaceExisting = true)
        assertTrue(failed is SafSaveOutcome.RecoveryFailed)
        failed as SafSaveOutcome.RecoveryFailed

        // Simulate app restart by constructing a fresh SafSaveRepository over the same directories
        val restartedRepo = SafSaveRepository(
            storage = ctrl.storage,
            gateway = ctrl.gateway,
            stagingDir = ctrl.stagingDir,
            recoveryBackupDir = ctrl.recoveryDir,
        )
        val afterRestart = restartedRepo.listRecoveryBackups()
        assertEquals(1, afterRestart.size)
        assertEquals(failed.recoveryId, afterRestart[0].recoveryId)
        assertEquals("WriteFail.pdf", afterRestart[0].originalFileName)
        assertEquals(RecoveryBackupStatus.PENDING_ACTION, afterRestart[0].status)

        // Export via SAF target document
        ctrl.gateway.failWriteToDocId = null
        val exportTarget = ctrl.gateway.seedFile(root.documentId, "WriteFail-recovered.pdf", ByteArray(0))
        val exportRes = restartedRepo.exportRecoveryBackupToUri(
            recoveryId = failed.recoveryId,
            destUriString = ctrl.gateway.buildDocumentUriUsingTree(ctrl.gateway.treeUri, exportTarget.documentId),
            destDisplayName = "WriteFail-recovered.pdf",
        )
        assertTrue(exportRes is SafExportOutcome.Exported)
        exportRes as SafExportOutcome.Exported
        assertTrue(exportRes.backupPreserved)
        assertTrue(exportRes.awaitingDeleteConfirmation)
        assertEquals(oldBytes.size.toLong(), exportRes.bytesWritten)
        assertArrayEquals(oldBytes, exportTarget.data)

        // Backup STILL exists until user explicitly confirms deletion
        val awaitingConfirm = restartedRepo.listRecoveryBackups()
        assertEquals(1, awaitingConfirm.size)
        assertEquals(RecoveryBackupStatus.EXPORTED_AWAITING_CONFIRMATION, awaitingConfirm[0].status)

        val deleteRes = restartedRepo.confirmDeleteRecoveryBackup(failed.recoveryId)
        assertTrue(deleteRes is SafDeleteBackupOutcome.Deleted)
        assertTrue(restartedRepo.listRecoveryBackups().isEmpty())
    }

    @Test
    fun failedExportCleansPartialTargetAndPreservesBackupForRetry() {
        val ctrl = newControlledRepo()
        val root = ctrl.gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        ctrl.gateway.persistedPermissions.add(ctrl.gateway.treeUri)
        ctrl.repo.bindGrantedTreeUri(ctrl.gateway.treeUri)

        val oldBytes = "PRESERVE_ME_THROUGH_FAILED_EXPORT".toByteArray()
        ctrl.gateway.seedFile(
            root.documentId,
            "Locked.pdf",
            oldBytes,
            flags = DocumentsContract.Document.FLAG_SUPPORTS_WRITE,
        )
        ctrl.gateway.failWriteToDocId = { _, _ -> IOException("Write error") }
        val staged = ctrl.repo.stageBytesToCache("NEW".toByteArray())
        val recovery = ctrl.repo.saveStagedPayload(staged, "Locked.pdf", "application/pdf", replaceExisting = true)
            as SafSaveOutcome.RecoveryFailed

        // First export attempt fails mid-stream -> target cleaned up, backup kept for retry
        val badExportTarget = ctrl.gateway.seedFile(root.documentId, "BrokenExport.pdf", ByteArray(0))
        ctrl.gateway.failWriteToDocId = { docId, _ ->
            if (docId == badExportTarget.documentId) IOException("Target storage full") else null
        }
        val exportFail = ctrl.repo.exportRecoveryBackupToUri(
            recoveryId = recovery.recoveryId,
            destUriString = ctrl.gateway.buildDocumentUriUsingTree(ctrl.gateway.treeUri, badExportTarget.documentId),
            destDisplayName = "BrokenExport.pdf",
        )
        assertTrue(exportFail is SafExportOutcome.Failed)
        exportFail as SafExportOutcome.Failed
        assertTrue(exportFail.backupPreserved)
        assertFalse(ctrl.gateway.nodes.containsKey(badExportTarget.documentId))
        assertEquals(1, ctrl.repo.listRecoveryBackups().size)

        // Second export attempt succeeds cleanly with identical bytes
        ctrl.gateway.failWriteToDocId = null
        val goodTarget = ctrl.gateway.seedFile(root.documentId, "RecoveredCopy.pdf", ByteArray(0))
        val exportOk = ctrl.repo.exportRecoveryBackupToUri(
            recoveryId = recovery.recoveryId,
            destUriString = ctrl.gateway.buildDocumentUriUsingTree(ctrl.gateway.treeUri, goodTarget.documentId),
            destDisplayName = "RecoveredCopy.pdf",
        )
        assertTrue(exportOk is SafExportOutcome.Exported)
        assertArrayEquals(oldBytes, goodTarget.data)
    }

    @Test
    fun corruptIndexAndMissingBackupFileAreHandledGracefully() {
        val ctrl = newControlledRepo()
        val indexFile = File(ctrl.recoveryDir, SafRecoveryStore.INDEX_FILE_NAME)
        indexFile.writeText("{not valid json[[")

        // Corrupt JSON never crashes listing and records diagnostic
        assertTrue(ctrl.repo.listRecoveryBackups().isEmpty())
        assertTrue(ctrl.repo.getDiagnosticMessages().isNotEmpty())

        // Missing backing file returns clear failure instead of throwing
        val missingRes = ctrl.repo.exportRecoveryBackupToUri("rec_nonexistent", "content://missing", "x.pdf")
        assertTrue(missingRes is SafExportOutcome.Failed)
        assertEquals("RECOVERY_RECORD_NOT_FOUND", (missingRes as SafExportOutcome.Failed).code)

        // Entry with deleted .bin file handles export cleanly
        val store = SafRecoveryStore(ctrl.recoveryDir)
        indexFile.delete()
        store.upsertRecord(
            RecoveryBackupRecord(
                recoveryId = "rec_missing_bin",
                backupFileName = "rec_missing_bin.bin",
                originalFileName = "OrphanedMeta.pdf",
                mimeType = "application/pdf",
                attemptedDestination = "Documents/InTabPDF",
                explanation = "Test missing file",
                failureKind = RecoveryFailureKind.REPLACE_WRITE_AND_RESTORE_FAILED,
                createdAtMillis = 1234L,
                sizeBytes = 99L,
                status = RecoveryBackupStatus.PENDING_ACTION,
            ),
        )
        val missingFileExport = ctrl.repo.exportRecoveryBackupToUri("rec_missing_bin", "content://any", "OrphanedMeta.pdf")
        assertTrue(missingFileExport is SafExportOutcome.Failed)
        assertEquals("RECOVERY_BACKUP_MISSING", (missingFileExport as SafExportOutcome.Failed).code)
    }

    @Test
    fun failedBackupDeletionKeepsRecordListedAsDeleteFailed() {
        val ctrl = newControlledRepo()
        val root = ctrl.gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        ctrl.gateway.persistedPermissions.add(ctrl.gateway.treeUri)
        ctrl.repo.bindGrantedTreeUri(ctrl.gateway.treeUri)

        val oldBytes = "KEEP_UNTIL_DELETED".toByteArray()
        ctrl.gateway.seedFile(
            root.documentId,
            "DeleteTest.pdf",
            oldBytes,
            flags = DocumentsContract.Document.FLAG_SUPPORTS_WRITE,
        )
        ctrl.gateway.failWriteToDocId = { _, _ -> IOException("Write fail") }
        val staged = ctrl.repo.stageBytesToCache("NEW".toByteArray())
        val rec = ctrl.repo.saveStagedPayload(staged, "DeleteTest.pdf", "application/pdf", replaceExisting = true)
            as SafSaveOutcome.RecoveryFailed

        // Prevent deletion inside recoveryDir temporarily if filesystem enforces permissions
        val binFile = File(ctrl.recoveryDir, "${rec.recoveryId}.bin")
        assertTrue(binFile.exists())
        val lockedDir = ctrl.recoveryDir.setWritable(false)
        try {
            if (lockedDir && !binFile.canWrite()) {
                val delOutcome = ctrl.repo.confirmDeleteRecoveryBackup(rec.recoveryId)
                assertTrue(delOutcome is SafDeleteBackupOutcome.Failed)
                assertTrue((delOutcome as SafDeleteBackupOutcome.Failed).backupPreserved)
                val remaining = ctrl.repo.listRecoveryBackups()
                assertEquals(1, remaining.size)
                assertEquals(RecoveryBackupStatus.DELETE_FAILED, remaining[0].status)
            }
        } finally {
            ctrl.recoveryDir.setWritable(true)
        }
    }

    @Test
    fun cleanupWarningsSurfaceOnLeftoverBackupOrRollbackTempAndSafeCleanupVerifiesTarget() {
        val (repo, _, gateway) = newRepo()
        val root = gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        gateway.persistedPermissions.add(gateway.treeUri)
        repo.bindGrantedTreeUri(gateway.treeUri)

        val oldBytes = "ORIGINAL_DOC".toByteArray()
        val newBytes = "REPLACED_DOC".toByteArray()
        gateway.seedFile(root.documentId, "WarningDoc.pdf", oldBytes)

        // 1. Delete fails after successful swap -> Success WITH structured SafCleanupWarning
        gateway.failDeleteDocId = { docId -> docId.contains("intabpdf_bak_") }
        val staged = repo.stageBytesToCache(newBytes)
        val okWithWarn = repo.saveStagedPayload(staged, "WarningDoc.pdf", "application/pdf", replaceExisting = true)
            as SafSaveOutcome.Success
        assertTrue(okWithWarn.replaced)
        assertTrue(okWithWarn.cleanupWarning != null)
        assertEquals("BACKUP_DELETE_FAILED", okWithWarn.cleanupWarning?.code)
        assertTrue(okWithWarn.cleanupWarning?.leftoverFileName?.startsWith("intabpdf_bak_") == true)

        // Verify safe cleanup removes leftover ONLY after target verification succeeds
        gateway.failDeleteDocId = null
        val cleaned = repo.attemptCleanupLeftoverSafFile(
            leftoverUriString = okWithWarn.cleanupWarning!!.leftoverDocumentUriString!!,
            verifiedTargetUriString = okWithWarn.cleanupWarning!!.verifiedTargetUriString,
            expectedSizeBytes = newBytes.size.toLong(),
        )
        assertTrue(cleaned is SafLeftoverCleanupOutcome.Removed)
        assertEquals(1, gateway.nodes.values.count { !it.isDirectory })

        // 2. Rollback succeeds, but deleting temp file fails -> Failed(originalIntact=true) WITH TEMP_DELETE_FAILED warning
        gateway.failRenameFromTo = { from, to -> from.startsWith("intabpdf_tmp_") && to == "WarningDoc.pdf" }
        gateway.failDeleteDocId = { docId -> docId.contains("intabpdf_tmp_") }
        val rolledBackWarn = repo.saveStagedPayload(staged, "WarningDoc.pdf", "application/pdf", replaceExisting = true)
            as SafSaveOutcome.Failed
        assertEquals("REPLACE_ROLLED_BACK", rolledBackWarn.code)
        assertTrue(rolledBackWarn.originalIntact)
        assertEquals("TEMP_DELETE_FAILED", rolledBackWarn.cleanupWarning?.code)
    }

    @Test
    fun utf8ByteLimitsAndEmojiFilenamesStayBoundedWithoutSplittingCodePoints() {
        // 60 x 4-byte emoji (240 UTF-8 bytes) + ".pdf" -> clamped within MAX_FILE_NAME_UTF8_BYTES (180)
        val emojis = "\uD83D\uDCC4".repeat(60) + ".pdf"
        val sanitized = SafDocumentRules.sanitizeTargetFileName(emojis)
        assertTrue(SafDocumentRules.utf8ByteLength(sanitized) <= SafDocumentRules.MAX_FILE_NAME_UTF8_BYTES)
        assertTrue(sanitized.endsWith(".pdf"))
        // Ensure no lone UTF-16 surrogates remain
        for (i in sanitized.indices) {
            if (Character.isHighSurrogate(sanitized[i])) {
                assertTrue(i + 1 < sanitized.length && Character.isLowSurrogate(sanitized[i + 1]))
            }
        }

        // Long CJK name + temp prefix independently respects MAX_PREFIXED_NAME_UTF8_BYTES (220)
        val cjk = "\u6587\u6863".repeat(45) + ".pdf" // 90 CJK chars = 270 UTF-8 bytes
        val safeUser = SafDocumentRules.sanitizeTargetFileName(cjk)
        val tempPrefixed = SafDocumentRules.buildBoundedPrefixedName(
            prefix = "intabpdf_tmp_1700000000000_",
            targetName = safeUser,
            existingNames = emptyList(),
        )
        assertTrue(SafDocumentRules.utf8ByteLength(tempPrefixed) <= SafDocumentRules.MAX_PREFIXED_NAME_UTF8_BYTES)
        assertTrue(tempPrefixed.startsWith("intabpdf_tmp_1700000000000_"))
        assertTrue(tempPrefixed.endsWith(".pdf"))
    }

    @Test
    fun readOnlyPermissionIsReleasedWithoutTouchingUnrelatedGrants() {
        val (repo, storage, gateway) = newRepo()
        val readOnlyTree = "content://com.example.readonly/tree/docs"
        val unrelatedTree = "content://com.android.externalstorage.documents/tree/unrelated"
        gateway.readOnlyPermissions.add(readOnlyTree)
        gateway.persistedPermissions.add(unrelatedTree)

        val bound = repo.bindGrantedTreeUri(readOnlyTree)
        assertTrue(bound is DestinationCheckResult.NeedsSelection)
        assertFalse(gateway.hasAnyPersistedPermission(readOnlyTree))
        assertTrue(gateway.hasPersistedReadWritePermission(unrelatedTree))
        assertNull(storage.load())
    }

    @Test
    fun stagingCleanupRemovesStaleFilesOnlyAndProtectsRecentActiveUnrelatedAndRecoveryFiles() {
        val ctrl = newControlledRepo(initialNowMillis = 1_000_000L, stagingMaxAgeMillis = 10_000L)
        val siblingCache = File(ctrl.stagingDir.parentFile, "unrelated_cache_dir").apply { mkdirs() }
        val unrelatedFile = File(siblingCache, "keep.txt").apply {
            writeText("unrelated")
            setLastModified(1L)
        }
        val staleFile = File(ctrl.stagingDir, "stage_old.bin").apply {
            writeText("stale")
            setLastModified(500_000L) // well before cutoff (1_000_000 - 10_000)
        }
        val recentFile = File(ctrl.stagingDir, "stage_recent.bin").apply {
            writeText("recent")
            setLastModified(995_000L)
        }
        val recoveryFile = File(ctrl.recoveryDir, "rec_important.bin").apply {
            writeText("backup")
            setLastModified(1L)
        }

        // Start active staging operation at old timestamp -> must NOT be deleted!
        ctrl.clock[0] = 1_000L
        val activeFile = ctrl.repo.stageBytesToCache("ACTIVE".toByteArray())
        ctrl.clock[0] = 1_000_000L

        val report = ctrl.repo.cleanupStaleStagingFiles()
        assertEquals(1, report.removedCount)
        assertEquals(1, report.preservedRecentCount)
        assertEquals(1, report.skippedActiveCount)
        assertFalse(staleFile.exists())
        assertTrue(recentFile.exists())
        assertTrue(activeFile.exists())
        assertTrue(unrelatedFile.exists())
        assertTrue(recoveryFile.exists())

        ctrl.repo.releaseStagedFile(activeFile)
        assertFalse(activeFile.exists())

        // Cleanup failure handling: missing staging dir returns safely with 0 errors; non-dir records cleanly
        ctrl.stagingDir.deleteRecursively()
        val emptyReport = ctrl.repo.cleanupStaleStagingFiles()
        assertEquals(0, emptyReport.removedCount)
    }

    @Test
    fun cacheBackupWtPersistsRecoveryRecordBeforeDestructiveWriteAndSurvivesInterruption() {
        val ctrl = newControlledRepo()
        val root = ctrl.gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        ctrl.gateway.persistedPermissions.add(ctrl.gateway.treeUri)
        ctrl.repo.bindGrantedTreeUri(ctrl.gateway.treeUri)

        val oldBytes = "ORIGINAL_BEFORE_WT_TRUNCATE".toByteArray()
        val doc = ctrl.gateway.seedFile(
            root.documentId,
            "InterruptedWt.pdf",
            oldBytes,
            flags = DocumentsContract.Document.FLAG_SUPPORTS_WRITE,
        )

        var seenDuringWt: List<RecoveryBackupRecord> = emptyList()
        ctrl.gateway.onBeforeWriteToDocId = { docId, strict ->
            if (docId == doc.documentId && strict) {
                // Before "wt" completes, durable record + .bin MUST already exist in SafRecoveryStore!
                seenDuringWt = SafRecoveryStore(ctrl.recoveryDir).listRecords()
                throw RuntimeException("Simulated process crash mid-wt")
            }
        }

        val staged = ctrl.repo.stageBytesToCache("NEW_REPLACEMENT".toByteArray())
        try {
            ctrl.repo.saveStagedPayload(staged, "InterruptedWt.pdf", "application/pdf", replaceExisting = true)
        } catch (_: RuntimeException) {
            // Simulated abrupt termination bypassing normal return
        }

        assertEquals(1, seenDuringWt.size)
        assertEquals("InterruptedWt.pdf", seenDuringWt[0].originalFileName)
        assertEquals(RecoveryFailureKind.INTERRUPTED_REPLACEMENT, seenDuringWt[0].failureKind)
        assertTrue(seenDuringWt[0].backupAvailable)

        // Simulate fresh app restart over the same recovery directory
        val restartedRepo = SafSaveRepository(
            storage = ctrl.storage,
            gateway = ctrl.gateway,
            stagingDir = ctrl.stagingDir,
            recoveryBackupDir = ctrl.recoveryDir,
        )
        val afterRestart = restartedRepo.listRecoveryBackups()
        assertEquals(1, afterRestart.size)
        assertEquals("InterruptedWt.pdf", afterRestart[0].originalFileName)
        assertTrue(afterRestart[0].backupAvailable)
        assertEquals("local", afterRestart[0].recoverySource)

        val exportTarget = ctrl.gateway.seedFile(root.documentId, "InterruptedWt-recovered.pdf", ByteArray(0))
        val exportRes = restartedRepo.exportRecoveryBackupToUri(
            recoveryId = afterRestart[0].recoveryId,
            destUriString = ctrl.gateway.buildDocumentUriUsingTree(ctrl.gateway.treeUri, exportTarget.documentId),
            destDisplayName = "InterruptedWt-recovered.pdf",
        )
        assertTrue(exportRes is SafExportOutcome.Exported)
        assertArrayEquals(oldBytes, exportTarget.data)
    }

    @Test
    fun shortWriteAndShortRollbackInCacheBackupWtPreserveLocalBackup() {
        val ctrl = newControlledRepo()
        val root = ctrl.gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        ctrl.gateway.persistedPermissions.add(ctrl.gateway.treeUri)
        ctrl.repo.bindGrantedTreeUri(ctrl.gateway.treeUri)

        val oldBytes = "FULL_ORIGINAL_CONTENT_123456".toByteArray()
        val newBytes = "LONGER_REPLACEMENT_PAYLOAD_0123456789".toByteArray()
        val doc = ctrl.gateway.seedFile(
            root.documentId,
            "ShortWrite.pdf",
            oldBytes,
            flags = DocumentsContract.Document.FLAG_SUPPORTS_WRITE,
        )

        // Both initial replacement write AND rollback write return fewer bytes than expected
        ctrl.gateway.overrideWriteByteCount = { docId ->
            if (docId == doc.documentId) 4L else null
        }

        val staged = ctrl.repo.stageBytesToCache(newBytes)
        val outcome = ctrl.repo.saveStagedPayload(staged, "ShortWrite.pdf", "application/pdf", replaceExisting = true)
        assertTrue(outcome is SafSaveOutcome.RecoveryFailed)
        outcome as SafSaveOutcome.RecoveryFailed
        assertTrue(outcome.backupAvailable)
        assertEquals(oldBytes.size.toLong(), outcome.sizeBytes)

        val binFile = File(ctrl.recoveryDir, "${outcome.recoveryId}.bin")
        assertTrue(binFile.exists())
        assertArrayEquals(oldBytes, binFile.readBytes())
    }

    @Test
    fun recoveryIndexRecoversFromBakTmpCorruptIndexAndDiscoversOrphanBinFilesHonestly() {
        val ctrl = newControlledRepo()
        val store = SafRecoveryStore(ctrl.recoveryDir)

        val rec1Bytes = "RECORD_ONE_BYTES".toByteArray()
        File(ctrl.recoveryDir, "rec_one.bin").writeBytes(rec1Bytes)
        val rec1 = RecoveryBackupRecord(
            recoveryId = "rec_one",
            backupFileName = "rec_one.bin",
            originalFileName = "First.pdf",
            mimeType = "application/pdf",
            attemptedDestination = "Documents/InTabPDF",
            explanation = "First failure",
            failureKind = RecoveryFailureKind.REPLACE_WRITE_AND_RESTORE_FAILED,
            createdAtMillis = 1000L,
            sizeBytes = rec1Bytes.size.toLong(),
            status = RecoveryBackupStatus.PENDING_ACTION,
        )
        store.upsertRecord(rec1)

        // Add rec_two so .bak holds [rec_one] and index holds [rec_two, rec_one]
        val rec2Bytes = "RECORD_TWO_BYTES".toByteArray()
        File(ctrl.recoveryDir, "rec_two.bin").writeBytes(rec2Bytes)
        val rec2 = rec1.copy(
            recoveryId = "rec_two",
            backupFileName = "rec_two.bin",
            originalFileName = "Second.pdf",
            createdAtMillis = 2000L,
            sizeBytes = rec2Bytes.size.toLong(),
        )
        store.upsertRecord(rec2)

        // Corrupt indexFile (truncate halfway through rec_two) and place an unindexed orphan rec_orphan.bin
        val indexFile = File(ctrl.recoveryDir, SafRecoveryStore.INDEX_FILE_NAME)
        val validJson = indexFile.readText()
        indexFile.writeText(validJson.substring(0, validJson.length / 2))
        val orphanBytes = "ORPHAN_BINARY_PAYLOAD".toByteArray()
        File(ctrl.recoveryDir, "rec_orphan.bin").writeBytes(orphanBytes)

        val listed = SafRecoveryStore(ctrl.recoveryDir).listRecords()
        // Both rec_one & rec_two recovered from .bak, AND rec_orphan.bin discovered honestly!
        assertEquals(3, listed.size)
        assertTrue(File(ctrl.recoveryDir, "${SafRecoveryStore.INDEX_FILE_NAME}.corrupt").exists())

        val orphan = listed.first { it.recoveryId == "rec_orphan" }
        assertTrue(orphan.backupAvailable)
        assertEquals(RecoveryFailureKind.ORPHANED_BACKUP, orphan.failureKind)
        assertEquals("Unknown (metadata unavailable)", orphan.attemptedDestination)
        assertFalse(orphan.originalFileName.contains("First.pdf"))
        assertEquals(orphanBytes.size.toLong(), orphan.sizeBytes)

        // Upserting rec_three must NOT erase rec_one / rec_two recovered from .bak!
        val rec3Bytes = "THREE".toByteArray()
        File(ctrl.recoveryDir, "rec_three.bin").writeBytes(rec3Bytes)
        store.upsertRecord(
            rec1.copy(
                recoveryId = "rec_three",
                backupFileName = "rec_three.bin",
                originalFileName = "Third.pdf",
                createdAtMillis = 3000L,
                sizeBytes = rec3Bytes.size.toLong(),
            ),
        )
        val afterUpsert = SafRecoveryStore(ctrl.recoveryDir).listRecords()
        assertTrue(afterUpsert.any { it.recoveryId == "rec_one" })
        assertTrue(afterUpsert.any { it.recoveryId == "rec_two" })
        assertTrue(afterUpsert.any { it.recoveryId == "rec_three" })
        assertTrue(afterUpsert.any { it.recoveryId == "rec_orphan" })

        // Export and explicitly delete the discovered orphan via SafSaveRepository
        val root = ctrl.gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        val target = ctrl.gateway.seedFile(root.documentId, "OrphanExport.bin", ByteArray(0))
        val exportRes = ctrl.repo.exportRecoveryBackupToUri(
            recoveryId = "rec_orphan",
            destUriString = ctrl.gateway.buildDocumentUriUsingTree(ctrl.gateway.treeUri, target.documentId),
            destDisplayName = "OrphanExport.bin",
        )
        assertTrue(exportRes is SafExportOutcome.Exported)
        assertArrayEquals(orphanBytes, target.data)
        assertTrue(ctrl.repo.confirmDeleteRecoveryBackup("rec_orphan") is SafDeleteBackupOutcome.Deleted)
        assertFalse(File(ctrl.recoveryDir, "rec_orphan.bin").exists())
    }

    @Test
    fun indexRecoversFromTmpWhenIndexFileIsDeletedMidUpdate() {
        val ctrl = newControlledRepo()
        val store = SafRecoveryStore(ctrl.recoveryDir)
        val recBytes = "TMP_RECOVERY_BYTES".toByteArray()
        File(ctrl.recoveryDir, "rec_tmp.bin").writeBytes(recBytes)
        val rec = RecoveryBackupRecord(
            recoveryId = "rec_tmp",
            backupFileName = "rec_tmp.bin",
            originalFileName = "TmpDoc.pdf",
            mimeType = "application/pdf",
            attemptedDestination = "Documents/InTabPDF",
            explanation = "Testing tmp recovery",
            failureKind = RecoveryFailureKind.SWAP_AND_ROLLBACK_FAILED,
            createdAtMillis = 5000L,
            sizeBytes = recBytes.size.toLong(),
            status = RecoveryBackupStatus.PENDING_ACTION,
        )
        store.upsertRecord(rec)

        val indexFile = File(ctrl.recoveryDir, SafRecoveryStore.INDEX_FILE_NAME)
        val tmpFile = File(ctrl.recoveryDir, "${SafRecoveryStore.INDEX_FILE_NAME}.tmp")
        tmpFile.writeText(indexFile.readText())
        assertTrue(indexFile.delete())

        val recovered = SafRecoveryStore(ctrl.recoveryDir).listRecords()
        assertEquals(1, recovered.size)
        assertEquals("TmpDoc.pdf", recovered[0].originalFileName)
    }

    @Test
    fun stagedSwapDoubleFailureWithLocalCopyErrorPersistsSafOnlyRecordVerifiesAccessAndExports() {
        val ctrl = newControlledRepo()
        val root = ctrl.gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        ctrl.gateway.persistedPermissions.add(ctrl.gateway.treeUri)
        ctrl.repo.bindGrantedTreeUri(ctrl.gateway.treeUri)

        val oldBytes = "SAF_ONLY_ORIGINAL_BYTES".toByteArray()
        ctrl.gateway.seedFile(root.documentId, "SafOnly.pdf", oldBytes)

        ctrl.gateway.failRenameFromTo = { _, to -> to == "SafOnly.pdf" }
        ctrl.gateway.failReadFromDocId = { docId ->
            if (docId.contains("intabpdf_bak_")) IOException("Transient read error during local copy") else null
        }

        val staged = ctrl.repo.stageBytesToCache("NEW_REPLACE".toByteArray())
        val outcome = ctrl.repo.saveStagedPayload(staged, "SafOnly.pdf", "application/pdf", replaceExisting = true)
        assertTrue(outcome is SafSaveOutcome.RecoveryFailed)
        outcome as SafSaveOutcome.RecoveryFailed
        assertTrue(outcome.backupAvailable)
        assertTrue(outcome.safBackupAvailable)
        assertEquals("saf", outcome.recoverySource)
        assertTrue(outcome.safBackupDocumentName?.startsWith("intabpdf_bak_") == true)
        // Incomplete local copy must have been cleaned since SAF backup remained intact
        assertFalse(File(ctrl.recoveryDir, "${outcome.recoveryId}.bin").exists())
        assertFalse(File(ctrl.recoveryDir, "${outcome.recoveryId}.bin.part").exists())

        // Persisted across restart and verifiable!
        val restartedRepo = SafSaveRepository(
            storage = ctrl.storage,
            gateway = ctrl.gateway,
            stagingDir = ctrl.stagingDir,
            recoveryBackupDir = ctrl.recoveryDir,
        )
        val listedAccessible = restartedRepo.listRecoveryBackups()
        assertEquals(1, listedAccessible.size)
        assertTrue(listedAccessible[0].backupAvailable)
        assertTrue(listedAccessible[0].safBackupAvailable)
        assertEquals("saf", listedAccessible[0].recoverySource)

        // If SAF permission is revoked, availability accurately drops to false/unavailable!
        ctrl.gateway.persistedPermissions.remove(ctrl.gateway.treeUri)
        val listedRevoked = restartedRepo.listRecoveryBackups()
        assertEquals(1, listedRevoked.size)
        assertFalse(listedRevoked[0].backupAvailable)
        assertFalse(listedRevoked[0].safBackupAvailable)
        assertEquals("unavailable", listedRevoked[0].recoverySource)

        // Restore permission & clear transient read error -> SAF-only export succeeds with exact bytes!
        ctrl.gateway.persistedPermissions.add(ctrl.gateway.treeUri)
        ctrl.gateway.failReadFromDocId = null
        val exportTarget = ctrl.gateway.seedFile(root.documentId, "SafOnly-recovered.pdf", ByteArray(0))
        val exportRes = restartedRepo.exportRecoveryBackupToUri(
            recoveryId = outcome.recoveryId,
            destUriString = ctrl.gateway.buildDocumentUriUsingTree(ctrl.gateway.treeUri, exportTarget.documentId),
            destDisplayName = "SafOnly-recovered.pdf",
        )
        assertTrue(exportRes is SafExportOutcome.Exported)
        assertArrayEquals(oldBytes, exportTarget.data)
    }

    @Test
    fun activeExportBlocksDeletionUntilExportCompletesAndNonReplaceVerifiesSize() {
        val ctrl = newControlledRepo()
        val root = ctrl.gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        ctrl.gateway.persistedPermissions.add(ctrl.gateway.treeUri)
        ctrl.repo.bindGrantedTreeUri(ctrl.gateway.treeUri)

        val recBytes = "ACTIVE_EXPORT_GUARD".toByteArray()
        File(ctrl.recoveryDir, "rec_guard.bin").writeBytes(recBytes)
        SafRecoveryStore(ctrl.recoveryDir).upsertRecord(
            RecoveryBackupRecord(
                recoveryId = "rec_guard",
                backupFileName = "rec_guard.bin",
                originalFileName = "Guard.pdf",
                mimeType = "application/pdf",
                attemptedDestination = "Documents/InTabPDF",
                explanation = "Guard test",
                failureKind = RecoveryFailureKind.REPLACE_WRITE_AND_RESTORE_FAILED,
                createdAtMillis = 1000L,
                sizeBytes = recBytes.size.toLong(),
                status = RecoveryBackupStatus.PENDING_ACTION,
            ),
        )

        assertTrue(ctrl.repo.beginRecoveryExport("rec_guard"))
        assertFalse(ctrl.repo.beginRecoveryExport("rec_guard"))
        val blockedDelete = ctrl.repo.confirmDeleteRecoveryBackup("rec_guard")
        assertTrue(blockedDelete is SafDeleteBackupOutcome.Failed)
        assertEquals("EXPORT_IN_PROGRESS", (blockedDelete as SafDeleteBackupOutcome.Failed).code)
        assertTrue(blockedDelete.backupPreserved)

        ctrl.repo.endRecoveryExport("rec_guard")
        assertTrue(ctrl.repo.confirmDeleteRecoveryBackup("rec_guard") is SafDeleteBackupOutcome.Deleted)

        // M-6: Non-replace short write cleans up created document and reports WRITE_VERIFY_FAILED
        ctrl.gateway.overrideWriteByteCount = { 2L }
        val staged = ctrl.repo.stageBytesToCache("FULL_PAYLOAD".toByteArray())
        val shortNew = ctrl.repo.saveStagedPayload(staged, "NewShort.pdf", "application/pdf", replaceExisting = false)
        assertTrue(shortNew is SafSaveOutcome.Failed)
        assertEquals("WRITE_VERIFY_FAILED", (shortNew as SafSaveOutcome.Failed).code)
        assertFalse(ctrl.gateway.nodes.values.any { it.displayName == "NewShort.pdf" })
        ctrl.gateway.overrideWriteByteCount = null

        // M-5: Exporting over an existing non-empty target requires strictTruncate ("wt")
        val nonEmptyBytes = "NON_EMPTY_EXPORT".toByteArray()
        File(ctrl.recoveryDir, "rec_wt_export.bin").writeBytes(nonEmptyBytes)
        SafRecoveryStore(ctrl.recoveryDir).upsertRecord(
            RecoveryBackupRecord(
                recoveryId = "rec_wt_export",
                backupFileName = "rec_wt_export.bin",
                originalFileName = "WtExport.pdf",
                mimeType = "application/pdf",
                attemptedDestination = "Documents/InTabPDF",
                explanation = "Test wt export",
                failureKind = RecoveryFailureKind.REPLACE_WRITE_AND_RESTORE_FAILED,
                createdAtMillis = 2000L,
                sizeBytes = nonEmptyBytes.size.toLong(),
                status = RecoveryBackupStatus.PENDING_ACTION,
            ),
        )
        val existingDestBytes = "OLD_LONGER_EXISTING_TARGET".toByteArray()
        val existingDest = ctrl.gateway.seedFile(root.documentId, "ExistingTarget.pdf", existingDestBytes)
        ctrl.gateway.strictWtUnsupported = true
        val wtFail = ctrl.repo.exportRecoveryBackupToUri(
            "rec_wt_export",
            ctrl.gateway.buildDocumentUriUsingTree(ctrl.gateway.treeUri, existingDest.documentId),
            "ExistingTarget.pdf",
        )
        assertTrue(wtFail is SafExportOutcome.Failed)
        assertEquals("EXPORT_TRUNCATE_UNSUPPORTED", (wtFail as SafExportOutcome.Failed).code)
        assertTrue(wtFail.backupPreserved)
        assertFalse(ctrl.gateway.legacyNonTruncatingWModeUsed)
        assertTrue(ctrl.gateway.nodes.containsKey(existingDest.documentId))
        assertArrayEquals(existingDestBytes, existingDest.data)
        ctrl.gateway.strictWtUnsupported = false

        // M-4: Failed bindGrantedTreeUri releases newly persisted grant cleanly
        val badTree = "content://com.android.externalstorage.documents/tree/primary%3AReadOnlyDir"
        ctrl.gateway.persistedPermissions.add(badTree)
        ctrl.gateway.seedRoot("primary:ReadOnlyDir", "ReadOnlyDir", flags = 0)
        // Re-bind with root that cannot create InTabPDF subfolder -> releases permission
        val badGateway = FakeSafTreeGateway().apply {
            persistedPermissions.add(treeUri)
            seedRoot("primary:CannotCreate", "CannotCreate", flags = 0)
        }
        val badRepo = SafSaveRepository(
            storage = InMemoryDestinationStorage(),
            gateway = badGateway,
            stagingDir = ctrl.stagingDir,
            recoveryBackupDir = ctrl.recoveryDir,
        )
        val bindFail = badRepo.bindGrantedTreeUri(badGateway.treeUri)
        assertTrue(bindFail is DestinationCheckResult.Failed)
        assertFalse(badGateway.hasPersistedReadWritePermission(badGateway.treeUri))
    }

    @Test
    fun failedRecoveryExportPreservesPreExistingDestinationAndCleansUpOnlyNewlyCreatedEmptyTargets() {
        val ctrl = newControlledRepo()
        val root = ctrl.gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        ctrl.gateway.persistedPermissions.add(ctrl.gateway.treeUri)
        ctrl.repo.bindGrantedTreeUri(ctrl.gateway.treeUri)

        val backupBytes = "CRITICAL_RECOVERY_BACKUP_BYTES".toByteArray()
        File(ctrl.recoveryDir, "rec_export_guard.bin").writeBytes(backupBytes)
        SafRecoveryStore(ctrl.recoveryDir).upsertRecord(
            RecoveryBackupRecord(
                recoveryId = "rec_export_guard",
                backupFileName = "rec_export_guard.bin",
                originalFileName = "Important.pdf",
                mimeType = "application/pdf",
                attemptedDestination = "Documents/InTabPDF",
                explanation = "Guard export destination deletion",
                failureKind = RecoveryFailureKind.REPLACE_WRITE_AND_RESTORE_FAILED,
                createdAtMillis = 1000L,
                sizeBytes = backupBytes.size.toLong(),
                status = RecoveryBackupStatus.PENDING_ACTION,
            ),
        )

        // 1. Pre-existing non-empty destination survives UnsupportedTruncateModeException with exact original bytes
        val existingBytes = "PREEXISTING_NON_EMPTY_TARGET_CONTENT".toByteArray()
        val existingTarget = ctrl.gateway.seedFile(root.documentId, "ExistingReport.pdf", existingBytes)
        val existingTargetUri = ctrl.gateway.buildDocumentUriUsingTree(ctrl.gateway.treeUri, existingTarget.documentId)
        ctrl.gateway.strictWtUnsupported = true
        val unsupportedOutcome = ctrl.repo.exportRecoveryBackupToUri("rec_export_guard", existingTargetUri, "ExistingReport.pdf")
        assertTrue(unsupportedOutcome is SafExportOutcome.Failed)
        unsupportedOutcome as SafExportOutcome.Failed
        assertEquals("EXPORT_TRUNCATE_UNSUPPORTED", unsupportedOutcome.code)
        assertTrue(unsupportedOutcome.backupPreserved)
        assertTrue(ctrl.gateway.nodes.containsKey(existingTarget.documentId))
        assertArrayEquals(existingBytes, existingTarget.data)
        ctrl.gateway.strictWtUnsupported = false

        // 2. Pre-existing non-empty destination is NOT deleted on short write or verification failure
        ctrl.gateway.overrideWriteByteCount = { docId ->
            if (docId == existingTarget.documentId) 5L else null
        }
        val shortOutcome = ctrl.repo.exportRecoveryBackupToUri("rec_export_guard", existingTargetUri, "ExistingReport.pdf")
        assertTrue(shortOutcome is SafExportOutcome.Failed)
        shortOutcome as SafExportOutcome.Failed
        assertEquals("EXPORT_VERIFY_FAILED", shortOutcome.code)
        assertTrue(shortOutcome.backupPreserved)
        assertTrue(ctrl.gateway.nodes.containsKey(existingTarget.documentId))
        ctrl.gateway.overrideWriteByteCount = null

        // 2b. Pre-existing destination also survives a post-write metadata verification failure
        ctrl.gateway.overrideReportedSizeForDocId = { docId, bytes ->
            if (docId == existingTarget.documentId && bytes.contentEquals(backupBytes)) {
                backupBytes.size.toLong() - 1L
            } else {
                null
            }
        }
        val metaVerifyFailOutcome = ctrl.repo.exportRecoveryBackupToUri("rec_export_guard", existingTargetUri, "ExistingReport.pdf")
        assertTrue(metaVerifyFailOutcome is SafExportOutcome.Failed)
        metaVerifyFailOutcome as SafExportOutcome.Failed
        assertEquals("EXPORT_VERIFY_FAILED", metaVerifyFailOutcome.code)
        assertTrue(metaVerifyFailOutcome.backupPreserved)
        assertTrue(ctrl.gateway.nodes.containsKey(existingTarget.documentId))
        ctrl.gateway.overrideReportedSizeForDocId = null

        // 3. Newly created 0-byte destination IS cleaned up on short-write failure
        val newlyCreatedEmpty = ctrl.gateway.seedFile(root.documentId, "NewPartialExport.pdf", ByteArray(0))
        val newlyCreatedUri = ctrl.gateway.buildDocumentUriUsingTree(ctrl.gateway.treeUri, newlyCreatedEmpty.documentId)
        ctrl.gateway.overrideWriteByteCount = { docId ->
            if (docId == newlyCreatedEmpty.documentId) 4L else null
        }
        val partialOutcome = ctrl.repo.exportRecoveryBackupToUri("rec_export_guard", newlyCreatedUri, "NewPartialExport.pdf")
        assertTrue(partialOutcome is SafExportOutcome.Failed)
        assertTrue((partialOutcome as SafExportOutcome.Failed).backupPreserved)
        assertFalse(ctrl.gateway.nodes.containsKey(newlyCreatedEmpty.documentId))
        ctrl.gateway.overrideWriteByteCount = null

        // 4. Recovery backup remains available across all failed export attempts and exports cleanly afterwards
        val listed = ctrl.repo.listRecoveryBackups()
        assertEquals(1, listed.size)
        assertTrue(listed[0].backupAvailable)
        val cleanTarget = ctrl.gateway.seedFile(root.documentId, "Important-recovered.pdf", ByteArray(0))
        val ok = ctrl.repo.exportRecoveryBackupToUri(
            "rec_export_guard",
            ctrl.gateway.buildDocumentUriUsingTree(ctrl.gateway.treeUri, cleanTarget.documentId),
            "Important-recovered.pdf",
        )
        assertTrue(ok is SafExportOutcome.Exported)
        assertArrayEquals(backupBytes, cleanTarget.data)
    }

    @Test
    fun stagedSwapRejectsShortWriteEvenWhenProviderOmitsReportedSize() {
        val (repo, _, gateway) = newRepo()
        val root = gateway.seedRoot("primary:Documents/InTabPDF", "InTabPDF")
        gateway.persistedPermissions.add(gateway.treeUri)
        repo.bindGrantedTreeUri(gateway.treeUri)

        val originalBytes = "ORIGINAL_CANNOT_BE_REPLACED_BY_SHORT_TEMP".toByteArray()
        val originalNode = gateway.seedFile(root.documentId, "Quarterly.pdf", originalBytes)

        // Provider omits COLUMN_SIZE (sizeBytes = null) on staged temp and writes fewer bytes than stagedFile.length()
        gateway.omitReportedSizeForDocId = { docId -> docId.contains("intabpdf_tmp_") }
        gateway.overrideWriteByteCount = { docId -> if (docId.contains("intabpdf_tmp_")) 5L else null }

        val stagedNew = repo.stageBytesToCache("FULL_REPLACEMENT_PAYLOAD_1234567890".toByteArray())
        val outcome = repo.saveStagedPayload(stagedNew, "Quarterly.pdf", "application/pdf", replaceExisting = true)

        assertTrue(outcome is SafSaveOutcome.Failed)
        outcome as SafSaveOutcome.Failed
        assertEquals("STAGED_VERIFY_FAILED", outcome.code)
        assertTrue(outcome.originalIntact)

        // Original remains untouched at its original document ID and no temp/backup leftovers exist
        assertTrue(gateway.nodes.containsKey(originalNode.documentId))
        assertArrayEquals(originalBytes, originalNode.data)
        assertEquals(1, gateway.nodes.values.count { !it.isDirectory })
    }

    @Test
    fun saveLocalFileToDocumentUriWritesNewDocumentAndHandlesConflictsAndReplaceSafely() {
        val (repo, _, gateway) = newRepo()
        val root = gateway.seedRoot("primary:Documents", "Documents")
        val payloadBytes = "%PDF-1.4\nSCANNED_BYTES".toByteArray()
        val sourcePdf = tempFolder.newFile("Scan_20261126_170000.pdf").apply {
            writeBytes(payloadBytes)
        }

        // 1. Newly created empty ACTION_CREATE_DOCUMENT target saves cleanly
        val createdEmpty = gateway.seedFile(root.documentId, "Scan_20261126_170000.pdf", ByteArray(0))
        val createdUri = gateway.buildDocumentUriUsingTree(gateway.treeUri, createdEmpty.documentId)
        val saved = repo.saveLocalFileToDocumentUri(
            sourceFile = sourcePdf,
            destUriString = createdUri,
            destDisplayName = "Scan_20261126_170000.pdf",
        )
        assertTrue(saved is SafSaveOutcome.Success)
        saved as SafSaveOutcome.Success
        assertEquals("Scan_20261126_170000.pdf", saved.savedFileName)
        assertFalse(saved.replaced)
        assertArrayEquals(payloadBytes, createdEmpty.data)

        // 2. Existing non-empty target returns ConflictDetected without overwriting when replaceExisting=false
        val existingBytes = "EXISTING_PDF_CONTENT".toByteArray()
        val existingDoc = gateway.seedFile(root.documentId, "Invoice.pdf", existingBytes)
        val existingUri = gateway.buildDocumentUriUsingTree(gateway.treeUri, existingDoc.documentId)
        val conflict = repo.saveLocalFileToDocumentUri(
            sourceFile = sourcePdf,
            destUriString = existingUri,
            destDisplayName = "Invoice.pdf",
            replaceExisting = false,
        )
        assertTrue(conflict is SafSaveOutcome.ConflictDetected)
        conflict as SafSaveOutcome.ConflictDetected
        assertEquals("Invoice.pdf", conflict.existingFileName)
        assertEquals("Invoice (1).pdf", conflict.suggestedFileName)
        assertArrayEquals(existingBytes, existingDoc.data)

        // 3. Explicit replaceExisting=true safely backs up original, overwrites with "wt", and cleans backup
        val replaced = repo.saveLocalFileToDocumentUri(
            sourceFile = sourcePdf,
            destUriString = existingUri,
            destDisplayName = "Invoice.pdf",
            replaceExisting = true,
        )
        assertTrue(replaced is SafSaveOutcome.Success)
        assertTrue((replaced as SafSaveOutcome.Success).replaced)
        assertArrayEquals(payloadBytes, existingDoc.data)
        assertTrue(repo.listRecoveryBackups().isEmpty())

        // 4. Provider without FLAG_SUPPORTS_WRITE returns ReplaceUnsupported and keeps original intact
        val readOnlyBytes = "READ_ONLY_EXISTING".toByteArray()
        val readOnlyDoc = gateway.seedFile(root.documentId, "LockedScan.pdf", readOnlyBytes, flags = 0)
        val readOnlyUri = gateway.buildDocumentUriUsingTree(gateway.treeUri, readOnlyDoc.documentId)
        val unsupported = repo.saveLocalFileToDocumentUri(
            sourceFile = sourcePdf,
            destUriString = readOnlyUri,
            destDisplayName = "LockedScan.pdf",
            replaceExisting = true,
        )
        assertTrue(unsupported is SafSaveOutcome.ReplaceUnsupported)
        assertEquals("LockedScan (1).pdf", (unsupported as SafSaveOutcome.ReplaceUnsupported).suggestedFileName)
        assertArrayEquals(readOnlyBytes, readOnlyDoc.data)

        // 5. Short-write failure on newly created 0-byte document deletes broken target cleanly
        val brokenEmpty = gateway.seedFile(root.documentId, "Broken.pdf", ByteArray(0))
        val brokenUri = gateway.buildDocumentUriUsingTree(gateway.treeUri, brokenEmpty.documentId)
        gateway.overrideWriteByteCount = { docId -> if (docId == brokenEmpty.documentId) 3L else null }
        val failed = repo.saveLocalFileToDocumentUri(
            sourceFile = sourcePdf,
            destUriString = brokenUri,
            destDisplayName = "Broken.pdf",
        )
        assertTrue(failed is SafSaveOutcome.Failed)
        assertEquals("WRITE_VERIFY_FAILED", (failed as SafSaveOutcome.Failed).code)
        assertFalse(gateway.nodes.containsKey(brokenEmpty.documentId))
    }
}
