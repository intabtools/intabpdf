package org.intabtools.intabpdf.savetodevice

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class SaveToDeviceCoreTest {

    @Test
    fun sanitizeFileNameBlocksTraversalAndControlCharactersWhilePreservingExtensions() {
        assertEquals("passwd", SharedFileMetadata.sanitizeFileName("../../../etc/passwd"))
        assertEquals("secret.docx", SharedFileMetadata.sanitizeFileName("..\\..\\folder\\secret.docx"))
        assertEquals("report_2026_.pdf", SharedFileMetadata.sanitizeFileName("report:2026*.pdf"))
        assertEquals("notes.txt", SharedFileMetadata.sanitizeFileName("n\u0000o\u0007t\u202Ee\u200Fs.txt"))
        assertEquals("shared_file.pdf", SharedFileMetadata.sanitizeFileName("..", extensionHint = "pdf"))
        assertEquals("shared_file.docx", SharedFileMetadata.sanitizeFileName("   ", extensionHint = "docx"))

        val overlong = "a".repeat(160) + ".pptx"
        val bounded = SharedFileMetadata.sanitizeFileName(overlong)
        assertTrue(bounded.length <= 120)
        assertTrue(bounded.endsWith(".pptx"))

        // Unicode preservation, surrogate-safe truncation, and DOS/FAT reserved device names
        assertEquals(
            "résumé 2026 — 日本語.pdf",
            SharedFileMetadata.sanitizeFileName("résumé 2026 — 日本語.pdf"),
        )
        assertEquals("CON_.pdf", SharedFileMetadata.sanitizeFileName("CON.pdf"))
        assertEquals("nul_", SharedFileMetadata.sanitizeFileName("nul"))
        val emojiLong = "\uD83D\uDCC4".repeat(70) + ".pdf"
        val emojiBounded = SharedFileMetadata.sanitizeFileName(emojiLong)
        assertTrue(emojiBounded.length <= 120)
        assertTrue(emojiBounded.endsWith(".pdf"))
        assertFalse(Character.isHighSurrogate(emojiBounded.substringBeforeLast('.').last()))
    }

    @Test
    fun preservesMimeTypesAndExtensionsAcrossSupportedDocumentAndImageFormats() {
        val cases = listOf(
            Triple("application/pdf", "scan", "scan.pdf" to "application/pdf"),
            Triple("application/msword", "letter", "letter.doc" to "application/msword"),
            Triple(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "proposal",
                "proposal.docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            Triple("application/vnd.ms-excel", "ledger", "ledger.xls" to "application/vnd.ms-excel"),
            Triple(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "budget",
                "budget.xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ),
            Triple("application/vnd.ms-powerpoint", "deck", "deck.ppt" to "application/vnd.ms-powerpoint"),
            Triple(
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "slides",
                "slides.pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ),
            Triple("text/plain; charset=utf-8", "readme", "readme.txt" to "text/plain"),
            Triple("text/csv", "export", "export.csv" to "text/csv"),
            Triple("text/markdown", "notes", "notes.md" to "text/markdown"),
            Triple("application/rtf", "contract", "contract.rtf" to "application/rtf"),
            Triple("image/jpeg", "photo", "photo.jpg" to "image/jpeg"),
            Triple("image/png", "diagram", "diagram.png" to "image/png"),
            Triple("image/webp", "banner", "banner.webp" to "image/webp"),
        )

        for ((providerMime, rawName, expected) in cases) {
            val extHint = SharedFileMetadata.resolveExtensionForMimeType(providerMime)
            val cleanName = SharedFileMetadata.sanitizeFileName(rawName, extensionHint = extHint)
            val resolvedMime = SharedFileMetadata.resolveMimeType(
                providerMime = providerMime,
                intentMime = "*/*",
                sanitizedFileName = cleanName,
            )
            assertEquals(expected.first, cleanName)
            assertEquals(expected.second, resolvedMime)
        }

        // Wildcard or container/imprecise provider MIME prefers reliable extension MIME without mutating extension
        assertEquals(
            "application/pdf",
            SharedFileMetadata.resolveMimeType("*/*", "application/*", "invoice.pdf"),
        )
        assertEquals(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            SharedFileMetadata.resolveMimeType("application/zip", "*/*", "budget.xlsx"),
        )
        assertEquals(
            "text/markdown",
            SharedFileMetadata.resolveMimeType("text/plain", "*/*", "notes.md"),
        )
        assertEquals(
            "text/csv",
            SharedFileMetadata.resolveMimeType("text/plain", "*/*", "table.csv"),
        )
        // Unknown extension retains original extension and falls back to generic MIME
        assertEquals("design.dwg", SharedFileMetadata.sanitizeFileName("design.dwg", extensionHint = null))
        assertEquals(
            SharedFileMetadata.GENERIC_MIME_TYPE,
            SharedFileMetadata.resolveMimeType(null, "*/*", "design.dwg"),
        )
        assertEquals(
            SharedFileMetadata.GENERIC_MIME_TYPE,
            SharedFileMetadata.resolveMimeType(null, "*/*", "rawbinary"),
        )
    }

    @Test
    fun filterIncomingUriStringsAcceptsOnlyContentUrisDeduplicatesAndBoundsCount() {
        val candidates = listOf(
            "content://org.example.provider/1" to "content",
            "file:///data/data/org.intabtools.intabpdf/files/secret" to "file",
            "https://example.com/evil.pdf" to "https",
            "content://org.example.provider/1" to "content", // duplicate
            "content://org.example.provider/2" to "content",
            "content://org.example.provider/3" to "content",
            null to "content",
        )

        val resolved = SharedFileMetadata.filterIncomingUriStrings(
            candidates = candidates,
            isMultiple = true,
            maxItems = 2,
        )
        assertEquals(
            listOf("content://org.example.provider/1", "content://org.example.provider/2"),
            resolved.uriStrings,
        )
        assertTrue(resolved.isMultiple)
        assertEquals(3, resolved.rejectedCount)
        assertEquals(1, resolved.truncatedCount)

        val singleFromMultipleAction = SharedFileMetadata.filterIncomingUriStrings(
            candidates = listOf("content://org.example.provider/only" to "content"),
            isMultiple = true,
        )
        assertFalse(singleFromMultipleAction.isMultiple)
    }

    @Test
    fun deduplicateFileNameGeneratesSafeNonOverwritingNamesCaseInsensitively() {
        val existing = mutableSetOf("report.pdf", "notes")
        assertEquals("Report (1).PDF", SharedFileMetadata.deduplicateFileName("Report.PDF", existing))
        assertEquals("report (2).pdf", SharedFileMetadata.deduplicateFileName("report.pdf", existing))
        assertEquals("notes (1)", SharedFileMetadata.deduplicateFileName("notes", existing))
        assertEquals("archive.tar.gz", SharedFileMetadata.deduplicateFileName("archive.tar.gz", existing))
        assertEquals("archive.tar (1).gz", SharedFileMetadata.deduplicateFileName("archive.tar.gz", existing))
    }

    @Test
    fun copyStreamStreamsLargePayloadWithoutCorruptingBytesAndFlushes() {
        val totalBytes = 6 * 1024 * 1024 + 137 // > 6 MiB across many 32 KiB chunks
        val payload = ByteArray(totalBytes) { i -> ((i * 31) and 0xFF).toByte() }
        val expectedDigest = MessageDigest.getInstance("SHA-256").digest(payload)

        val output = ByteArrayOutputStream()
        val progressUpdates = mutableListOf<Long>()
        val copied = StreamFileCopier.copyStream(
            input = ByteArrayInputStream(payload),
            output = output,
            onProgress = { bytes -> progressUpdates.add(bytes) },
        )

        assertEquals(totalBytes.toLong(), copied)
        assertTrue(progressUpdates.size > 100)
        assertEquals(totalBytes.toLong(), progressUpdates.last())
        assertArrayEquals(expectedDigest, MessageDigest.getInstance("SHA-256").digest(output.toByteArray()))
    }

    @Test
    fun copyStreamHonorsMidStreamCancellationAndSurfacesReadWriteErrors() {
        val source = ByteArray(256 * 1024) { 0x42 }
        var chunks = 0
        var threwCancel = false
        try {
            StreamFileCopier.copyStream(
                input = ByteArrayInputStream(source),
                output = ByteArrayOutputStream(),
                isCancelled = { chunks >= 2 },
                onProgress = { chunks++ },
            )
        } catch (_: CancellationException) {
            threwCancel = true
        }
        assertTrue("Expected CancellationException mid-stream", threwCancel)

        val failingInput = object : InputStream() {
            override fun read(): Int = throw IOException("Simulated read I/O failure")
        }
        var threwRead = false
        try {
            StreamFileCopier.copyStream(failingInput, ByteArrayOutputStream())
        } catch (_: IOException) {
            threwRead = true
        }
        assertTrue("Expected IOException on read failure", threwRead)

        val failingOutput = object : OutputStream() {
            override fun write(b: Int) = throw IOException("No space left on device")
            override fun write(b: ByteArray, off: Int, len: Int) = throw IOException("No space left on device")
        }
        var threwWrite = false
        try {
            StreamFileCopier.copyStream(ByteArrayInputStream(ByteArray(4096)), failingOutput)
        } catch (_: IOException) {
            threwWrite = true
        }
        assertTrue("Expected IOException on write failure", threwWrite)
    }
}
