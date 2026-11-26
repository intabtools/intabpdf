package org.intabtools.intabpdf.save

import java.io.File
import java.io.FileOutputStream

interface RecoveryBackupIndexStore {
    fun listRecords(): List<RecoveryBackupRecord>
    fun findRecord(recoveryId: String): RecoveryBackupRecord?
    fun upsertRecord(record: RecoveryBackupRecord)
    fun removeRecord(recoveryId: String): Boolean
    fun getDiagnostics(): List<String>
}

/**
 * Lightweight atomic JSON-file index for persisted SAF recovery backups inside app-private filesDir.
 * Implemented without android.org.json stubs or external dependencies so behavior is identical in JVM
 * tests and Android runtime, while tolerating corrupted or partially written metadata gracefully.
 */
class SafRecoveryStore(private val recoveryDir: File) : RecoveryBackupIndexStore {

    private val indexFile: File = File(recoveryDir, INDEX_FILE_NAME)
    private val tmpFile: File = File(recoveryDir, "$INDEX_FILE_NAME.tmp")
    private val bakFile: File = File(recoveryDir, "$INDEX_FILE_NAME.bak")
    private val diagnostics = ArrayList<String>()

    @Synchronized
    override fun listRecords(): List<RecoveryBackupRecord> {
        val loaded = loadIndexedRecordsInternal()
        val reconciled = reconcileOrphanBackups(loaded.records)
        return reconciled.sortedByDescending { it.createdAtMillis }
    }

    @Synchronized
    override fun findRecord(recoveryId: String): RecoveryBackupRecord? =
        listRecords().firstOrNull { it.recoveryId == recoveryId }

    @Synchronized
    override fun upsertRecord(record: RecoveryBackupRecord) {
        val loaded = loadIndexedRecordsInternal()
        if (loaded.corruptSnapshotPreserved) {
            recordDiagnostic("Preserved corrupt recovery index before updating with ${record.recoveryId}.")
        }
        val baseRecords = reconcileOrphanBackups(loaded.records)
            .filterNot { it.recoveryId == record.recoveryId || it.backupFileName == record.backupFileName }
            .toMutableList()
        baseRecords.add(0, record)
        writeRecordsAtomically(baseRecords)
    }

    @Synchronized
    override fun removeRecord(recoveryId: String): Boolean {
        val loaded = loadIndexedRecordsInternal()
        val updated = loaded.records.filterNot { it.recoveryId == recoveryId }
        if (updated.size == loaded.records.size) {
            return false
        }
        writeRecordsAtomically(updated)
        return true
    }

    @Synchronized
    override fun getDiagnostics(): List<String> = diagnostics.toList()

    fun resolveDataFileForRecord(record: RecoveryBackupRecord): File? =
        resolveSafeDataFile(recoveryDir, record.backupFileName)

    private data class LoadedIndexResult(
        val records: List<RecoveryBackupRecord>,
        val corruptSnapshotPreserved: Boolean = false,
    )

    private fun loadIndexedRecordsInternal(): LoadedIndexResult {
        if (indexFile.exists()) {
            val raw = try {
                indexFile.readText(Charsets.UTF_8)
            } catch (ex: Exception) {
                recordDiagnostic("Could not read recovery index: ${ex.message ?: "I/O error"}")
                null
            }
            if (raw != null && raw.isNotBlank()) {
                val parsed = tryParseRecordList(raw)
                if (parsed != null) {
                    return LoadedIndexResult(parsed)
                }
                // Index exists but is malformed/partially written: preserve it and salvage whatever is possible
                preserveCorruptIndex(raw)
                val salvagedFromCorrupt = salvageObjectsFromCorruptText(raw)
                val recovered = recoverFromSnapshotFiles()
                val merged = mergeRecordLists(recovered, salvagedFromCorrupt)
                return LoadedIndexResult(merged, corruptSnapshotPreserved = true)
            }
            if (raw != null && raw.isBlank()) {
                recordDiagnostic("Recovery index was blank; checking backup snapshots.")
                val recovered = recoverFromSnapshotFiles()
                return LoadedIndexResult(recovered, corruptSnapshotPreserved = false)
            }
        }

        val recovered = recoverFromSnapshotFiles()
        return LoadedIndexResult(recovered)
    }

