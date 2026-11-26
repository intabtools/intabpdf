package org.intabtools.intabpdf.save

import android.database.Cursor
import android.database.MatrixCursor
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract.Document
import android.provider.DocumentsContract.Root
import android.provider.DocumentsProvider
import java.io.File
import java.io.FileNotFoundException

/**
 * Instrumentation-only DocumentsProvider backed by real local files & ParcelFileDescriptor,
 * allowing AndroidSafTreeGateway and SafSaveRepository to execute real ContentResolver /
 * DocumentsContract / enforceTree / "wt" truncation semantics via ContentResolver.wrap(provider).
 */
class TestDocumentsProvider : DocumentsProvider() {

    private val rootDir: File by lazy {
        File(context!!.cacheDir, "test_saf_provider_root").apply { mkdirs() }
    }

    override fun onCreate(): Boolean = true

    override fun isChildDocument(parentDocumentId: String, documentId: String): Boolean {
        if (resolveDocFile(parentDocumentId) == null || resolveDocFile(documentId) == null) {
            return false
        }
        return documentId == parentDocumentId || documentId.startsWith("$parentDocumentId/")
    }

    override fun queryRoots(projection: Array<out String>?): Cursor {
        val cols = projection ?: DEFAULT_ROOT_PROJECTION
        val cursor = MatrixCursor(cols)
        val row = cursor.newRow()
        row.add(Root.COLUMN_ROOT_ID, ROOT_ID)
        row.add(Root.COLUMN_DOCUMENT_ID, ROOT_DOC_ID)
        row.add(Root.COLUMN_TITLE, "Documents")
        row.add(Root.COLUMN_FLAGS, Root.FLAG_SUPPORTS_CREATE or Root.FLAG_LOCAL_ONLY)
        row.add(Root.COLUMN_MIME_TYPES, "*/*")
        return cursor
    }

    override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor {
        val cols = projection ?: DEFAULT_DOC_PROJECTION
        val cursor = MatrixCursor(cols)
        val file = resolveDocFile(documentId) ?: throw FileNotFoundException("Missing $documentId")
        includeFileRow(cursor, documentId, file)
        return cursor
    }

    override fun queryChildDocuments(
        parentDocumentId: String,
        projection: Array<out String>?,
        sortOrder: String?,
    ): Cursor {
        val cols = projection ?: DEFAULT_DOC_PROJECTION
        val cursor = MatrixCursor(cols)
        val parent = resolveDocFile(parentDocumentId) ?: throw FileNotFoundException("Missing parent $parentDocumentId")
        parent.listFiles()?.forEach { child ->
            val childId = if (parentDocumentId == ROOT_DOC_ID) {
                "$ROOT_DOC_ID/${child.name}"
            } else {
                "$parentDocumentId/${child.name}"
            }
            includeFileRow(cursor, childId, child)
        }
        return cursor
    }

    override fun createDocument(parentDocumentId: String, mimeType: String, displayName: String): String {
        val parent = resolveDocFile(parentDocumentId) ?: throw FileNotFoundException("Missing parent $parentDocumentId")
        val target = File(parent, displayName)
        if (mimeType == Document.MIME_TYPE_DIR) {
            target.mkdirs()
        } else {
            target.parentFile?.mkdirs()
            target.createNewFile()
        }
        return "$parentDocumentId/${target.name}"
    }

    override fun renameDocument(documentId: String, displayName: String): String {
        val src = resolveDocFile(documentId) ?: throw FileNotFoundException("Missing $documentId")
        val failRenameTo = failRenameTargetName
        val failRenameFrom = failRenameSourcePrefix
        val matchesTo = failRenameTo == null || displayName == failRenameTo
        val matchesFrom = failRenameFrom == null || src.name.startsWith(failRenameFrom)
        if ((failRenameTo != null || failRenameFrom != null) && matchesTo && matchesFrom) {
            throw FileNotFoundException("Simulated provider rename failure for $documentId -> $displayName")
        }
        val dst = File(src.parentFile, displayName)
        if (dst.exists() || !src.renameTo(dst)) {
            throw FileNotFoundException("Rename failed for $documentId -> $displayName")
        }
        val parentId = documentId.substringBeforeLast('/', ROOT_DOC_ID)
        return "$parentId/$displayName"
    }

