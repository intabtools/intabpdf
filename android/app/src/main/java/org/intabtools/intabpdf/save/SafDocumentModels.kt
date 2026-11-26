package org.intabtools.intabpdf.save

import android.provider.DocumentsContract
import java.nio.charset.StandardCharsets
import java.util.Locale

data class SafChildEntry(
    val documentId: String,
    val displayName: String,
    val mimeType: String,
    val flags: Int,
    val sizeBytes: Long?,
    val uriString: String,
) {
    val isDirectory: Boolean
        get() = mimeType == DocumentsContract.Document.MIME_TYPE_DIR
}

data class PersistedSafDestination(
    val treeUriString: String,
    val folderUriString: String,
    val folderDocumentId: String,
    val folderDisplayName: String,
    val displayPath: String,
)

enum class SafReplaceStrategy {
    STAGED_SWAP,
    CACHE_BACKUP_WT,
    UNSUPPORTED_PRESERVE_ORIGINAL,
}

enum class RecoveryFailureKind(val wireValue: String) {
    REPLACE_WRITE_AND_RESTORE_FAILED("replace_write_and_restore_failed"),
    SWAP_AND_ROLLBACK_FAILED("swap_and_rollback_failed"),
    INTERRUPTED_REPLACEMENT("interrupted_replacement"),
    ORPHANED_BACKUP("orphaned_backup");

    companion object {
        fun fromWire(value: String?): RecoveryFailureKind =
            entries.firstOrNull { it.wireValue == value } ?: REPLACE_WRITE_AND_RESTORE_FAILED
    }
}

enum class RecoveryBackupStatus(val wireValue: String) {
    PENDING_ACTION("pending_action"),
    EXPORTED_AWAITING_CONFIRMATION("exported_awaiting_delete_confirmation"),
    DELETE_FAILED("delete_failed");

    companion object {
        fun fromWire(value: String?): RecoveryBackupStatus =
            entries.firstOrNull { it.wireValue == value } ?: PENDING_ACTION
    }
}

data class RecoveryBackupRecord(
    val recoveryId: String,
    val backupFileName: String,
    val originalFileName: String,
    val mimeType: String,
    val attemptedDestination: String,
    val explanation: String,
    val failureKind: RecoveryFailureKind,
    val createdAtMillis: Long,
    val sizeBytes: Long,
    val status: RecoveryBackupStatus,
    val safBackupDocumentName: String? = null,
    val safBackupUriString: String? = null,
    val safTreeUriString: String? = null,
    val exportedFileName: String? = null,
    val backupAvailable: Boolean = true,
    val safBackupAvailable: Boolean = false,
    val recoverySource: String = if (backupAvailable) "local" else "unavailable",
)

data class SafCleanupWarning(
    val code: String,
    val message: String,
    val leftoverFileName: String? = null,
    val leftoverDocumentUriString: String? = null,
    val verifiedTargetUriString: String? = null,
    val verifiedTargetSizeBytes: Long? = null,
)

data class StagingCleanupReport(
    val removedCount: Int,
    val preservedRecentCount: Int,
    val skippedActiveCount: Int,
    val diagnosticErrors: List<String> = emptyList(),
)

sealed class SafSaveOutcome {
    data class Success(
        val savedFileName: String,
        val displayPath: String,
        val documentUriString: String,
        val bytesWritten: Long,
        val replaced: Boolean,
        val warningMessage: String? = null,
        val cleanupWarning: SafCleanupWarning? = null,
    ) : SafSaveOutcome()

    data class ConflictDetected(
        val existingFileName: String,
        val suggestedFileName: String,
    ) : SafSaveOutcome()

    data class ReplaceUnsupported(
        val existingFileName: String,
        val suggestedFileName: String,
        val reason: String,
    ) : SafSaveOutcome()

    data class RecoveryFailed(
        val recoveryId: String,
        val originalFileName: String,
        val attemptedDestination: String,
        val errorMessage: String,
        val failureKind: RecoveryFailureKind,
        val backupAvailable: Boolean,
        val createdAtMillis: Long,
        val sizeBytes: Long,
        val safBackupDocumentName: String? = null,
        val safBackupAvailable: Boolean = false,
        val recoverySource: String = if (backupAvailable) "local" else "unavailable",
    ) : SafSaveOutcome()

    data class Failed(
        val code: String,
        val errorMessage: String,
        val originalIntact: Boolean = true,
        val cleanupWarning: SafCleanupWarning? = null,
    ) : SafSaveOutcome()

    data class NeedsFolderSelection(
        val repromptMessage: String? = null,
    ) : SafSaveOutcome()
}

sealed class SafExportOutcome {
    data class Exported(
        val recoveryId: String,
        val exportedFileName: String,
        val exportedUriString: String,
        val bytesWritten: Long,
        val backupPreserved: Boolean = true,
        val awaitingDeleteConfirmation: Boolean = true,
    ) : SafExportOutcome()

    data class Cancelled(
        val recoveryId: String,
        val backupPreserved: Boolean = true,
    ) : SafExportOutcome()