    private fun tryParseRecordList(raw: String): List<RecoveryBackupRecord>? {
        return try {
            val array = PureJson.parseArrayOfObjects(raw)
            val records = ArrayList<RecoveryBackupRecord>(array.size)
            for ((index, obj) in array.withIndex()) {
                val parsed = parseRecord(obj)
                if (parsed == null) {
                    recordDiagnostic("Skipped malformed recovery metadata entry at index $index.")
                    continue
                }
                records.add(applyDiskAvailability(parsed))
            }
            records
        } catch (ex: Exception) {
            recordDiagnostic("Recovery index JSON is malformed: ${ex.message ?: "parse error"}")
            null
        }
    }

    private fun recoverFromSnapshotFiles(): List<RecoveryBackupRecord> {
        for (snapshot in listOf(tmpFile, bakFile)) {
            if (!snapshot.exists() || !snapshot.isFile) continue
            val raw = try {
                snapshot.readText(Charsets.UTF_8)
            } catch (_: Exception) {
                continue
            }
            if (raw.isBlank()) continue
            val parsed = tryParseRecordList(raw)
            if (parsed != null) {
                recordDiagnostic("Recovered recovery metadata from ${snapshot.name}.")
                return parsed
            }
        }
        return emptyList()
    }

    private fun salvageObjectsFromCorruptText(raw: String): List<RecoveryBackupRecord> {
        val salvaged = ArrayList<RecoveryBackupRecord>()
        for (obj in PureJson.salvageObjects(raw)) {
            val parsed = parseRecord(obj) ?: continue
            salvaged.add(applyDiskAvailability(parsed))
        }
        if (salvaged.isNotEmpty()) {
            recordDiagnostic("Salvaged ${salvaged.size} recovery record(s) from corrupt index.")
        }
        return salvaged
    }

    private fun mergeRecordLists(
        primary: List<RecoveryBackupRecord>,
        secondary: List<RecoveryBackupRecord>,
    ): List<RecoveryBackupRecord> {
        val byId = LinkedHashMap<String, RecoveryBackupRecord>()
        for (rec in primary) {
            byId[rec.recoveryId] = rec
        }
        for (rec in secondary) {
            if (!byId.containsKey(rec.recoveryId)) {
                byId[rec.recoveryId] = rec
            }
        }
        return byId.values.toList()
    }

    private fun preserveCorruptIndex(raw: String) {
        try {
            if (!recoveryDir.exists()) {
                recoveryDir.mkdirs()
            }
            val corruptFile = File(recoveryDir, "$INDEX_FILE_NAME.corrupt")
            FileOutputStream(corruptFile, false).use { out ->
                out.write(raw.toByteArray(Charsets.UTF_8))
                out.flush()
                out.fd.sync()
            }
        } catch (ex: Exception) {
            recordDiagnostic("Failed to preserve corrupt recovery index: ${ex.message ?: "I/O error"}")
        }
    }

    private fun applyDiskAvailability(record: RecoveryBackupRecord): RecoveryBackupRecord {
        val dataFile = resolveSafeDataFile(recoveryDir, record.backupFileName)
        val existsOnDisk = dataFile != null && dataFile.isFile
        val available = existsOnDisk && (record.sizeBytes == 0L || dataFile!!.length() > 0L)
        return record.copy(
            backupAvailable = available,
            recoverySource = if (available) "local" else "unavailable",
        )
    }

