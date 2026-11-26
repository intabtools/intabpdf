package org.intabtools.intabpdf.savetodevice

import java.util.Locale

data class SharedFileDescriptor(
    val uriString: String,
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long? = null,
)

data class ResolvedShareInput(
    val uriStrings: List<String>,
    val isMultiple: Boolean,
    val rejectedCount: Int = 0,
    val truncatedCount: Int = 0,
)

object SharedFileMetadata {

    const val MAX_SHARED_ITEMS = 50
    const val DEFAULT_BASE_NAME = "shared_file"
    const val GENERIC_MIME_TYPE = "application/octet-stream"
    private const val MAX_FILE_NAME_LENGTH = 120

    private val RESERVED_DOS_NAMES = setOf(
        "con", "prn", "aux", "nul",
        "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
        "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    )

    private val CONTAINER_OR_GENERIC_MIMES = setOf(
        GENERIC_MIME_TYPE,
        "application/zip",
        "application/x-zip-compressed",
        "text/plain",
    )

    private val MIME_TO_EXTENSION = mapOf(
        "application/pdf" to "pdf",
        "application/msword" to "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" to "docx",
        "application/vnd.ms-excel" to "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" to "xlsx",
        "application/vnd.ms-powerpoint" to "ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" to "pptx",
        "text/plain" to "txt",
        "text/csv" to "csv",
        "text/comma-separated-values" to "csv",
        "application/csv" to "csv",
        "text/markdown" to "md",
        "text/x-markdown" to "md",
        "application/rtf" to "rtf",
        "text/rtf" to "rtf",
        "image/jpeg" to "jpg",
        "image/jpg" to "jpg",
        "image/png" to "png",
        "image/webp" to "webp",
        "image/gif" to "gif",
        "image/heic" to "heic",
        "image/heif" to "heif",
        "application/zip" to "zip",
        "application/json" to "json",
    )

    private val EXTENSION_TO_MIME = mapOf(
        "pdf" to "application/pdf",
        "doc" to "application/msword",
        "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" to "application/vnd.ms-excel",
        "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" to "application/vnd.ms-powerpoint",
        "pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "txt" to "text/plain",
        "csv" to "text/csv",
        "md" to "text/markdown",
        "markdown" to "text/markdown",
        "rtf" to "application/rtf",
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "png" to "image/png",
        "webp" to "image/webp",
        "gif" to "image/gif",
        "heic" to "image/heic",
        "heif" to "image/heif",
        "zip" to "application/zip",
        "json" to "application/json",
    )

    /**
     * Only allow content:// URIs for incoming external shares so raw filesystem paths
     * or network URLs cannot be abused via Share intents.
     */
    fun isAllowedContentUriString(uriString: String?, scheme: String?): Boolean {
        if (uriString.isNullOrBlank() || scheme.isNullOrBlank()) {
            return false
        }
        return scheme.equals("content", ignoreCase = true)
    }

    fun filterIncomingUriStrings(
        candidates: List<Pair<String?, String?>>,
        isMultiple: Boolean,
        maxItems: Int = MAX_SHARED_ITEMS,
    ): ResolvedShareInput {
        val accepted = LinkedHashSet<String>()
        var rejected = 0
        var truncated = 0

        for ((uriStr, scheme) in candidates) {
            if (!isAllowedContentUriString(uriStr, scheme)) {
                rejected++
                continue
            }
            val safeUri = uriStr!!
            if (accepted.contains(safeUri)) {
                continue
            }
            if (accepted.size >= maxItems) {
                truncated++
                continue
            }
            accepted.add(safeUri)
        }

        return ResolvedShareInput(
            uriStrings = accepted.toList(),
            isMultiple = isMultiple && accepted.size > 1,
            rejectedCount = rejected,
            truncatedCount = truncated,
        )
    }

    fun normalizeMimeType(rawMime: String?): String? {
        if (rawMime.isNullOrBlank()) return null
        val semi = rawMime.indexOf(';')
        val base = (if (semi >= 0) rawMime.substring(0, semi) else rawMime)
            .trim()
            .lowercase(Locale.ROOT)
        if (base.isEmpty() || !base.contains('/')) return null
        return base
    }

    fun isWildcardMime(mime: String?): Boolean {
        val norm = normalizeMimeType(mime) ?: return true
        return norm == "*/*" || norm.endsWith("/*")
    }

    fun resolveExtensionForMimeType(
        mimeType: String?,
        platformExtensionLookup: (String) -> String? = { null },
    ): String? {
        val normalized = normalizeMimeType(mimeType) ?: return null
        if (isWildcardMime(normalized) || normalized == GENERIC_MIME_TYPE) {
            return null
        }
        MIME_TO_EXTENSION[normalized]?.let { return it }
        val platformExt = platformExtensionLookup(normalized)?.trim()?.lowercase(Locale.ROOT)
        return platformExt?.takeIf { it.isNotEmpty() && it.length <= 12 && it.all { ch -> ch.isLetterOrDigit() } }
    }

    fun resolveMimeType(
        providerMime: String?,
        intentMime: String?,
        sanitizedFileName: String?,
        platformMimeLookup: (String) -> String? = { null },
    ): String {
        val ext = extractExtension(sanitizedFileName)
        val extMime = ext?.let {
            EXTENSION_TO_MIME[it] ?: normalizeMimeType(platformMimeLookup(it))?.takeUnless(::isWildcardMime)
        }

        val normalizedProvider = normalizeMimeType(providerMime)?.takeUnless(::isWildcardMime)
        val normalizedIntent = normalizeMimeType(intentMime)?.takeUnless(::isWildcardMime)

        // When the filename has a recognized extension, prefer it over generic or container MIMEs
        // (for example text/plain on .md/.csv or application/zip on .docx/.xlsx/.pptx) so SAF does
        // not append a mismatched extension.
        if (extMime != null && (normalizedProvider == null || normalizedProvider in CONTAINER_OR_GENERIC_MIMES)) {
            return extMime
        }

        if (normalizedProvider != null && normalizedProvider != GENERIC_MIME_TYPE) {
            return normalizedProvider
        }

        if (extMime != null) {
            return extMime
        }

        if (normalizedIntent != null && normalizedIntent != GENERIC_MIME_TYPE) {
            return normalizedIntent
        }

        return GENERIC_MIME_TYPE
    }

    fun extractExtension(fileName: String?): String? {
        if (fileName.isNullOrBlank()) return null
        val lastDot = fileName.lastIndexOf('.')
        if (lastDot <= 0 || lastDot >= fileName.length - 1) return null
        val ext = fileName.substring(lastDot + 1).trim().lowercase(Locale.ROOT)
        if (ext.length > 12 || !ext.all { it.isLetterOrDigit() }) {
            return null
        }
        return ext
    }

    /**
     * Strips path traversal segments, control/bidi characters, unsafe filesystem characters, and
     * reserved FAT/NTFS device names while preserving Unicode names and valid file extensions.
     */
    fun sanitizeFileName(
        rawName: String?,
        extensionHint: String? = null,
        fallbackBaseName: String = DEFAULT_BASE_NAME,
    ): String {
        val normalizedHint = extensionHint
            ?.trim()
            ?.trimStart('.')
            ?.lowercase(Locale.ROOT)
            ?.takeIf { it.isNotEmpty() && it.length <= 12 && it.all(Char::isLetterOrDigit) }

        val cleanedInput = rawName
            ?.let { stripUnsafeControlAndBidiChars(it) }
            ?.replace('\\', '/')
            ?.substringAfterLast('/')
            ?.trim()
            .orEmpty()

        val replacedUnsafe = buildString(cleanedInput.length) {
            for (ch in cleanedInput) {
                when (ch) {
                    ':', '*', '?', '"', '<', '>', '|' -> append('_')
                    else -> append(ch)
                }
            }
        }.trim().trim('.')

        var candidate = if (
            replacedUnsafe.isEmpty() ||
            replacedUnsafe == "." ||
            replacedUnsafe == ".."
        ) {
            fallbackBaseName
        } else {
            replacedUnsafe
        }

        val lastDot = candidate.lastIndexOf('.')
        val hasExt = lastDot > 0 && lastDot < candidate.length - 1
        val basePart = if (hasExt) candidate.substring(0, lastDot) else candidate
        val extPart = if (hasExt) candidate.substring(lastDot) else ""
        if (basePart.lowercase(Locale.ROOT) in RESERVED_DOS_NAMES) {
            candidate = "${basePart}_$extPart"
        }

        if (extractExtension(candidate) == null && normalizedHint != null) {
            val baseOnly = candidate.trimEnd('.', ' ').ifEmpty { fallbackBaseName }
            candidate = "$baseOnly.$normalizedHint"
        }

        return boundFileNameLength(candidate, MAX_FILE_NAME_LENGTH)
    }

    private fun stripUnsafeControlAndBidiChars(input: String): String {
        return buildString(input.length) {
            for (ch in input) {
                val code = ch.code
                val isControl = code < 0x20 || code == 0x7F
                val isBidi = code in 0x202A..0x202E || code in 0x2066..0x2069 || code == 0x200E || code == 0x200F
                if (!isControl && !isBidi) {
                    append(ch)
                }
            }
        }
    }

    private fun takeSafeCodePointPrefix(text: String, maxChars: Int): String {
        if (text.length <= maxChars) return text
        var end = maxChars
        if (end > 0 && Character.isHighSurrogate(text[end - 1])) {
            end--
        }
        return text.substring(0, end.coerceAtLeast(0))
    }

    private fun boundFileNameLength(name: String, maxLength: Int): String {
        if (name.length <= maxLength) return name
        val ext = extractExtension(name)
        if (ext != null && ext.length + 2 < maxLength) {
            val suffix = ".$ext"
            val maxBaseLen = maxLength - suffix.length
            val base = takeSafeCodePointPrefix(name.substring(0, name.length - suffix.length), maxBaseLen)
                .trimEnd('.', ' ')
                .ifEmpty { DEFAULT_BASE_NAME }
            return "$base$suffix"
        }
        return takeSafeCodePointPrefix(name, maxLength).trimEnd('.', ' ').ifEmpty { DEFAULT_BASE_NAME }
    }

    /**
     * Produces a unique filename inside a directory or batch without overwriting an existing entry.
     */
    fun deduplicateFileName(
        desiredName: String,
        existingNamesLowercase: MutableSet<String>,
    ): String {
        val clean = sanitizeFileName(desiredName)
        val key = clean.lowercase(Locale.ROOT)
        if (existingNamesLowercase.add(key)) {
            return clean
        }

        val lastDot = clean.lastIndexOf('.')
        val hasExt = lastDot > 0 && lastDot < clean.length - 1
        val base = if (hasExt) clean.substring(0, lastDot) else clean
        val ext = if (hasExt) clean.substring(lastDot) else ""

        var counter = 1
        while (counter < 10_000) {
            val suffix = " ($counter)$ext"
            val maxBaseLen = (MAX_FILE_NAME_LENGTH - suffix.length).coerceAtLeast(1)
            val candidateBase = takeSafeCodePointPrefix(base, maxBaseLen).ifEmpty { DEFAULT_BASE_NAME }
            val candidate = "$candidateBase$suffix"
            if (existingNamesLowercase.add(candidate.lowercase(Locale.ROOT))) {
                return candidate
            }
            counter++
        }
        val fallback = "${takeSafeCodePointPrefix(base, MAX_FILE_NAME_LENGTH - 24)}_${System.currentTimeMillis()}$ext"
        existingNamesLowercase.add(fallback.lowercase(Locale.ROOT))
        return fallback
    }

    fun formatByteCount(bytes: Long): String {
        if (bytes < 1024L) return "$bytes B"
        val kb = bytes / 1024.0
        if (kb < 1024.0) return String.format(Locale.US, "%.1f KB", kb)
        val mb = kb / 1024.0
        if (mb < 1024.0) return String.format(Locale.US, "%.1f MB", mb)
        val gb = mb / 1024.0
        return String.format(Locale.US, "%.2f GB", gb)
    }
}
