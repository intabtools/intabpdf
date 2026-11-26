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
        var failReadFromDocId: ((String) -> Throwable?)? = null
        var failRenameFromTo: ((String, String) -> Boolean)? = null
        var failDeleteDocId: ((String) -> Boolean)? = null
        var strictWtUnsupported = false
        var legacyNonTruncatingWModeUsed = false
        var rotateIdOnRename = true
        var forceListChildrenFailure = false

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

        override fun releasePersistedPermissionBestEffort(treeUriString: String) {
            persistedPermissions.remove(treeUriString)
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
            val bytes = localFile.readBytes()
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

        private fun FakeDocNode.toEntry(uri: String) = SafChildEntry(
            documentId = documentId,
            displayName = displayName,
            mimeType = mimeType,
            flags = flags,
            sizeBytes = if (isDirectory) null else data.size.toLong(),
            uriString = uri,
        )
    }

    private fun newRepo(
        storage: InMemoryDestinationStorage = InMemoryDestinationStorage(),
        gateway: FakeSafTreeGateway = FakeSafTreeGateway(),
    ): Triple<SafSaveRepository, InMemoryDestinationStorage, FakeSafTreeGateway> {
        val stagingDir = tempFolder.newFolder("staging_${System.nanoTime()}")
        val recoveryDir = tempFolder.newFolder("recovery_${System.nanoTime()}")
        val repo = SafSaveRepository(
            storage = storage,
            gateway = gateway,
            stagingDir = stagingDir,
            recoveryBackupDir = recoveryDir,
            clockMillis = { 1_700_000_000_000L },
        )
        return Triple(repo, storage, gateway)
    }

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
        assertEquals(DestinationCheckResult.NeedsSelection, repo.checkOrValidateDestination())
        assertNull(storage.load())

        // Re-grant & bind, then delete the InTabPDF folder -> also forces re-selection cleanly
        gateway.persistedPermissions.add(gateway.treeUri)
        repo.bindGrantedTreeUri(gateway.treeUri)
        gateway.nodes.remove(bound.destination.folderDocumentId)
        assertEquals(DestinationCheckResult.NeedsSelection, repo.checkOrValidateDestination())
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
        assertTrue(File(outcome.recoveryLocation).exists())
        // Backup document remains untouched in SAF directory!
        val backupInSaf = gateway.nodes.values.firstOrNull { it.displayName.startsWith("intabpdf_bak_") }
        assertArrayEquals(oldBytes, backupInSaf?.data)
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
        assertTrue(File((disaster as SafSaveOutcome.RecoveryFailed).recoveryLocation).exists())
        assertArrayEquals(oldBytes, File(disaster.recoveryLocation).readBytes())
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
}
