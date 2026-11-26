package org.intabtools.intabpdf.save

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

class UnsupportedTruncateModeException(cause: Throwable) :
    IOException("Storage provider does not support explicit truncating overwrite (\"wt\").", cause)

interface SafDestinationStorage {
    fun load(): PersistedSafDestination?
    fun save(destination: PersistedSafDestination)
    fun clear()
}

class SharedPrefsSafDestinationStorage(context: Context) : SafDestinationStorage {
    private val store = SafTreeStore(context)
    override fun load(): PersistedSafDestination? = store.load()
    override fun save(destination: PersistedSafDestination) = store.save(destination)
    override fun clear() = store.clear()
}

interface SafTreeGateway {
    fun hasPersistedReadWritePermission(treeUriString: String): Boolean
    fun releasePersistedPermissionBestEffort(treeUriString: String)
    fun getTreeRootDocumentId(treeUriString: String): String
    fun buildDocumentUriUsingTree(treeUriString: String, documentId: String): String
    fun queryDocumentMetadata(documentUriString: String): SafChildEntry?
    fun listChildren(treeUriString: String, folderDocumentId: String): List<SafChildEntry>
    fun createDirectory(folderUriString: String, name: String): SafChildEntry?
    fun createDocument(folderUriString: String, mimeType: String, displayName: String): SafChildEntry?
    fun renameDocument(treeUriString: String, folderDocumentId: String, documentUriString: String, newDisplayName: String): SafChildEntry?
    fun deleteDocument(documentUriString: String): Boolean
    fun copyLocalFileToDocument(localFile: File, destUriString: String, strictTruncate: Boolean): Long
    fun copyDocumentToLocalFile(sourceUriString: String, localFile: File): Long
}

class AndroidSafTreeGateway(context: Context) : SafTreeGateway {

    private val resolver: ContentResolver = context.applicationContext.contentResolver

    override fun hasPersistedReadWritePermission(treeUriString: String): Boolean {
        val target = Uri.parse(treeUriString)
        return try {
            resolver.persistedUriPermissions.any { perm ->
                perm.uri == target && perm.isReadPermission && perm.isWritePermission
            }
        } catch (_: Exception) {
            false
        }
    }

