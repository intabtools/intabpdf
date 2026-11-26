package org.intabtools.intabpdf.save

import android.provider.DocumentsContract
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

sealed class SafSaveOutcome {
    data class Success(
        val savedFileName: String,
        val displayPath: String,
        val documentUriString: String,
        val bytesWritten: Long,
        val replaced: Boolean,
        val warningMessage: String? = null,
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
        val errorMessage: String,
        val recoveryLocation: String,
    ) : SafSaveOutcome()

    data class Failed(
        val code: String,
        val errorMessage: String,
    ) : SafSaveOutcome()

    data object NeedsFolderSelection : SafSaveOutcome()
}

object SafDocumentRules {

    const val TARGET_SUBFOLDER_NAME = "InTabPDF"
    const val BASE_DOCUMENTS_DISPLAY_PATH = "Documents/InTabPDF"
    private const val MAX_FILE_NAME_LENGTH = 120

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

    fun sanitizeTargetFileName(rawName: String?, defaultName: String = "document.pdf"): String {
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

        if (candidate.length > MAX_FILE_NAME_LENGTH) {
            val (b, e) = splitBaseAndExtension(candidate)
            if (e.isNotEmpty() && e.length + 1 < MAX_FILE_NAME_LENGTH) {
                candidate = "${takeSafeCodePointPrefix(b, MAX_FILE_NAME_LENGTH - e.length).trimEnd('.', ' ').ifEmpty { "document" }}$e"
            } else {
                candidate = takeSafeCodePointPrefix(candidate, MAX_FILE_NAME_LENGTH).trimEnd('.', ' ').ifEmpty { "document" }
            }
        }
        return candidate
    }

    fun splitBaseAndExtension(fileName: String): Pair<String, String> {
        val lastDot = fileName.lastIndexOf('.')
        if (lastDot <= 0 || lastDot >= fileName.length - 1) {
            return fileName to ""
        }
        return fileName.substring(0, lastDot) to fileName.substring(lastDot)
    }

    private fun takeSafeCodePointPrefix(text: String, maxChars: Int): String {
        if (text.length <= maxChars) return text
        var end = maxChars
        if (end > 0 && Character.isHighSurrogate(text[end - 1])) {
            end--
        }
        return text.substring(0, end.coerceAtLeast(0))
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
    ): String {
        val existingLower = existingNames.mapTo(HashSet()) { it.lowercase(Locale.ROOT) }
        val (rawBase, ext) = splitBaseAndExtension(desiredName)
        val suffixMatch = Regex("^(.*?)\\s*\\((\\d+)\\)$").find(rawBase)
        val cleanBase = suffixMatch?.groupValues?.get(1)?.trim()?.ifEmpty { rawBase } ?: rawBase
        val startCounter = suffixMatch?.groupValues?.get(2)?.toIntOrNull()?.plus(1) ?: 1

        for (counter in startCounter until startCounter + 1000) {
            val candidate = "$cleanBase ($counter)$ext"
            if (!existingLower.contains(candidate.lowercase(Locale.ROOT))) {
                return candidate
            }
        }
        return "$cleanBase (${System.currentTimeMillis()})$ext"
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
