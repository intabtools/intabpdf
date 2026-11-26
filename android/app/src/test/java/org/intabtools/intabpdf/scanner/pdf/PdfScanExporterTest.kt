package org.intabtools.intabpdf.scanner.pdf

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class PdfScanExporterTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    @Test
    fun sanitizePdfFileNameHandlesBlankSpecialCharsAndExtensions() {
        val defaultName = PdfScanExporter.sanitizePdfFileName(null)
        assertTrue(defaultName.startsWith("Scan_"))
        assertTrue(defaultName.endsWith(".pdf"))
        assertFalse(defaultName.startsWith("."))

        assertEquals("Receipt_2026.pdf", PdfScanExporter.sanitizePdfFileName("Receipt:2026"))
        assertEquals("Taxes.pdf", PdfScanExporter.sanitizePdfFileName("Taxes.pdf"))
        assertEquals("scan-123.pdf", PdfScanExporter.sanitizePdfFileName(".scan-123.pdf"))
    }

    @Test
    fun prepareShareablePdfFileExposesFriendlyFileNameWithoutInternalTempPrefix() {
        val outputDir = tempFolder.newFolder("scanner_outputs")
        val friendlyName = PdfScanExporter.sanitizePdfFileName(null)

        // Direct match keeps exact friendly filename
        val directFile = File(outputDir, friendlyName).apply { writeText("%PDF-1.4") }
        val directResult = PdfExportResult(
            outputFile = directFile,
            fileName = friendlyName,
            pageCount = 1,
            sizeBytes = directFile.length(),
        )
        val directShareFile = PdfScanExporter.prepareShareablePdfFile(outputDir, directResult)
        assertEquals(friendlyName, directShareFile.name)
        assertTrue(directShareFile.exists())

        // Collision-suffixed or internal-named file is moved to friendly filename inside outputDir
        val suffixedFile = File(outputDir, ".scan-tmp_abc123.pdf").apply { writeText("%PDF-1.4") }
        val suffixedResult = PdfExportResult(
            outputFile = suffixedFile,
            fileName = friendlyName,
            pageCount = 1,
            sizeBytes = suffixedFile.length(),
        )
        val normalizedShareFile = PdfScanExporter.prepareShareablePdfFile(outputDir, suffixedResult)
        assertEquals(friendlyName, normalizedShareFile.name)
        assertFalse(normalizedShareFile.name.startsWith(".scan-"))
        assertTrue(normalizedShareFile.exists())
        assertTrue(normalizedShareFile.canonicalPath.startsWith(outputDir.canonicalPath))
    }

    @Test
    fun computePdfPageSizePointsPreservesOrientationAndAspectRatio() {
        val (pw, ph) = PdfScanExporter.computePdfPageSizePoints(1200, 1800)
        assertTrue("Portrait image should yield portrait page ($pw x $ph)", ph > pw)
        assertEquals(1200.0 / 1800.0, pw.toDouble() / ph.toDouble(), 0.02)

        val (lw, lh) = PdfScanExporter.computePdfPageSizePoints(1800, 1200)
        assertTrue("Landscape image should yield landscape page ($lw x $lh)", lw > lh)
        assertEquals(1800.0 / 1200.0, lw.toDouble() / lh.toDouble(), 0.02)
    }
}
