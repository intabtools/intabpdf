package org.intabtools.intabpdf.scanner.pdf

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PdfScanExporterTest {

    @Test
    fun sanitizePdfFileNameHandlesBlankSpecialCharsAndExtensions() {
        val defaultName = PdfScanExporter.sanitizePdfFileName(null)
        assertTrue(defaultName.startsWith("Scan_"))
        assertTrue(defaultName.endsWith(".pdf"))

        assertEquals("Receipt_2026.pdf", PdfScanExporter.sanitizePdfFileName("Receipt:2026"))
        assertEquals("Taxes.pdf", PdfScanExporter.sanitizePdfFileName("Taxes.pdf"))
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