    /**
     * Discovers unindexed `rec_*.bin` backup files on disk without inventing missing
     * filename or destination metadata.
     */
    private fun reconcileOrphanBackups(indexed: List<RecoveryBackupRecord>): List<RecoveryBackupRecord> {
        if (!recoveryDir.exists() || !recoveryDir.isDirectory) {
            return indexed
        }
        val knownFiles = indexed.mapTo(HashSet()) { it.backupFileName }
        val knownIds = indexed.mapTo(HashSet()) { it.recoveryId }
        val files = recoveryDir.listFiles() ?: return indexed

        val combined = indexed.toMutableList()
        for (entry in files) {
            if (!entry.isFile) continue
            val name = entry.name
            if (!name.startsWith("rec_") || !name.endsWith(".bin")) continue
            if (knownFiles.contains(name)) continue

            val derivedId = name.removeSuffix(".bin")
            val uniqueId = if (!knownIds.contains(derivedId)) derivedId else "orphan_${derivedId}_${entry.lastModified()}"
            knownFiles.add(name)
            knownIds.add(uniqueId)

            val fileLength = entry.length().coerceAtLeast(0L)
            val mtime = entry.lastModified().takeIf { it > 0L } ?: 0L
            combined.add(
                RecoveryBackupRecord(
                    recoveryId = uniqueId,
                    backupFileName = name,
                    originalFileName = "Unidentified backup ($name)",
                    mimeType = "application/octet-stream",
                    attemptedDestination = "Unknown (metadata unavailable)",
                    explanation = "Unindexed recovery backup ($name) was discovered in app recovery storage after an interrupted operation or damaged metadata. Original filename and destination could not be determined, but you can still export the preserved bytes.",
                    failureKind = RecoveryFailureKind.ORPHANED_BACKUP,
                    createdAtMillis = mtime,
                    sizeBytes = fileLength,
                    status = RecoveryBackupStatus.PENDING_ACTION,
                    backupAvailable = true,
                ),
            )
            recordDiagnostic("Discovered unindexed recovery backup file $name.")
        }
        return combined
    }

    private fun writeRecordsAtomically(records: List<RecoveryBackupRecord>) {
        if (!recoveryDir.exists()) {
            recoveryDir.mkdirs()
        }
        val json = PureJson.serializeArrayOfObjects(records.map(::serializeRecord))
        val encoded = json.toByteArray(Charsets.UTF_8)

        // Persist prior valid index into .bak before replacing indexFile
        if (indexFile.exists() && indexFile.isFile) {
            val currentRaw = runCatching { indexFile.readText(Charsets.UTF_8) }.getOrNull()
            if (currentRaw != null && currentRaw.isNotBlank() && tryParseRecordList(currentRaw) != null) {
                val bakTmp = File(recoveryDir, "$INDEX_FILE_NAME.bak.tmp")
                FileOutputStream(bakTmp, false).use { out ->
                    out.write(currentRaw.toByteArray(Charsets.UTF_8))
                    out.flush()
                    out.fd.sync()
                }
                if (!bakTmp.renameTo(bakFile)) {
                    FileOutputStream(bakFile, false).use { out ->
                        out.write(currentRaw.toByteArray(Charsets.UTF_8))
                        out.flush()
                        out.fd.sync()
                    }
                    bakTmp.delete()
                }
            }
        }

        // Write and fsync replacement into .tmp first; never delete valid indexFile before renameTo
        FileOutputStream(tmpFile, false).use { out ->
            out.write(encoded)
            out.flush()
            out.fd.sync()
        }

        if (!tmpFile.renameTo(indexFile)) {
            FileOutputStream(indexFile, false).use { out ->
                out.write(encoded)
                out.flush()
                out.fd.sync()
            }
            val written = runCatching { indexFile.readBytes() }.getOrNull()
            if (written != null && written.contentEquals(encoded)) {
                tmpFile.delete()
            }
        }
    }

    private fun serializeRecord(record: RecoveryBackupRecord): LinkedHashMap<String, Any?> =
        linkedMapOf<String, Any?>(
            "recoveryId" to record.recoveryId,
            "backupFileName" to record.backupFileName,
            "originalFileName" to record.originalFileName,
            "mimeType" to record.mimeType,
            "attemptedDestination" to record.attemptedDestination,
            "explanation" to record.explanation,
            "failureKind" to record.failureKind.wireValue,
            "createdAtMillis" to record.createdAtMillis,
            "sizeBytes" to record.sizeBytes,
            "status" to record.status.wireValue,
        ).apply {
            if (record.safBackupDocumentName != null) {
                put("safBackupDocumentName", record.safBackupDocumentName)
            }
            if (record.safBackupUriString != null) {
                put("safBackupUriString", record.safBackupUriString)
            }
            if (record.safTreeUriString != null) {
                put("safTreeUriString", record.safTreeUriString)
            }
            if (record.exportedFileName != null) {
                put("exportedFileName", record.exportedFileName)
            }
        }