    override fun deleteDocument(documentId: String) {
        val target = resolveDocFile(documentId) ?: throw FileNotFoundException("Missing $documentId")
        val failDel = failDeletePrefix
        if (failDel != null && target.name.startsWith(failDel)) {
            throw FileNotFoundException("Simulated provider delete refusal for ${target.name}")
        }
        if (!target.deleteRecursively()) {
            throw FileNotFoundException("Delete failed for $documentId")
        }
    }

    override fun openDocument(documentId: String, mode: String, signal: CancellationSignal?): ParcelFileDescriptor {
        val file = resolveDocFile(documentId) ?: throw FileNotFoundException("Missing $documentId")
        if (mode.contains("t") && simulateWtUnsupported) {
            throw UnsupportedOperationException("Simulated provider does not support truncating wt mode")
        }
        if (mode.contains("w")) {
            val writePrefix = failWritePrefix
            if (file.name.startsWith("fail_write_") || (writePrefix != null && file.name.startsWith(writePrefix))) {
                throw FileNotFoundException("Simulated provider write refusal for ${file.name}")
            }
            if (failNextWtWrite && mode.contains("t")) {
                failNextWtWrite = false
                // Truncate via "wt" first, then simulate mid-stream failure!
                ParcelFileDescriptor.open(file, ParcelFileDescriptor.parseMode("wt")).close()
                throw FileNotFoundException("Simulated mid-stream failure after wt truncate for ${file.name}")
            }
        } else {
            val readPrefix = failReadPrefix
            if (readPrefix != null && file.name.startsWith(readPrefix)) {
                throw FileNotFoundException("Simulated provider read refusal for ${file.name}")
            }
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.parseMode(mode))
    }

    private fun resolveDocFile(documentId: String): File? {
        if (documentId == ROOT_DOC_ID) return rootDir
        if (!documentId.startsWith("$ROOT_DOC_ID/")) return null
        val rel = documentId.removePrefix("$ROOT_DOC_ID/")
        if (rel.contains("..")) return null
        val candidate = File(rootDir, rel)
        return if (candidate.canonicalPath.startsWith(rootDir.canonicalPath)) candidate else null
    }

    private fun includeFileRow(cursor: MatrixCursor, docId: String, file: File) {
        val isDir = file.isDirectory
        val mime = if (isDir) Document.MIME_TYPE_DIR else "application/pdf"
        val flags = if (isDir) {
            Document.FLAG_DIR_SUPPORTS_CREATE
        } else {
            overrideFileFlags ?: (
                Document.FLAG_SUPPORTS_WRITE or
                    Document.FLAG_SUPPORTS_RENAME or
                    Document.FLAG_SUPPORTS_DELETE
                )
        }
        cursor.newRow().apply {
            add(Document.COLUMN_DOCUMENT_ID, docId)
            add(Document.COLUMN_DISPLAY_NAME, if (docId == ROOT_DOC_ID) "Documents" else file.name)
            add(Document.COLUMN_MIME_TYPE, mime)
            add(Document.COLUMN_FLAGS, flags)
            add(Document.COLUMN_SIZE, if (isDir) null else file.length())
        }
    }

    companion object {
        const val AUTHORITY = "org.intabtools.intabpdf.test.documents"
        const val ROOT_ID = "test_root"
        const val ROOT_DOC_ID = "root:Documents"

        @Volatile var simulateWtUnsupported: Boolean = false
        @Volatile var failWtWritePrefix: String? = null
        @Volatile var failWritePrefix: String? = null
        @Volatile var failNextWtWrite: Boolean = false
        @Volatile var failReadPrefix: String? = null
        @Volatile var failRenameTargetName: String? = null
        @Volatile var failRenameSourcePrefix: String? = null
        @Volatile var failDeletePrefix: String? = null
        @Volatile var overrideFileFlags: Int? = null

        fun resetFaults() {
            simulateWtUnsupported = false
            failWtWritePrefix = null
            failWritePrefix = null
            failNextWtWrite = false
            failReadPrefix = null
            failRenameTargetName = null
            failRenameSourcePrefix = null
            failDeletePrefix = null
            overrideFileFlags = null
        }

        private val DEFAULT_ROOT_PROJECTION = arrayOf(
            Root.COLUMN_ROOT_ID,
            Root.COLUMN_DOCUMENT_ID,
            Root.COLUMN_TITLE,
            Root.COLUMN_FLAGS,
            Root.COLUMN_MIME_TYPES,
        )

        private val DEFAULT_DOC_PROJECTION = arrayOf(
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_MIME_TYPE,
            Document.COLUMN_FLAGS,
            Document.COLUMN_SIZE,
        )
    }
}
