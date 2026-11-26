package org.intabtools.intabpdf.save

import android.Manifest
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ProviderInfo
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class DocumentSavePluginInstrumentationTest {

    private lateinit var context: Context
    private lateinit var providerRootDir: File
    private lateinit var stagingDir: File
    private lateinit var recoveryDir: File
    private lateinit var wrappedResolver: ContentResolver

    @Before
    fun setUp() {
        TestDocumentsProvider.resetFaults()
        context = ApplicationProvider.getApplicationContext()
        providerRootDir = File(context.cacheDir, "test_saf_provider_root").apply {
            deleteRecursively()
            mkdirs()
        }
        stagingDir = File(context.cacheDir, "instr_saf_staging").apply {
            deleteRecursively()
            mkdirs()
        }
        recoveryDir = File(context.filesDir, "instr_saf_recovery").apply {
            deleteRecursively()
            mkdirs()
        }

        val provider = TestDocumentsProvider()
        val info = ProviderInfo().apply {
            authority = TestDocumentsProvider.AUTHORITY
            exported = true
            grantUriPermissions = true
            writePermission = android.Manifest.permission.MANAGE_DOCUMENTS
            readPermission = android.Manifest.permission.MANAGE_DOCUMENTS
        }
        provider.attachInfo(context, info)
        wrappedResolver = ContentResolver.wrap(provider)
    }

    @Test
    fun manifestQueriesPickersWithoutBroadStoragePermissionsAndExposesCapacitorPluginMethods() {
        val pm = context.packageManager

        @Suppress("DEPRECATION")
        val pkgInfo = pm.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
        val perms = pkgInfo.requestedPermissions?.toSet().orEmpty()
        assertFalse("Must not request READ_EXTERNAL_STORAGE", perms.contains(Manifest.permission.READ_EXTERNAL_STORAGE))
        assertFalse("Must not request WRITE_EXTERNAL_STORAGE", perms.contains(Manifest.permission.WRITE_EXTERNAL_STORAGE))
        assertFalse("Must not request MANAGE_EXTERNAL_STORAGE", perms.contains("android.permission.MANAGE_DOCUMENTS_OR_ALL".let { "android.permission.MANAGE_EXTERNAL_STORAGE" }))

        val treeIntent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                putExtra(
                    DocumentsContract.EXTRA_INITIAL_URI,
                    DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Documents"),
                )
            }
        }
        val treeHandlers = pm.queryIntentActivities(treeIntent, PackageManager.MATCH_DEFAULT_ONLY)
        assertTrue("Expected Android DocumentsUI tree picker to handle ACTION_OPEN_DOCUMENT_TREE", treeHandlers.isNotEmpty())

        val createIntent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/pdf"
            putExtra(Intent.EXTRA_TITLE, "recovered.pdf")
        }
        val createHandlers = pm.queryIntentActivities(createIntent, PackageManager.MATCH_DEFAULT_ONLY)
        assertTrue("Expected Android DocumentsUI picker to handle ACTION_CREATE_DOCUMENT", createHandlers.isNotEmpty())

        val pluginAnn = DocumentSavePlugin::class.java.getAnnotation(CapacitorPlugin::class.java)
        assertNotNull("Expected @CapacitorPlugin on DocumentSavePlugin", pluginAnn)
        assertEquals("DocumentSave", pluginAnn?.name)
        val methods = DocumentSavePlugin::class.java.methods
            .filter { it.getAnnotation(PluginMethod::class.java) != null }
            .map { it.name }
            .toSet()
        assertTrue(methods.contains("prepareSaveDestination"))
        assertTrue(methods.contains("writeToDestination"))
        assertTrue(methods.contains("listRecoveryBackups"))
        assertTrue(methods.contains("exportRecoveryBackup"))
        assertTrue(methods.contains("confirmDeleteRecoveryBackup"))
        assertTrue(methods.contains("cleanupLeftoverSafFile"))
    }

    @Test
    fun safStoreAndGatewayValidateRevokedPermissionsAndBuildRealDocumentsContractUris() {
        val store = SharedPrefsSafDestinationStorage(context)
        store.clear()
        val gateway = AndroidSafTreeGateway(context)
        val repo = SafSaveRepository(
            storage = store,
            gateway = gateway,
            stagingDir = stagingDir,
            recoveryBackupDir = recoveryDir,
        )

        val checkEmpty = repo.checkOrValidateDestination()
        assertTrue(checkEmpty is DestinationCheckResult.NeedsSelection)

        val ungrantedUri = DocumentsContract.buildTreeDocumentUri(
            "com.android.externalstorage.documents",
            "primary:Documents/InTabPDF",
        )
        val folderDocUri = gateway.buildDocumentUriUsingTree(ungrantedUri.toString(), "primary:Documents/InTabPDF")
        store.save(
            PersistedSafDestination(
                treeUriString = ungrantedUri.toString(),
                folderUriString = folderDocUri,
                folderDocumentId = "primary:Documents/InTabPDF",
                folderDisplayName = "InTabPDF",
                displayPath = "Documents/InTabPDF",
            ),
        )
        assertTrue(repo.checkOrValidateDestination() is DestinationCheckResult.NeedsSelection)
        assertNull(store.load())

        val docUriString = gateway.buildDocumentUriUsingTree(ungrantedUri.toString(), "primary:Documents/InTabPDF/test.pdf")
        val docUri = Uri.parse(docUriString)
        assertEquals("com.android.externalstorage.documents", docUri.authority)
        assertEquals("primary:Documents/InTabPDF", DocumentsContract.getTreeDocumentId(ungrantedUri))
        assertEquals("primary:Documents/InTabPDF/test.pdf", DocumentsContract.getDocumentId(docUri))
    }

    @Test
    fun realContentResolverAndTestDocumentsProviderExecuteCreateRenameWtTruncateAndDelete() {
        val realGateway = AndroidSafTreeGateway(context, wrappedResolver)
        val treeUri = DocumentsContract.buildTreeDocumentUri(
            TestDocumentsProvider.AUTHORITY,
            TestDocumentsProvider.ROOT_DOC_ID,
        )
        val folderDocUri = realGateway.buildDocumentUriUsingTree(
            treeUri.toString(),
            TestDocumentsProvider.ROOT_DOC_ID,
        )

        val inTabDir = realGateway.createDirectory(folderDocUri, "InTabPDF")!!
        assertEquals("InTabPDF", inTabDir.displayName)
        assertTrue(inTabDir.isDirectory)

        val created = realGateway.createDocument(inTabDir.uriString, "application/pdf", "LiveDoc.pdf")!!
        val originalLong = "ORIGINAL_LONGER_PDF_PAYLOAD_0123456789".toByteArray()
        val tempOrig = File(stagingDir, "src_orig.bin").apply { writeBytes(originalLong) }
        assertEquals(originalLong.size.toLong(), realGateway.copyLocalFileToDocument(tempOrig, created.uriString, strictTruncate = false))

        // ParcelFileDescriptor "wt" overwrite to shorter content leaves zero trailing bytes
        val shorterPayload = "SHORT".toByteArray()
        val tempShort = File(stagingDir, "src_short.bin").apply { writeBytes(shorterPayload) }
        assertEquals(shorterPayload.size.toLong(), realGateway.copyLocalFileToDocument(tempShort, created.uriString, strictTruncate = true))
        assertEquals(shorterPayload.size.toLong(), realGateway.measureDocumentByteSize(created.uriString))
        val onDisk = File(providerRootDir, "InTabPDF/LiveDoc.pdf")
        assertArrayEquals(shorterPayload, onDisk.readBytes())

        // renameDocument refreshes rotated documentId + URI cleanly
        val renamed = realGateway.renameDocument(
            treeUriString = treeUri.toString(),
            folderDocumentId = inTabDir.documentId,
            documentUriString = created.uriString,
            newDisplayName = "RenamedDoc.pdf",
        )!!
        assertEquals("RenamedDoc.pdf", renamed.displayName)
        assertTrue(renamed.documentId.endsWith("RenamedDoc.pdf"))
        assertTrue(realGateway.deleteDocument(renamed.uriString))
        assertFalse(File(providerRootDir, "InTabPDF/RenamedDoc.pdf").exists())
    }

    @Test
    fun recoveryEnumerationExportByteEqualityFailurePreservationAndStagingCleanupWorkEndToEndOnAndroid() {
        val realGateway = AndroidSafTreeGateway(context, wrappedResolver)
        val treeUri = DocumentsContract.buildTreeDocumentUri(
            TestDocumentsProvider.AUTHORITY,
            TestDocumentsProvider.ROOT_DOC_ID,
        )
        val folderDocUri = realGateway.buildDocumentUriUsingTree(treeUri.toString(), TestDocumentsProvider.ROOT_DOC_ID)

        val recoveryStore = SafRecoveryStore(recoveryDir)
        val originalBytes = "%PDF-1.4\nRecovery Content Bytes 12345\n%%EOF".toByteArray()
        val backupId = "rec_android_instr_1"
        val backupBin = File(recoveryDir, "$backupId.bin").apply { writeBytes(originalBytes) }
        recoveryStore.upsertRecord(
            RecoveryBackupRecord(
                recoveryId = backupId,
                backupFileName = backupBin.name,
                originalFileName = "Statement.pdf",
                mimeType = "application/pdf",
                attemptedDestination = "Documents/InTabPDF",
                explanation = "Simulated recovery test",
                failureKind = RecoveryFailureKind.REPLACE_WRITE_AND_RESTORE_FAILED,
                createdAtMillis = System.currentTimeMillis(),
                sizeBytes = originalBytes.size.toLong(),
                status = RecoveryBackupStatus.PENDING_ACTION,
            ),
        )

        val repo = SafSaveRepository(
            storage = SharedPrefsSafDestinationStorage(context),
            gateway = realGateway,
            stagingDir = stagingDir,
            recoveryBackupDir = recoveryDir,
            stagingMaxAgeMillis = 10_000L,
        )

        val listed = repo.listRecoveryBackups()
        assertEquals(1, listed.size)
        assertEquals("Statement.pdf", listed[0].originalFileName)
        assertTrue(listed[0].backupAvailable)

        // Failed export preserves backup and cleans partial/failed destination doc
        val failingTarget = realGateway.createDocument(folderDocUri, "application/pdf", "fail_write_export.pdf")!!
        val failOutcome = repo.exportRecoveryBackupToUri(backupId, failingTarget.uriString, "fail_write_export.pdf")
        assertTrue(failOutcome is SafExportOutcome.Failed)
        assertTrue((failOutcome as SafExportOutcome.Failed).backupPreserved)
        assertTrue(backupBin.exists())
        assertEquals(1, repo.listRecoveryBackups().size)

        // Successful export streams exact identical bytes via ContentResolver.wrap(DocumentsProvider)
        val goodTarget = realGateway.createDocument(folderDocUri, "application/pdf", "Statement-recovered.pdf")!!
        val okOutcome = repo.exportRecoveryBackupToUri(backupId, goodTarget.uriString, "Statement-recovered.pdf")
        assertTrue(okOutcome is SafExportOutcome.Exported)
        okOutcome as SafExportOutcome.Exported
        assertEquals(originalBytes.size.toLong(), okOutcome.bytesWritten)
        assertTrue(okOutcome.awaitingDeleteConfirmation)
        assertArrayEquals(originalBytes, File(providerRootDir, "Statement-recovered.pdf").readBytes())
        assertTrue(backupBin.exists())

        // Stale staging cleanup removes abandoned staging file while leaving recovery backup untouched
        val staleStage = File(stagingDir, "stage_old.bin").apply {
            writeText("abandoned")
            setLastModified(1_000L)
        }
        val report = repo.cleanupStaleStagingFiles()
        assertEquals(1, report.removedCount)
        assertFalse(staleStage.exists())
        assertTrue(backupBin.exists())

        // Explicit confirmation removes both backup file and index entry
        val deleted = repo.confirmDeleteRecoveryBackup(backupId)
        assertTrue(deleted is SafDeleteBackupOutcome.Deleted)
        assertFalse(backupBin.exists())
        assertTrue(repo.listRecoveryBackups().isEmpty())
    }

    private fun newBoundProviderRepo(
        resolver: ContentResolver = wrappedResolver,
        persistedTreeUris: MutableSet<String> = mutableSetOf(
            DocumentsContract.buildTreeDocumentUri(
                TestDocumentsProvider.AUTHORITY,
                TestDocumentsProvider.ROOT_DOC_ID,
            ).toString(),
        ),
    ): Triple<SafSaveRepository, SafTreeGateway, String> {
        val treeUri = DocumentsContract.buildTreeDocumentUri(
            TestDocumentsProvider.AUTHORITY,
            TestDocumentsProvider.ROOT_DOC_ID,
        ).toString()
        val delegate = AndroidSafTreeGateway(context, resolver)
        val gateway = object : SafTreeGateway by delegate {
            override fun hasPersistedReadWritePermission(treeUriString: String): Boolean =
                persistedTreeUris.contains(treeUriString)

            override fun hasAnyPersistedPermission(treeUriString: String): Boolean =
                persistedTreeUris.contains(treeUriString)

            override fun releasePersistedPermissionBestEffort(treeUriString: String) {
                persistedTreeUris.remove(treeUriString)
            }
        }
        val storage = SharedPrefsSafDestinationStorage(context).apply { clear() }
        val repo = SafSaveRepository(
            storage = storage,
            gateway = gateway,
            stagingDir = stagingDir,
            recoveryBackupDir = recoveryDir,
        )
        val bound = repo.bindGrantedTreeUri(treeUri)
        assertTrue("Expected bindGrantedTreeUri to succeed", bound is DestinationCheckResult.Ready)
        return Triple(repo, gateway, treeUri)
    }

    @Test
    fun safOnlyDoubleFailureCancellationAndExportOverNonEmptyTargetWorkOnAndroid() {
        val (repo, gateway, treeUri) = newBoundProviderRepo()
        val original = "%PDF-1.4\nSAF Only Android Document\n%%EOF".toByteArray()
        val stagedOrig = repo.stageBytesToCache(original)
        assertTrue(repo.saveStagedPayload(stagedOrig, "SafOnly.pdf", "application/pdf", replaceExisting = false) is SafSaveOutcome.Success)

        // Double rename failure + local read failure -> persists durable SAF-only record
        TestDocumentsProvider.failRenameTargetName = "SafOnly.pdf"
        TestDocumentsProvider.failReadPrefix = "intabpdf_bak_"
        val stagedNew = repo.stageBytesToCache("NEW_REPLACE".toByteArray())
        val recoveryFailed = repo.saveStagedPayload(stagedNew, "SafOnly.pdf", "application/pdf", replaceExisting = true)
        assertTrue(recoveryFailed is SafSaveOutcome.RecoveryFailed)
        recoveryFailed as SafSaveOutcome.RecoveryFailed
        assertTrue(recoveryFailed.backupAvailable)
        assertTrue(recoveryFailed.safBackupAvailable)
        assertEquals("saf", recoveryFailed.recoverySource)

        // Export from SAF-only backup after restart verifies exact bytes & preserves SAF backup
        TestDocumentsProvider.resetFaults()
        val restartedRepo = SafSaveRepository(
            storage = SharedPrefsSafDestinationStorage(context),
            gateway = gateway,
            stagingDir = stagingDir,
            recoveryBackupDir = recoveryDir,
        )
        val rootDocUri = gateway.buildDocumentUriUsingTree(treeUri, TestDocumentsProvider.ROOT_DOC_ID)
        val nonEmptyTarget = gateway.createDocument(rootDocUri, "application/pdf", "SafOnly-existing.pdf")!!
        val prefillBytes = "MUCH_LONGER_EXISTING_CONTENT_THAT_MUST_BE_TRUNCATED".toByteArray()
        val prefill = repo.stageBytesToCache(prefillBytes)
        assertEquals(prefillBytes.size.toLong(), gateway.copyLocalFileToDocument(prefill, nonEmptyTarget.uriString, strictTruncate = false))

        val exported = restartedRepo.exportRecoveryBackupToUri(
            recoveryId = recoveryFailed.recoveryId,
            destUriString = nonEmptyTarget.uriString,
            destDisplayName = "SafOnly-existing.pdf",
        )
        assertTrue(exported is SafExportOutcome.Exported)
        assertArrayEquals(original, File(providerRootDir, "SafOnly-existing.pdf").readBytes())
        assertTrue(restartedRepo.confirmDeleteRecoveryBackup(recoveryFailed.recoveryId) is SafDeleteBackupOutcome.Deleted)
        // Explicit record dismissal does not delete the user's SAF backup copy in Documents/InTabPDF
        assertTrue(File(providerRootDir, "InTabPDF/${recoveryFailed.safBackupDocumentName}").exists())
    }

    @Test
    fun stagedSwapRollbackAndDoubleFailurePersistAcrossRestartAndExportEqualBytesOnAndroid() {
        val (repo, gateway, treeUri) = newBoundProviderRepo()
        val original = "%PDF-1.4\nOriginal Critical Document\n%%EOF".toByteArray()
        val stagedOrig = repo.stageBytesToCache(original)
        assertTrue(repo.saveStagedPayload(stagedOrig, "Contract.pdf", "application/pdf", replaceExisting = false) is SafSaveOutcome.Success)

        // 1. Rename temp -> target fails, rollback backup -> target succeeds -> original stays intact!
        TestDocumentsProvider.failRenameTargetName = "Contract.pdf"
        TestDocumentsProvider.failRenameSourcePrefix = "intabpdf_tmp_"
        val stagedNew = repo.stageBytesToCache("NEW_VERSION".toByteArray())
        val rolledBack = repo.saveStagedPayload(stagedNew, "Contract.pdf", "application/pdf", replaceExisting = true)
        assertTrue(rolledBack is SafSaveOutcome.Failed)
        assertEquals("REPLACE_ROLLED_BACK", (rolledBack as SafSaveOutcome.Failed).code)
        assertTrue(rolledBack.originalIntact)
        assertArrayEquals(original, File(providerRootDir, "InTabPDF/Contract.pdf").readBytes())

        // 2. Both temp -> target AND backup -> target fail -> durable recovery record + .bin created
        TestDocumentsProvider.failRenameSourcePrefix = null
        TestDocumentsProvider.failRenameTargetName = "Contract.pdf"
        val recoveryFailed = repo.saveStagedPayload(stagedNew, "Contract.pdf", "application/pdf", replaceExisting = true)
        assertTrue(recoveryFailed is SafSaveOutcome.RecoveryFailed)
        recoveryFailed as SafSaveOutcome.RecoveryFailed
        assertTrue(recoveryFailed.backupAvailable)

        // Simulate app restart with fresh SafSaveRepository instance
        TestDocumentsProvider.resetFaults()
        val restartedRepo = SafSaveRepository(
            storage = SharedPrefsSafDestinationStorage(context),
            gateway = gateway,
            stagingDir = stagingDir,
            recoveryBackupDir = recoveryDir,
        )
        val listed = restartedRepo.listRecoveryBackups()
        assertEquals(1, listed.size)
        assertEquals("Contract.pdf", listed[0].originalFileName)

        // In-flight export lock protects against deletion while export is active
        assertTrue(restartedRepo.beginRecoveryExport(recoveryFailed.recoveryId))
        val blockedDel = restartedRepo.confirmDeleteRecoveryBackup(recoveryFailed.recoveryId)
        assertTrue(blockedDel is SafDeleteBackupOutcome.Failed)
        assertEquals("EXPORT_IN_PROGRESS", (blockedDel as SafDeleteBackupOutcome.Failed).code)
        restartedRepo.endRecoveryExport(recoveryFailed.recoveryId)

        // Export via provider document & verify exact byte equality
        val folderDocUri = gateway.buildDocumentUriUsingTree(treeUri, TestDocumentsProvider.ROOT_DOC_ID)
        val exportDoc = gateway.createDocument(folderDocUri, "application/pdf", "Contract-restored.pdf")!!
        val exportRes = restartedRepo.exportRecoveryBackupToUri(
            recoveryId = recoveryFailed.recoveryId,
            destUriString = exportDoc.uriString,
            destDisplayName = "Contract-restored.pdf",
        )
        assertTrue(exportRes is SafExportOutcome.Exported)
        assertArrayEquals(original, File(providerRootDir, "Contract-restored.pdf").readBytes())
        assertTrue(restartedRepo.confirmDeleteRecoveryBackup(recoveryFailed.recoveryId) is SafDeleteBackupOutcome.Deleted)
        assertTrue(restartedRepo.listRecoveryBackups().isEmpty())
    }

    @Test
    fun cacheBackupWtUnsupportedAndWriteFailureRestoreAndOrphanDiscoveryWorkOnAndroid() {
        val (repo, gateway, treeUri) = newBoundProviderRepo()
        val original = "%PDF-1.4\nWriteOnly Original Content\n%%EOF".toByteArray()
        val stagedOrig = repo.stageBytesToCache(original)
        assertTrue(repo.saveStagedPayload(stagedOrig, "WriteOnly.pdf", "application/pdf", replaceExisting = false) is SafSaveOutcome.Success)

        // Restrict provider document flags to FLAG_SUPPORTS_WRITE only -> forces CACHE_BACKUP_WT
        TestDocumentsProvider.overrideFileFlags = DocumentsContract.Document.FLAG_SUPPORTS_WRITE

        // 1. Unsupported "wt" mode must preserve original untouched (no downgrade to "w")
        TestDocumentsProvider.simulateWtUnsupported = true
        val stagedShort = repo.stageBytesToCache("SHORT".toByteArray())
        val unsupported = repo.saveStagedPayload(stagedShort, "WriteOnly.pdf", "application/pdf", replaceExisting = true)
        assertTrue(unsupported is SafSaveOutcome.ReplaceUnsupported)
        assertArrayEquals(original, File(providerRootDir, "InTabPDF/WriteOnly.pdf").readBytes())

        // 2. First "wt" truncates then fails -> verified restore brings back exact original bytes
        TestDocumentsProvider.simulateWtUnsupported = false
        TestDocumentsProvider.failNextWtWrite = true
        val restored = repo.saveStagedPayload(stagedShort, "WriteOnly.pdf", "application/pdf", replaceExisting = true)
        assertTrue(restored is SafSaveOutcome.Failed)
        assertEquals("REPLACE_WRITE_FAILED_RESTORED", (restored as SafSaveOutcome.Failed).code)
        assertArrayEquals(original, File(providerRootDir, "InTabPDF/WriteOnly.pdf").readBytes())

        // 3. Orphaned rec_*.bin file in recoveryDir is discovered after restart and exportable
        val orphanPayload = "ORPHAN_ANDROID_RECOVERY_BYTES".toByteArray()
        val orphanFile = File(recoveryDir, "rec_android_orphan.bin").apply { writeBytes(orphanPayload) }
        val restartedRepo = SafSaveRepository(
            storage = SharedPrefsSafDestinationStorage(context),
            gateway = gateway,
            stagingDir = stagingDir,
            recoveryBackupDir = recoveryDir,
        )
        val discovered = restartedRepo.listRecoveryBackups()
        assertEquals(1, discovered.size)
        assertEquals(RecoveryFailureKind.ORPHANED_BACKUP, discovered[0].failureKind)

        val rootDocUri = gateway.buildDocumentUriUsingTree(treeUri, TestDocumentsProvider.ROOT_DOC_ID)
        val orphanTarget = gateway.createDocument(rootDocUri, "application/octet-stream", "orphan.bin")!!
        val exported = restartedRepo.exportRecoveryBackupToUri("rec_android_orphan", orphanTarget.uriString, "orphan.bin")
        assertTrue(exported is SafExportOutcome.Exported)
        assertArrayEquals(orphanPayload, File(providerRootDir, "orphan.bin").readBytes())
        assertTrue(restartedRepo.confirmDeleteRecoveryBackup("rec_android_orphan") is SafDeleteBackupOutcome.Deleted)
        assertFalse(orphanFile.exists())
    }
}