    private fun parseRecord(obj: Map<String, Any?>): RecoveryBackupRecord? {
        val recoveryId = (obj["recoveryId"] as? String)?.trim().orEmpty()
        val backupFileName = (obj["backupFileName"] as? String)?.trim().orEmpty()
        val originalFileName = (obj["originalFileName"] as? String)?.trim().orEmpty()
        if (recoveryId.isEmpty() || backupFileName.isEmpty() || originalFileName.isEmpty()) {
            return null
        }
        val mimeType = ((obj["mimeType"] as? String)?.takeIf { it.isNotBlank() }) ?: "application/pdf"
        val destination = ((obj["attemptedDestination"] as? String)?.takeIf { it.isNotBlank() })
            ?: "Unknown (metadata unavailable)"
        val explanation = ((obj["explanation"] as? String)?.takeIf { it.isNotBlank() })
            ?: "Replacement failed and a recovery copy was preserved."
        val failureKind = RecoveryFailureKind.fromWire(obj["failureKind"] as? String)
        val createdAt = (obj["createdAtMillis"] as? Number)?.toLong() ?: 0L
        val sizeBytes = ((obj["sizeBytes"] as? Number)?.toLong() ?: -1L).coerceAtLeast(0L)
        val status = RecoveryBackupStatus.fromWire(obj["status"] as? String)
        val safDocName = (obj["safBackupDocumentName"] as? String)?.takeIf { it.isNotBlank() }
        val safDocUri = (obj["safBackupUriString"] as? String)?.takeIf { it.isNotBlank() }
        val safTreeUri = (obj["safTreeUriString"] as? String)?.takeIf { it.isNotBlank() }
        val exportedFileName = (obj["exportedFileName"] as? String)?.takeIf { it.isNotBlank() }

        return RecoveryBackupRecord(
            recoveryId = recoveryId,
            backupFileName = backupFileName,
            originalFileName = originalFileName,
            mimeType = mimeType,
            attemptedDestination = destination,
            explanation = explanation,
            failureKind = failureKind,
            createdAtMillis = createdAt,
            sizeBytes = sizeBytes,
            status = status,
            safBackupDocumentName = safDocName,
            safBackupUriString = safDocUri,
            safTreeUriString = safTreeUri,
            exportedFileName = exportedFileName,
        )
    }

    private fun recordDiagnostic(message: String) {
        if (diagnostics.size >= 32) {
            diagnostics.removeAt(0)
        }
        diagnostics.add(message)
    }

    companion object {
        const val INDEX_FILE_NAME = "recovery_index.json"

        fun resolveSafeDataFile(recoveryDir: File, relativeName: String): File? {
            if (relativeName.isBlank() || relativeName.contains('/') || relativeName.contains('\\') || relativeName.contains("..")) {
                return null
            }
            return try {
                val baseCanonical = recoveryDir.canonicalFile
                val candidate = File(baseCanonical, relativeName).canonicalFile
                if (candidate.parentFile == baseCanonical) candidate else null
            } catch (_: Exception) {
                null
            }
        }
    }
}

private object PureJson {
    fun serializeArrayOfObjects(items: List<Map<String, Any?>>): String {
        val sb = StringBuilder()
        sb.append('[')
        for ((idx, item) in items.withIndex()) {
            if (idx > 0) sb.append(',')
            sb.append('\n')
            sb.append("  {")
            var firstField = true
            for ((key, value) in item) {
                if (!firstField) sb.append(',')
                firstField = false
                sb.append("\n    ")
                appendEscapedString(sb, key)
                sb.append(": ")
                when (value) {
                    null -> sb.append("null")
                    is Number, is Boolean -> sb.append(value.toString())
                    else -> appendEscapedString(sb, value.toString())
                }
            }
            sb.append("\n  }")
        }
        if (items.isNotEmpty()) sb.append('\n')
        sb.append(']')
        return sb.toString()
    }

    fun parseArrayOfObjects(raw: String): List<Map<String, Any?>> {
        val parser = Parser(raw)
        val result = parser.readArrayOfObjects()
        parser.skipWhitespace()
        if (!parser.isAtEnd()) {
            throw IllegalArgumentException("Unexpected trailing JSON content")
        }
        return result
    }

    fun salvageObjects(raw: String): List<Map<String, Any?>> {
        val salvaged = ArrayList<Map<String, Any?>>()
        var idx = 0
        while (idx < raw.length) {
            if (raw[idx] == '{') {
                val parser = Parser(raw, idx)
                val parsed = runCatching { parser.readObject() }.getOrNull()
                if (parsed != null) {
                    salvaged.add(parsed)
                    idx = parser.currentPosition()
                    continue
                }
            }
            idx++
        }
        return salvaged
    }

