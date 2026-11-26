package org.intabtools.intabpdf.savetodevice

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.IntentCompat
import java.io.IOException
import java.io.OutputStream
import java.util.Locale
import java.util.concurrent.CancellationException

data class SavedFileResult(
    val sourceUriString: String,
    val savedFileName: String,
    val bytesCopied: Long,
)

data class FailedFileResult(
    val sourceUriString: String,
    val displayName: String,
    val reason: String,
)

data class BatchCopyOutcome(
    val savedFiles: List<SavedFileResult>,
    val failedFiles: List<FailedFileResult>,
    val cancelledFiles: List<String> = emptyList(),
    val cleanupFailedCount: Int = 0,
)

class IncompleteCleanupIOException(
    val cleanupSucceeded: Boolean,
    cause: Throwable,
) : IOException(cause.message ?: "File write failed", cause)

interface ShareSaveGateway {
    fun resolveDescriptors(
        input: ResolvedShareInput,
        intentMimeType: String?,
    ): List<SharedFileDescriptor>

    fun copySingleToDocumentUri(
        source: SharedFileDescriptor,
        destUri: Uri,
        isCancelled: () -> Boolean,
        onProgress: (bytesCopied: Long) -> Unit,
    ): Long

    fun copyMultipleToTreeUri(
        sources: List<SharedFileDescriptor>,
        treeUri: Uri,
        isCancelled: () -> Boolean,
        onProgress: (index: Int, totalCount: Int, fileName: String, bytesCopied: Long, totalBytes: Long?) -> Unit,
    ): BatchCopyOutcome
}

class AndroidShareSaveGateway(context: Context) : ShareSaveGateway {

    private val resolver: ContentResolver = context.applicationContext.contentResolver
    private val mimeTypeMap: MimeTypeMap by lazy { MimeTypeMap.getSingleton() }

