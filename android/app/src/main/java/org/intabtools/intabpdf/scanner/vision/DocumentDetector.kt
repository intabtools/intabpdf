package org.intabtools.intabpdf.scanner.vision

import org.opencv.core.Mat

enum class DetectionMode {
    LIVE_PREVIEW,
    STILL_CAPTURE,
}

data class DetectionResult(
    val normalizedQuad: NormalizedQuad?,
    val confidence: Float,
    val areaFraction: Float,
    val touchesOuterMargin: Boolean,
    val inferenceTimeMs: Long,
) {
    companion object {
        fun empty(inferenceTimeMs: Long = 0L): DetectionResult = DetectionResult(
            normalizedQuad = null,
            confidence = 0f,
            areaFraction = 0f,
            touchesOuterMargin = false,
            inferenceTimeMs = inferenceTimeMs,
        )
    }
}

/**
 * Abstract boundary detection contract so classical OpenCV detection in Milestone 2
 * can later be swapped or augmented with an Apache-2.0/MIT neural segmentation model.
 */
interface DocumentDetector {
    fun detect(sourceRgbaMat: Mat, mode: DetectionMode): DetectionResult
}