    private fun appendEscapedString(sb: StringBuilder, text: String) {
        sb.append('"')
        for (ch in text) {
            when (ch) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> {
                    if (ch.code < 0x20) {
                        sb.append("\\u").append(ch.code.toString(16).padStart(4, '0'))
                    } else {
                        sb.append(ch)
                    }
                }
            }
        }
        sb.append('"')
    }

    private class Parser(private val src: String, startPos: Int = 0) {
        private var pos = startPos

        fun currentPosition(): Int = pos

        fun isAtEnd(): Boolean = pos >= src.length

        fun skipWhitespace() {
            while (pos < src.length && src[pos].isWhitespace()) {
                pos++
            }
        }

        fun readArrayOfObjects(): List<Map<String, Any?>> {
            skipWhitespace()
            expect('[')
            val items = ArrayList<Map<String, Any?>>()
            skipWhitespace()
            if (peek(']')) {
                pos++
                return items
            }
            while (true) {
                skipWhitespace()
                items.add(readObject())
                skipWhitespace()
                if (peek(',')) {
                    pos++
                } else if (peek(']')) {
                    pos++
                    return items
                } else {
                    throw IllegalArgumentException("Expected ',' or ']' at position $pos")
                }
            }
        }

        fun readObject(): Map<String, Any?> {
            expect('{')
            val map = LinkedHashMap<String, Any?>()
            skipWhitespace()
            if (peek('}')) {
                pos++
                return map
            }
            while (true) {
                skipWhitespace()
                val key = readString()
                skipWhitespace()
                expect(':')
                skipWhitespace()
                map[key] = readValue()
                skipWhitespace()
                if (peek(',')) {
                    pos++
                } else if (peek('}')) {
                    pos++
                    return map
                } else {
                    throw IllegalArgumentException("Expected ',' or '}' at position $pos")
                }
            }
        }

        private fun readValue(): Any? {
            skipWhitespace()
            if (isAtEnd()) throw IllegalArgumentException("Unexpected end of JSON")
            return when (src[pos]) {
                '"' -> readString()
                'n' -> {
                    consumeLiteral("null")
                    null
                }
                't' -> {
                    consumeLiteral("true")
                    true
                }
                'f' -> {
                    consumeLiteral("false")
                    false
                }
                '-', in '0'..'9' -> readNumber()
                else -> throw IllegalArgumentException("Unsupported JSON value at position $pos")
            }
        }

        private fun readString(): String {
            expect('"')
            val sb = StringBuilder()
            while (pos < src.length) {
                val ch = src[pos++]
                if (ch == '"') return sb.toString()
                if (ch == '\\') {
                    if (isAtEnd()) throw IllegalArgumentException("Unterminated escape")
                    when (val esc = src[pos++]) {
                        '"', '\\', '/' -> sb.append(esc)
                        'b' -> sb.append('\b')
                        'f' -> sb.append('\u000C')
                        'n' -> sb.append('\n')
                        'r' -> sb.append('\r')
                        't' -> sb.append('\t')
                        'u' -> {
                            if (pos + 4 > src.length) throw IllegalArgumentException("Invalid unicode escape")
                            val hex = src.substring(pos, pos + 4)
                            pos += 4
                            sb.append(hex.toInt(16).toChar())
                        }
                        else -> throw IllegalArgumentException("Invalid escape '\\$esc'")
                    }
                } else {
                    sb.append(ch)
                }
            }
            throw IllegalArgumentException("Unterminated JSON string")
        }

        private fun readNumber(): Long {
            val start = pos
            if (src[pos] == '-') pos++
            while (pos < src.length && src[pos].isDigit()) pos++
            val token = src.substring(start, pos)
            return token.toLongOrNull() ?: throw IllegalArgumentException("Invalid number '$token'")
        }

        private fun consumeLiteral(lit: String) {
            if (!src.startsWith(lit, pos)) {
                throw IllegalArgumentException("Expected '$lit' at position $pos")
            }
            pos += lit.length
        }

        private fun peek(expected: Char): Boolean = pos < src.length && src[pos] == expected

        private fun expect(expected: Char) {
            if (pos >= src.length || src[pos] != expected) {
                throw IllegalArgumentException("Expected '$expected' at position $pos")
            }
            pos++
        }
    }
}
