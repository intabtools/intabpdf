package org.intabtools.intabpdf.scanner.vision

import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * Verifies that detector and quality analyzer instances can be constructed on the UI thread
 * before OpenCV native libraries are loaded into the process.
 */
class DetectorConstructionTest {

    @Test
    fun detectorAndFrameQualityAnalyzerConstructWithoutLoadingOpenCv() {
        val detector = OpenCvDocumentDetector()
        val analyzer = FrameQualityAnalyzer()
        analyzer.reset()
        assertNotNull(detector)
        assertNotNull(analyzer)
    }
}
