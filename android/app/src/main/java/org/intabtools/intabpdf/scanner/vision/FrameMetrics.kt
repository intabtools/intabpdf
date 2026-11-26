package org.intabtools.intabpdf.scanner.vision

import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfDouble
import org.opencv.core.Rect
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import kotlin.math.abs

data class FrameQualityMetrics(
    val meanLuminance: Float,
    val sharpnessVariance: Float,
    val motionDelta: Float,
)

/**
 * Evaluates lighting, Laplacian focus sharpness, and inter-frame camera steadiness
 * cleanly from live preview frames using OpenCV.
 */
class FrameQualityAnalyzer {

    private var previousThumbnail: Mat? = null

    fun analyze(rgbaMat: Mat): FrameQualityMetrics {
        if (rgbaMat.empty() || rgbaMat.cols() < 16 || rgbaMat.rows() < 16) {
            return FrameQualityMetrics(meanLuminance = 128f, sharpnessVariance = 0f, motionDelta = 1f)
        }

        val gray = Mat()
        val small = Mat()
        val thumb = Mat()
        val laplacian = Mat()
        try {
            if (rgbaMat.channels() == 4) {
                Imgproc.cvtColor(rgbaMat, gray, Imgproc.COLOR_RGBA2GRAY)
            } else if (rgbaMat.channels() == 3) {
                Imgproc.cvtColor(rgbaMat, gray, Imgproc.COLOR_BGR2GRAY)
            } else {
                rgbaMat.copyTo(gray)
            }

            Imgproc.resize(gray, small, Size(240.0, 180.0), 0.0, 0.0, Imgproc.INTER_AREA)

            val roiX = (small.cols() * 0.2).toInt()
            val roiY = (small.rows() * 0.2).toInt()
            val roiW = (small.cols() * 0.6).toInt().coerceAtLeast(16)
            val roiH = (small.rows() * 0.6).toInt().coerceAtLeast(16)
            val center = small.submat(Rect(roiX, roiY, roiW, roiH))

            val mean = Core.mean(center).`val`[0].toFloat()

            Imgproc.Laplacian(center, laplacian, CvType.CV_64F)
            val meanMat = MatOfDouble()
            val stdMat = MatOfDouble()
            Core.meanStdDev(laplacian, meanMat, stdMat)
            val std = stdMat.get(0, 0)?.get(0) ?: 0.0
            val sharpness = (std * std).toFloat()
            meanMat.release()
            stdMat.release()
            center.release()

            Imgproc.resize(small, thumb, Size(32.0, 24.0), 0.0, 0.0, Imgproc.INTER_AREA)
            val prev = previousThumbnail
            val motionDelta = if (prev != null && prev.size() == thumb.size()) {
                val diff = Mat()
                try {
                    Core.absdiff(prev, thumb, diff)
                    (Core.mean(diff).`val`[0] / 255.0).toFloat()
                } finally {
                    diff.release()
                }
            } else {
                0.02f
            }

            previousThumbnail?.release()
            previousThumbnail = thumb.clone()

            return FrameQualityMetrics(
                meanLuminance = mean.coerceIn(0f, 255f),
                sharpnessVariance = sharpness,
                motionDelta = abs(motionDelta),
            )
        } finally {
            gray.release()
            small.release()
            thumb.release()
            laplacian.release()
        }
    }

    fun reset() {
        previousThumbnail?.release()
        previousThumbnail = null
    }
}