    data class Failed(
        val recoveryId: String,
        val code: String,
        val errorMessage: String,
        val backupPreserved: Boolean,
    ) : SafExportOutcome()
}

sealed class SafDeleteBackupOutcome {
    data class Deleted(val recoveryId: String) : SafDeleteBackupOutcome()
    data class Failed(
        val recoveryId: String,
        val code: String,
        val errorMessage: String,
        val backupPreserved: Boolean,
    ) : SafDeleteBackupOutcome()
}

sealed class SafLeftoverCleanupOutcome {
    data class Removed(val leftoverFileName: String) : SafLeftoverCleanupOutcome()
    data class Failed(val code: String, val errorMessage: String) : SafLeftoverCleanupOutcome()
}

object SafDocumentRules {

    const val TARGET_SUBFOLDER_NAME = "InTabPDF"
    const val BASE_DOCUMENTS_DISPLAY_PATH = "Documents/InTabPDF"
    const val MAX_FILE_NAME_UTF8_BYTES = 180
    const val MAX_PREFIXED_NAME_UTF8_BYTES = 220

    private val RESERVED_DOS_NAMES = setOf(
        "con", "prn", "aux", "nul",
        "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
        "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    )

    /**
     * Selects the safest replacement strategy supported by the provider flags.
     * Prefers staged temp creation + rename swap when supported; falls back to a cache backup
     * paired with explicit truncating "wt" only when the target declares write support.
     */
    fun chooseReplaceStrategy(existingFlags: Int, parentFlags: Int): SafReplaceStrategy {
        val canCreateInParent = (parentFlags and DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE) != 0
        val canRenameExisting = (existingFlags and DocumentsContract.Document.FLAG_SUPPORTS_RENAME) != 0
        val canDeleteExisting = (existingFlags and DocumentsContract.Document.FLAG_SUPPORTS_DELETE) != 0
        val canWriteExisting = (existingFlags and DocumentsContract.Document.FLAG_SUPPORTS_WRITE) != 0

        if (canCreateInParent && canRenameExisting && canDeleteExisting) {
            return SafReplaceStrategy.STAGED_SWAP
        }
        if (canWriteExisting) {
            return SafReplaceStrategy.CACHE_BACKUP_WT
        }
        return SafReplaceStrategy.UNSUPPORTED_PRESERVE_ORIGINAL
    }

    fun sanitizeTargetFileName(
        rawName: String?,
        defaultName: String = "document.pdf",
        maxUtf8Bytes: Int = MAX_FILE_NAME_UTF8_BYTES,
    ): String {
        val cleaned = buildString {
            for (ch in rawName.orEmpty()) {
                val code = ch.code
                val isControl = code < 0x20 || code == 0x7F
                val isBidi = code in 0x202A..0x202E || code in 0x2066..0x2069 || code == 0x200E || code == 0x200F
                if (!isControl && !isBidi) {
                    append(ch)
                }
            }
        }
            .replace('\\', '/')
            .substringAfterLast('/')
            .trim()
            .let { segment ->
                buildString(segment.length) {
                    for (ch in segment) {
                        append(
                            when (ch) {
                                ':', '*', '?', '"', '<', '>', '|' -> '-'
                                else -> ch
                            },
                        )
                    }
                }
            }
            .trim()
            .trim('.')

        var candidate = if (cleaned.isEmpty() || cleaned == "." || cleaned == "..") {
            defaultName
        } else {
            cleaned
        }

        val (base, ext) = splitBaseAndExtension(candidate)
        if (base.lowercase(Locale.ROOT) in RESERVED_DOS_NAMES) {
            candidate = "${base}_$ext"
        }

        return clampFileNameToUtf8Bytes(candidate, maxUtf8Bytes)
    }

    fun clampFileNameToUtf8Bytes(fileName: String, maxUtf8Bytes: Int): String {
        if (utf8ByteLength(fileName) <= maxUtf8Bytes) {
            return fileName
        }
        val (base, ext) = splitBaseAndExtension(fileName)
        val extBytes = utf8ByteLength(ext)
        if (ext.isNotEmpty() && extBytes + 4 < maxUtf8Bytes) {
            val trimmedBase = truncateUtf8ToByteLimit(base, maxUtf8Bytes - extBytes)
                .trimEnd('.', ' ')
                .ifEmpty { "doc" }
            val result = "$trimmedBase$ext"
            if (utf8ByteLength(result) <= maxUtf8Bytes) {
                return result
            }
        }
        return truncateUtf8ToByteLimit(fileName, maxUtf8Bytes)
            .trimEnd('.', ' ')
            .ifEmpty { "doc" }
    }

    fun utf8ByteLength(text: String): Int =
        text.toByteArray(StandardCharsets.UTF_8).size

    /**
     * Truncates text cleanly on Unicode code-point boundaries so total UTF-8 length never exceeds [maxBytes].
     */
    fun truncateUtf8ToByteLimit(text: String, maxBytes: Int): String {
        if (maxBytes <= 0 || text.isEmpty()) return ""
        val sb = StringBuilder()
        var usedBytes = 0
        var i = 0
        while (i < text.length) {
            val cp = Character.codePointAt(text, i)
            val charCount = Character.charCount(cp)
            val cpUtf8Bytes = when {
                cp <= 0x7F -> 1
                cp <= 0x7FF -> 2
                cp <= 0xFFFF -> 3
                else -> 4
            }
            if (usedBytes + cpUtf8Bytes > maxBytes) {
                break
            }
            sb.appendCodePoint(cp)
            usedBytes += cpUtf8Bytes
            i += charCount
        }
        return sb.toString()
    }

    fun splitBaseAndExtension(fileName: String): Pair<String, String> {
        val lastDot = fileName.lastIndexOf('.')
        if (lastDot <= 0 || lastDot >= fileName.length - 1) {
            return fileName to ""
        }
        return fileName.substring(0, lastDot) to fileName.substring(lastDot)
    }

    fun findEntryByNameCaseInsensitive(
        entries: List<SafChildEntry>,
        displayName: String,
    ): SafChildEntry? {
        val targetLower = displayName.lowercase(Locale.ROOT)
        // Prefer exact case match when multiple entries somehow exist
        return entries.firstOrNull { it.displayName == displayName }
            ?: entries.firstOrNull { it.displayName.lowercase(Locale.ROOT) == targetLower }
    }

    fun suggestUniqueName(
        desiredName: String,
        existingNames: Collection<String>,
        maxUtf8Bytes: Int = MAX_FILE_NAME_UTF8_BYTES,
    ): String {
        val existingLower = existingNames.mapTo(HashSet()) { it.lowercase(Locale.ROOT) }
        val (rawBase, ext) = splitBaseAndExtension(desiredName)
        val suffixMatch = Regex("^(.*?)\\s*\\((\\d+)\\)$").find(rawBase)
        val cleanBase = suffixMatch?.groupValues?.get(1)?.trim()?.ifEmpty { rawBase } ?: rawBase
        val startCounter = suffixMatch?.groupValues?.get(2)?.toIntOrNull()?.plus(1) ?: 1

        for (counter in startCounter until startCounter + 1000) {
            val suffix = " ($counter)$ext"
            val suffixBytes = utf8ByteLength(suffix)
            val baseBudget = (maxUtf8Bytes - suffixBytes).coerceAtLeast(1)
            val boundedBase = truncateUtf8ToByteLimit(cleanBase, baseBudget).trimEnd('.', ' ').ifEmpty { "doc" }
            val candidate = "$boundedBase$suffix"
            if (!existingLower.contains(candidate.lowercase(Locale.ROOT))) {
                return candidate
            }
        }
        val fallbackSuffix = " (${System.currentTimeMillis()})$ext"
        val baseBudget = (maxUtf8Bytes - utf8ByteLength(fallbackSuffix)).coerceAtLeast(1)
        val boundedBase = truncateUtf8ToByteLimit(cleanBase, baseBudget).trimEnd('.', ' ').ifEmpty { "doc" }
        return "$boundedBase$fallbackSuffix"
    }

    /**
     * Generates a temp or backup document filename with [prefix] cleanly bounded within [maxUtf8Bytes]
     * while preserving extension and avoiding collisions with [existingNames].
     */
    fun buildBoundedPrefixedName(
        prefix: String,
        targetName: String,
        existingNames: Collection<String>,
        maxUtf8Bytes: Int = MAX_PREFIXED_NAME_UTF8_BYTES,
    ): String {
        val existingLower = existingNames.mapTo(HashSet()) { it.lowercase(Locale.ROOT) }
        val (rawBase, ext) = splitBaseAndExtension(targetName)
        val directBudget = (maxUtf8Bytes - utf8ByteLength(prefix) - utf8ByteLength(ext)).coerceAtLeast(0)
        val trimmedBase = if (directBudget > 0) truncateUtf8ToByteLimit(rawBase, directBudget) else ""
        val firstCandidate = clampFileNameToUtf8Bytes("$prefix$trimmedBase$ext", maxUtf8Bytes)
        if (!existingLower.contains(firstCandidate.lowercase(Locale.ROOT))) {
            return firstCandidate
        }
        return suggestUniqueName(firstCandidate, existingNames, maxUtf8Bytes)
    }

    fun resolveDisplayPathForTree(
        rootDisplayName: String,
        treeDocumentId: String,
        childCreatedOrFound: Boolean,
    ): String {
        if (rootDisplayName.equals(TARGET_SUBFOLDER_NAME, ignoreCase = true)) {
            if (treeDocumentId.contains("Documents/", ignoreCase = true)) {
                return BASE_DOCUMENTS_DISPLAY_PATH
            }
            return TARGET_SUBFOLDER_NAME
        }
        if (childCreatedOrFound) {
            if (rootDisplayName.equals("Documents", ignoreCase = true) ||
                treeDocumentId.endsWith(":Documents", ignoreCase = true) ||
                treeDocumentId.endsWith("/Documents", ignoreCase = true)
            ) {
                return BASE_DOCUMENTS_DISPLAY_PATH
            }
            return "$rootDisplayName/$TARGET_SUBFOLDER_NAME"
        }
        return rootDisplayName.ifBlank { BASE_DOCUMENTS_DISPLAY_PATH }
    }
}