    override fun releasePersistedPermissionBestEffort(treeUriString: String) {
        try {
            resolver.releasePersistableUriPermission(
                Uri.parse(treeUriString),
                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        } catch (_: Exception) {
            // Best-effort cleanup
        }
    }

    override fun getTreeRootDocumentId(treeUriString: String): String {
        return DocumentsContract.getTreeDocumentId(Uri.parse(treeUriString))
    }

    override fun buildDocumentUriUsingTree(treeUriString: String, documentId: String): String {
        return DocumentsContract.buildDocumentUriUsingTree(
            Uri.parse(treeUriString),
            documentId,
        ).toString()
    }

    override fun queryDocumentMetadata(documentUriString: String): SafChildEntry? {
        val uri = Uri.parse(documentUriString)
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_FLAGS,
            DocumentsContract.Document.COLUMN_SIZE,
        )
        resolver.query(uri, projection, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                return readCursorEntry(cursor, documentUriString)
            }
        }
        return null
    }

    override fun listChildren(treeUriString: String, folderDocumentId: String): List<SafChildEntry> {
        val treeUri = Uri.parse(treeUriString)
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, folderDocumentId)
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_FLAGS,
            DocumentsContract.Document.COLUMN_SIZE,
        )
        val entries = ArrayList<SafChildEntry>()
        resolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) {
                val docIdIdx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                val docId = if (docIdIdx >= 0 && !cursor.isNull(docIdIdx)) cursor.getString(docIdIdx) else null
                if (docId.isNullOrBlank()) continue
                val childUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId).toString()
                entries.add(readCursorEntry(cursor, childUri))
            }
        }
        return entries
    }

    override fun createDirectory(folderUriString: String, name: String): SafChildEntry? {
        val created = DocumentsContract.createDocument(
            resolver,
            Uri.parse(folderUriString),
            DocumentsContract.Document.MIME_TYPE_DIR,
            name,
        ) ?: return null
        return queryDocumentMetadata(created.toString())
    }

    override fun createDocument(folderUriString: String, mimeType: String, displayName: String): SafChildEntry? {
        val created = DocumentsContract.createDocument(
            resolver,
            Uri.parse(folderUriString),
            mimeType,
            displayName,
        ) ?: return null
        return queryDocumentMetadata(created.toString())
    }

    override fun renameDocument(
        treeUriString: String,
        folderDocumentId: String,
        documentUriString: String,
        newDisplayName: String,
    ): SafChildEntry? {
        val renamedUri = DocumentsContract.renameDocument(
            resolver,
            Uri.parse(documentUriString),
            newDisplayName,
        ) ?: return null

        // Document IDs often change after renameDocument; query the returned URI and fall back to folder re-query.
        val directEntry = runCatching { queryDocumentMetadata(renamedUri.toString()) }.getOrNull()
        if (directEntry != null && directEntry.displayName.equals(newDisplayName, ignoreCase = true)) {
            return directEntry
        }
        val children = runCatching { listChildren(treeUriString, folderDocumentId) }.getOrDefault(emptyList())
        return SafDocumentRules.findEntryByNameCaseInsensitive(children, newDisplayName)
            ?: directEntry
    }

    override fun deleteDocument(documentUriString: String): Boolean {
        return try {
            DocumentsContract.deleteDocument(resolver, Uri.parse(documentUriString))
        } catch (_: Exception) {
            false
        }
    }

    override fun copyLocalFileToDocument(
        localFile: File,
        destUriString: String,
        strictTruncate: Boolean,
    ): Long {
        val destUri = Uri.parse(destUriString)
        val outStream: OutputStream = if (strictTruncate) {
            try {
                resolver.openOutputStream(destUri, "wt")
                    ?: throw IOException("Destination stream unavailable for truncating write.")
            } catch (ex: IllegalArgumentException) {
                throw UnsupportedTruncateModeException(ex)
            } catch (ex: UnsupportedOperationException) {
                throw UnsupportedTruncateModeException(ex)
            }
        } else {
            resolver.openOutputStream(destUri, "w")
                ?: throw IOException("Destination stream unavailable for writing.")
        }

        outStream.use { output ->
            FileInputStream(localFile).use { input ->
                return streamCopy(input, output)
            }
        }
    }

    override fun copyDocumentToLocalFile(sourceUriString: String, localFile: File): Long {
        val srcUri = Uri.parse(sourceUriString)
        val input: InputStream = resolver.openInputStream(srcUri)
            ?: throw IOException("Source document stream could not be opened for backup.")
        input.use { inStream ->
            FileOutputStream(localFile, false).use { outStream ->
                return streamCopy(inStream, outStream)
            }
        }
    }

    private fun readCursorEntry(cursor: android.database.Cursor, uriString: String): SafChildEntry {
        val idCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
        val nameCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        val mimeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
        val flagsCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_FLAGS)
        val sizeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)

        val docId = if (idCol >= 0 && !cursor.isNull(idCol)) cursor.getString(idCol) else ""
        val displayName = if (nameCol >= 0 && !cursor.isNull(nameCol)) cursor.getString(nameCol) else ""
        val mimeType = if (mimeCol >= 0 && !cursor.isNull(mimeCol)) cursor.getString(mimeCol) else ""
        val flags = if (flagsCol >= 0 && !cursor.isNull(flagsCol)) cursor.getInt(flagsCol) else 0
        val size = if (sizeCol >= 0 && !cursor.isNull(sizeCol)) cursor.getLong(sizeCol).takeIf { it >= 0L } else null

        return SafChildEntry(
            documentId = docId,
            displayName = displayName,
            mimeType = mimeType,
            flags = flags,
            sizeBytes = size,
            uriString = uriString,
        )
    }

    private fun streamCopy(input: InputStream, output: OutputStream): Long {
        val buffer = ByteArray(32 * 1024)
        var total = 0L
        while (true) {
            val read = input.read(buffer)
            if (read == -1) break
            if (read > 0) {
                output.write(buffer, 0, read)
                total += read
            }
        }
        output.flush()
        return total
    }
}