    override fun resolveDescriptors(
        input: ResolvedShareInput,
        intentMimeType: String?,
    ): List<SharedFileDescriptor> {
        val result = ArrayList<SharedFileDescriptor>(input.uriStrings.size)
        for ((index, uriStr) in input.uriStrings.withIndex()) {
            val uri = Uri.parse(uriStr)
            var rawName: String? = null
            var sizeBytes: Long? = null

            try {
                resolver.query(
                    uri,
                    arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                    null,
                    null,
                    null,
                )?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                            rawName = cursor.getString(nameIdx)
                        }
                        val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                        if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                            val queriedSize = cursor.getLong(sizeIdx)
                            if (queriedSize > 0L) {
                                sizeBytes = queriedSize
                            }
                        }
                    }
                }
            } catch (_: SecurityException) {
                // Provider denied metadata query; surface read failure cleanly during copy or handle fallback name
            } catch (_: Exception) {
                // Fallback to URI path segment / default naming cleanly
            }

            if (rawName.isNullOrBlank()) {
                val segment = uri.lastPathSegment?.substringAfterLast(':')
                if (!segment.isNullOrBlank()) {
                    rawName = segment
                }
            }

            val providerMime = try {
                resolver.getType(uri)
            } catch (_: Exception) {
                null
            }

            val fallbackBase = if (input.uriStrings.size > 1) {
                "${SharedFileMetadata.DEFAULT_BASE_NAME}_${index + 1}"
            } else {
                SharedFileMetadata.DEFAULT_BASE_NAME
            }

            // Preserve any existing extension on rawName; only derive an extension hint when rawName has none.
            val sanitizedWithoutHint = if (rawName.isNullOrBlank()) {
                null
            } else {
                SharedFileMetadata.sanitizeFileName(rawName = rawName, fallbackBaseName = fallbackBase)
            }
            val preliminaryMime = SharedFileMetadata.resolveMimeType(
                providerMime = providerMime,
                intentMime = intentMimeType,
                sanitizedFileName = sanitizedWithoutHint,
                platformMimeLookup = { ext -> mimeTypeMap.getMimeTypeFromExtension(ext) },
            )
            val extHint = SharedFileMetadata.resolveExtensionForMimeType(
                mimeType = preliminaryMime,
                platformExtensionLookup = { mime -> mimeTypeMap.getExtensionFromMimeType(mime) },
            )
            val sanitizedName = SharedFileMetadata.sanitizeFileName(
                rawName = rawName,
                extensionHint = extHint,
                fallbackBaseName = fallbackBase,
            )
            val resolvedMime = SharedFileMetadata.resolveMimeType(
                providerMime = providerMime,
                intentMime = intentMimeType,
                sanitizedFileName = sanitizedName,
                platformMimeLookup = { ext -> mimeTypeMap.getMimeTypeFromExtension(ext) },
            )

            result.add(
                SharedFileDescriptor(
                    uriString = uriStr,
                    displayName = sanitizedName,
                    mimeType = resolvedMime,
                    sizeBytes = sizeBytes,
                ),
            )
        }
        return result
    }

    override fun copySingleToDocumentUri(
        source: SharedFileDescriptor,
        destUri: Uri,
        isCancelled: () -> Boolean,
        onProgress: (bytesCopied: Long) -> Unit,
    ): Long {
        val srcUri = Uri.parse(source.uriString)
        return try {
            val input = resolver.openInputStream(srcUri)
                ?: throw IOException("Source file is unavailable or empty.")
            input.use { inStream ->
                val output = openDestinationOutputStream(destUri)
                output.use { outStream ->
                    StreamFileCopier.copyStream(
                        input = inStream,
                        output = outStream,
                        isCancelled = isCancelled,
                        onProgress = onProgress,
                    )
                }
            }
        } catch (cancelled: CancellationException) {
            deleteDestinationBestEffort(destUri)
            throw cancelled
        } catch (t: Throwable) {
            val deleted = deleteDestinationBestEffort(destUri)
            if (t is SecurityException) {
                throw t
            }
            throw IncompleteCleanupIOException(cleanupSucceeded = deleted, cause = t)
        }
    }

    override fun copyMultipleToTreeUri(
        sources: List<SharedFileDescriptor>,
        treeUri: Uri,
        isCancelled: () -> Boolean,
        onProgress: (index: Int, totalCount: Int, fileName: String, bytesCopied: Long, totalBytes: Long?) -> Unit,
    ): BatchCopyOutcome {
        val treeDocId = DocumentsContract.getTreeDocumentId(treeUri)
        val parentDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId)
        val existingNames = queryExistingChildNamesLowercase(treeUri, treeDocId)

        val saved = mutableListOf<SavedFileResult>()
        val failed = mutableListOf<FailedFileResult>()
        val cancelledNames = mutableListOf<String>()
        var cleanupFailedCount = 0

        for ((index, item) in sources.withIndex()) {
            val uniqueName = SharedFileMetadata.deduplicateFileName(item.displayName, existingNames)
            if (isCancelled()) {
                for (remIdx in index until sources.size) {
                    cancelledNames.add(if (remIdx == index) uniqueName else sources[remIdx].displayName)
                }
                break
            }

            onProgress(index + 1, sources.size, uniqueName, 0L, item.sizeBytes)

            var createdDocUri: Uri? = null
            try {
                createdDocUri = DocumentsContract.createDocument(
                    resolver,
                    parentDocUri,
                    item.mimeType,
                    uniqueName,
                ) ?: throw IOException("Could not create destination file \"$uniqueName\".")

                val bytes = copySingleToDocumentUri(
                    source = item,
                    destUri = createdDocUri,
                    isCancelled = isCancelled,
                    onProgress = { copied ->
                        onProgress(index + 1, sources.size, uniqueName, copied, item.sizeBytes)
                    },
                )
                saved.add(
                    SavedFileResult(
                        sourceUriString = item.uriString,
                        savedFileName = uniqueName,
                        bytesCopied = bytes,
                    ),
                )
            } catch (_: CancellationException) {
                cancelledNames.add(uniqueName)
                for (remIdx in (index + 1) until sources.size) {
                    cancelledNames.add(sources[remIdx].displayName)
                }
                break
            } catch (err: Throwable) {
                if (createdDocUri == null) {
                    // createDocument failed before copySingleToDocumentUri ran; nothing partial created.
                } else if (err is IncompleteCleanupIOException) {
                    if (!err.cleanupSucceeded) {
                        cleanupFailedCount++
                    }
                } else if (!deleteDestinationBestEffort(createdDocUri)) {
                    cleanupFailedCount++
                }
                failed.add(
                    FailedFileResult(
                        sourceUriString = item.uriString,
                        displayName = uniqueName,
                        reason = mapThrowableMessage(err),
                    ),
                )
            }
        }

        return BatchCopyOutcome(
            savedFiles = saved,
            failedFiles = failed,
            cancelledFiles = cancelledNames,
            cleanupFailedCount = cleanupFailedCount,
        )
    }

    private fun openDestinationOutputStream(destUri: Uri): OutputStream {
        return try {
            resolver.openOutputStream(destUri, "w")
        } catch (_: IllegalArgumentException) {
            resolver.openOutputStream(destUri)
        } catch (_: UnsupportedOperationException) {
            resolver.openOutputStream(destUri)
        } ?: throw IOException("Destination location could not be opened for writing.")
    }

    private fun queryExistingChildNamesLowercase(treeUri: Uri, treeDocId: String): MutableSet<String> {
        val names = HashSet<String>()
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, treeDocId)
        try {
            resolver.query(
                childrenUri,
                arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                null,
                null,
                null,
            )?.use { cursor ->
                val nameCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                while (nameCol >= 0 && cursor.moveToNext()) {
                    if (!cursor.isNull(nameCol)) {
                        val name = cursor.getString(nameCol)
                        if (!name.isNullOrBlank()) {
                            names.add(name.lowercase(Locale.ROOT))
                        }
                    }
                }
            }
        } catch (_: Exception) {
            // Some custom document providers disallow listing children; deduplicate within current batch at minimum.
        }
        return names
    }

    private fun deleteDestinationBestEffort(destUri: Uri): Boolean {
        return try {
            DocumentsContract.deleteDocument(resolver, destUri)
        } catch (_: Exception) {
            false
        }
    }

    companion object {
        fun parseIncomingIntent(intent: Intent?): ResolvedShareInput {
            if (intent == null) {
                return ResolvedShareInput(emptyList(), isMultiple = false)
            }
            val action = intent.action
            val candidates = ArrayList<Pair<String?, String?>>()

            when (action) {
                Intent.ACTION_SEND -> {
                    val streamUri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
                    if (streamUri != null) {
                        candidates.add(streamUri.toString() to streamUri.scheme)
                    } else {
                        val clip = intent.clipData
                        if (clip != null && clip.itemCount > 0) {
                            clip.getItemAt(0).uri?.let { u ->
                                candidates.add(u.toString() to u.scheme)
                            }
                        }
                    }
                    return SharedFileMetadata.filterIncomingUriStrings(
                        candidates = candidates,
                        isMultiple = false,
                    )
                }

                Intent.ACTION_SEND_MULTIPLE -> {
                    val streamList = IntentCompat.getParcelableArrayListExtra(
                        intent,
                        Intent.EXTRA_STREAM,
                        Uri::class.java,
                    )
                    if (!streamList.isNullOrEmpty()) {
                        for (u in streamList) {
                            candidates.add(u.toString() to u.scheme)
                        }
                    } else {
                        val clip = intent.clipData
                        if (clip != null) {
                            for (i in 0 until clip.itemCount) {
                                clip.getItemAt(i).uri?.let { u ->
                                    candidates.add(u.toString() to u.scheme)
                                }
                            }
                        }
                    }
                    return SharedFileMetadata.filterIncomingUriStrings(
                        candidates = candidates,
                        isMultiple = true,
                    )
                }

                else -> return ResolvedShareInput(emptyList(), isMultiple = false)
            }
        }

        fun mapThrowableMessage(t: Throwable): String {
            val unwrapped = (t as? IncompleteCleanupIOException)?.cause ?: t
            return when (unwrapped) {
                is SecurityException -> "Permission to read the shared file expired or was denied."
                is IOException -> unwrapped.message?.takeIf { it.isNotBlank() }
                    ?: "Could not read or write the file (check available storage space)."
                else -> unwrapped.message?.takeIf { it.isNotBlank() }
                    ?: "An unexpected error occurred while saving the file."
            }
        }
    }
}
