package org.intabtools.intabpdf.savetodevice

import android.Manifest
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.SystemClock
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.intabtools.intabpdf.MainActivity
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SaveToDeviceInstrumentationTest {

    @Test
    fun manifestRegistersSaveToDeviceWithoutBroadStoragePermissionsOrMainActivityShare() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val pm = context.packageManager

        val testMimeTypes = listOf(
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "text/markdown",
            "text/csv",
            "application/rtf",
            "image/png",
            "image/webp",
            "*/*",
        )

        for (mime in testMimeTypes) {
            val sendIntent = Intent(Intent.ACTION_SEND).apply {
                type = mime
                `package` = context.packageName
            }
            val sendMatches = pm.queryIntentActivities(sendIntent, PackageManager.MATCH_DEFAULT_ONLY)
            assertTrue(
                "Expected SaveToDeviceActivity to match ACTION_SEND for $mime",
                sendMatches.any { it.activityInfo.name == SaveToDeviceActivity::class.java.name },
            )
            assertFalse(
                "MainActivity must not register as ACTION_SEND share target",
                sendMatches.any { it.activityInfo.name == MainActivity::class.java.name },
            )

            val multiIntent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = mime
                `package` = context.packageName
            }
            val multiMatches = pm.queryIntentActivities(multiIntent, PackageManager.MATCH_DEFAULT_ONLY)
            assertTrue(
                "Expected SaveToDeviceActivity to match ACTION_SEND_MULTIPLE for $mime",
                multiMatches.any { it.activityInfo.name == SaveToDeviceActivity::class.java.name },
            )
            assertFalse(
                "MainActivity must not register as ACTION_SEND_MULTIPLE share target",
                multiMatches.any { it.activityInfo.name == MainActivity::class.java.name },
            )
        }

        val info = pm.queryIntentActivities(
            Intent(Intent.ACTION_SEND).apply {
                type = "*/*"
                `package` = context.packageName
            },
            PackageManager.MATCH_DEFAULT_ONLY,
        ).first { it.activityInfo.name == SaveToDeviceActivity::class.java.name }
        assertEquals("InTabPDF – Save to Device", info.loadLabel(pm).toString())

        @Suppress("DEPRECATION")
        val pkgInfo = pm.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
        val perms = pkgInfo.requestedPermissions?.toSet().orEmpty()
        assertFalse(perms.contains(Manifest.permission.READ_EXTERNAL_STORAGE))
        assertFalse(perms.contains(Manifest.permission.WRITE_EXTERNAL_STORAGE))
        assertFalse(perms.contains("android.permission.MANAGE_EXTERNAL_STORAGE"))
    }

    @Test
    fun singleFileContentUriIntentParsesResolvesAndStreamsIdenticalBytesWithoutModifyingSource(): Unit = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val cacheTestDir = File(context.cacheDir, "share_test_${UUID.randomUUID()}").apply { mkdirs() }
        val srcFile = File(cacheTestDir, "Quarterly Report.docx")
        val payload = ByteArray(1_200_000) { idx -> ((idx * 17 + 5) and 0xFF).toByte() }
        srcFile.writeBytes(payload)
        val sourceDigestBefore = sha256(payload)

        val destFile = File(cacheTestDir, "saved_output.docx")
        try {
            val contentUri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                srcFile,
            )

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "*/*"
                putExtra(Intent.EXTRA_STREAM, contentUri)
                clipData = ClipData.newRawUri("shared", contentUri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            val parsed = AndroidShareSaveGateway.parseIncomingIntent(shareIntent)
            assertEquals(listOf(contentUri.toString()), parsed.uriStrings)
            assertFalse(parsed.isMultiple)

            val gateway = AndroidShareSaveGateway(context)
            val coordinator = SaveToDeviceCoordinator(
                gateway = gateway,
                mainDispatcher = Dispatchers.Default,
            )
            try {
                coordinator.initializeFromShare(parsed, shareIntent.type)
                val awaiting = waitForState<SaveToDeviceUiState.AwaitingDestination>(coordinator)
                assertEquals(1, awaiting.items.size)
                val descriptor = awaiting.items.first()
                assertEquals("Quarterly Report.docx", descriptor.displayName)
                assertEquals(
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    descriptor.mimeType,
                )

                // Stream into destination URI via ContentResolver
                coordinator.onSingleDestinationSelected(Uri.fromFile(destFile))
                val success = waitForState<SaveToDeviceUiState.Success>(coordinator)
                assertEquals(1, success.savedFiles.size)
                assertEquals(payload.size.toLong(), success.totalBytesCopied)
                assertArrayEquals(sourceDigestBefore, sha256(destFile.readBytes()))
                // Source file must remain completely untouched
                assertArrayEquals(sourceDigestBefore, sha256(srcFile.readBytes()))
            } finally {
                coordinator.clear()
            }
        } finally {
            cacheTestDir.deleteRecursively()
        }
    }

    @Test
    fun pickerCancellationReadWriteFailuresAndInvalidUrisAreHandledSafely() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val cacheTestDir = File(context.cacheDir, "share_err_${UUID.randomUUID()}").apply { mkdirs() }
        try {
            // 1. Missing display name resolves safely using MIME hint
            val noExtFile = File(cacheTestDir, "raw_item")
            noExtFile.writeText("# Markdown Heading")
            val contentUri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", noExtFile)
            val descriptors = AndroidShareSaveGateway(context).resolveDescriptors(
                ResolvedShareInput(listOf(contentUri.toString()), isMultiple = false),
                intentMimeType = "text/markdown",
            )
            assertEquals("raw_item.md", descriptors.first().displayName)
            assertEquals("text/markdown", descriptors.first().mimeType)

            // 2. Picker cancellation ends cleanly in Cancelled without Error state
            val gateway = object : ShareSaveGateway {
                override fun resolveDescriptors(input: ResolvedShareInput, intentMimeType: String?) = descriptors
                override fun copySingleToDocumentUri(
                    source: SharedFileDescriptor,
                    destUri: Uri,
                    isCancelled: () -> Boolean,
                    onProgress: (Long) -> Unit,
                ) = throw IOException("Storage is full")

                override fun copyMultipleToTreeUri(
                    sources: List<SharedFileDescriptor>,
                    treeUri: Uri,
                    isCancelled: () -> Boolean,
                    onProgress: (Int, Int, String, Long, Long?) -> Unit,
                ) = BatchCopyOutcome(emptyList(), emptyList())
            }

            val cancelCoord = SaveToDeviceCoordinator(gateway, mainDispatcher = Dispatchers.Default)
            cancelCoord.initializeFromShare(ResolvedShareInput(listOf(contentUri.toString()), false), "text/markdown")
            waitForState<SaveToDeviceUiState.AwaitingDestination>(cancelCoord)
            cancelCoord.onDestinationCancelled()
            assertEquals(SaveToDeviceUiState.Cancelled, cancelCoord.uiState.value)
            cancelCoord.clear()

            // 3. Write failure allows retry destination; revoked SecurityException blocks retry cleanly
            val writeFailCoord = SaveToDeviceCoordinator(gateway, mainDispatcher = Dispatchers.Default)
            writeFailCoord.initializeFromShare(ResolvedShareInput(listOf(contentUri.toString()), false), "text/markdown")
            waitForState<SaveToDeviceUiState.AwaitingDestination>(writeFailCoord)
            writeFailCoord.onSingleDestinationSelected(Uri.fromFile(File(cacheTestDir, "dest.md")))
            val errState = waitForState<SaveToDeviceUiState.Error>(writeFailCoord)
            assertTrue(errState.canRetryDestination)
            assertTrue(errState.message.contains("Storage is full"))
            writeFailCoord.clear()

            // 4. SecurityException & non-existent content:// URI handling
            val secGateway = object : ShareSaveGateway {
                override fun resolveDescriptors(input: ResolvedShareInput, intentMimeType: String?) = descriptors
                override fun copySingleToDocumentUri(
                    source: SharedFileDescriptor,
                    destUri: Uri,
                    isCancelled: () -> Boolean,
                    onProgress: (Long) -> Unit,
                ): Long = throw SecurityException("Permission revoked")

                override fun copyMultipleToTreeUri(
                    sources: List<SharedFileDescriptor>,
                    treeUri: Uri,
                    isCancelled: () -> Boolean,
                    onProgress: (Int, Int, String, Long, Long?) -> Unit,
                ) = BatchCopyOutcome(
                    savedFiles = emptyList(),
                    failedFiles = listOf(FailedFileResult("content://provider/1", "notes.txt", "Disk full")),
                    cancelledFiles = listOf("remaining.pdf"),
                    cleanupFailedCount = 1,
                )
            }
            val secCoord = SaveToDeviceCoordinator(secGateway, mainDispatcher = Dispatchers.Default)
            secCoord.initializeFromShare(ResolvedShareInput(listOf(contentUri.toString()), false), "text/markdown")
            waitForState<SaveToDeviceUiState.AwaitingDestination>(secCoord)
            secCoord.onSingleDestinationSelected(Uri.fromFile(File(cacheTestDir, "dest2.md")))
            val secErr = waitForState<SaveToDeviceUiState.Error>(secCoord)
            assertFalse(secErr.canRetryDestination)
            assertTrue(secCoord.consumeCompletionToastFlag())
            assertFalse(secCoord.consumeCompletionToastFlag())
            secCoord.clear()

            // Cleanup failure warning surfaces in multi-file Error outcome
            val partialCoord = SaveToDeviceCoordinator(secGateway, mainDispatcher = Dispatchers.Default)
            partialCoord.initializeFromShare(
                ResolvedShareInput(listOf("content://provider/1", "content://provider/2"), isMultiple = true),
                intentMimeType = "*/*",
            )
            waitForState<SaveToDeviceUiState.AwaitingDestination>(partialCoord)
            partialCoord.onMultipleDestinationTreeSelected(Uri.parse("content://com.android.externalstorage.documents/tree/primary%3ADownload"))
            val partialErr = waitForState<SaveToDeviceUiState.Error>(partialCoord)
            assertNotNull(partialErr.cleanupWarning)
            partialCoord.clear()

            // 5. Invalid/unsafe file:// URI is rejected without throwing or launching MainActivity
            val unsafeIntent = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, Uri.parse("file:///data/data/org.intabtools.intabpdf/secret.pdf"))
            }
            val rejectedParsed = AndroidShareSaveGateway.parseIncomingIntent(unsafeIntent)
            assertTrue(rejectedParsed.uriStrings.isEmpty())
            assertEquals(1, rejectedParsed.rejectedCount)

            val launchBadIntent = Intent(context, SaveToDeviceActivity::class.java).apply {
                action = Intent.ACTION_SEND
                type = "application/pdf"
            }
            ActivityScenario.launch<SaveToDeviceActivity>(launchBadIntent).use { scenario ->
                assertNotNull(scenario)
                val deadline = SystemClock.uptimeMillis() + 3000L
                while (SystemClock.uptimeMillis() < deadline &&
                    scenario.state != Lifecycle.State.RESUMED
                ) {
                    SystemClock.sleep(50L)
                }
                assertEquals(Lifecycle.State.RESUMED, scenario.state)
            }
        } finally {
            cacheTestDir.deleteRecursively()
        }
    }

    @Test
    fun multipleFileShareDeduplicatesNamesAndHandlesPartialBatchOutcome() = runBlocking {
        val sources = listOf(
            SharedFileDescriptor("content://provider/1", "notes.txt", "text/plain", 120L),
            SharedFileDescriptor("content://provider/2", "notes.txt", "text/plain", 240L),
            SharedFileDescriptor("content://provider/3", "missing.pdf", "application/pdf", 500L),
        )
        val batchGateway = object : ShareSaveGateway {
            override fun resolveDescriptors(input: ResolvedShareInput, intentMimeType: String?) = sources
            override fun copySingleToDocumentUri(
                source: SharedFileDescriptor,
                destUri: Uri,
                isCancelled: () -> Boolean,
                onProgress: (Long) -> Unit,
            ) = 0L

            override fun copyMultipleToTreeUri(
                sources: List<SharedFileDescriptor>,
                treeUri: Uri,
                isCancelled: () -> Boolean,
                onProgress: (Int, Int, String, Long, Long?) -> Unit,
            ): BatchCopyOutcome {
                val existing = mutableSetOf<String>()
                val name1 = SharedFileMetadata.deduplicateFileName(sources[0].displayName, existing)
                val name2 = SharedFileMetadata.deduplicateFileName(sources[1].displayName, existing)
                return BatchCopyOutcome(
                    savedFiles = listOf(
                        SavedFileResult(sources[0].uriString, name1, 120L),
                        SavedFileResult(sources[1].uriString, name2, 240L),
                    ),
                    failedFiles = listOf(
                        FailedFileResult(sources[2].uriString, sources[2].displayName, "Unavailable"),
                    ),
                )
            }
        }

        val coord = SaveToDeviceCoordinator(batchGateway, mainDispatcher = Dispatchers.Default)
        try {
            coord.initializeFromShare(
                ResolvedShareInput(sources.map { it.uriString }, isMultiple = true),
                intentMimeType = "*/*",
            )
            val awaiting = waitForState<SaveToDeviceUiState.AwaitingDestination>(coord)
            assertTrue(awaiting.isMultiple)
            assertEquals(3, awaiting.items.size)

            coord.onMultipleDestinationTreeSelected(Uri.parse("content://com.android.externalstorage.documents/tree/primary%3ADownload"))
            val success = waitForState<SaveToDeviceUiState.Success>(coord)
            assertEquals(listOf("notes.txt", "notes (1).txt"), success.savedFiles.map { it.savedFileName })
            assertEquals(1, success.failedFiles.size)
            assertEquals(360L, success.totalBytesCopied)
        } finally {
            coord.clear()
        }
    }

    private suspend inline fun <reified T : SaveToDeviceUiState> waitForState(
        coordinator: SaveToDeviceCoordinator,
        timeoutMs: Long = 5000L,
    ): T {
        val start = SystemClock.uptimeMillis()
        while (SystemClock.uptimeMillis() - start < timeoutMs) {
            val current = coordinator.uiState.value
            if (current is T) return current
            delay(25L)
        }
        throw AssertionError("Timed out waiting for ${T::class.java.simpleName}, got ${coordinator.uiState.value}")
    }

    private fun sha256(bytes: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(bytes)
}
