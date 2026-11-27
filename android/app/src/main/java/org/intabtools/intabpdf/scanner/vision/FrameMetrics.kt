package org.intabtools.intabpdf.scanner.vision

import org.intabtools.intabpdf.scanner.imaging.OpenCvRuntime
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

    private class Buffers {
        val gray = Mat()
        val small = Mat()
        val thumb = Mat()
        val laplacian = Mat()
        val denoisedCenter = Mat()
        val diff = Mat()
        val meanMat = MatOfDouble()
        val stdMat = MatOfDouble()
    }

    // Lazily allocate OpenCV native Mat buffers so UI construction cannot trigger JNI before OpenCV loads.
    private val buffers by lazy(LazyThreadSafetyMode.SYNCHRONIZED) { Buffers() }
    private var previousThumbnail: Mat? = null

    @Synchronized
    fun analyze(rgbaMat: Mat): FrameQualityMetrics {
        if (!OpenCvRuntime.ensureInitialized() || rgbaMat.empty() || rgbaMat.cols() < 16 || rgbaMat.rows() < 16) {
            return FrameQualityMetrics(meanLuminance = 128f, sharpnessVariance = 0f, motionDelta = 1f)
        }

        val gray = buffers.gray
        val small = buffers.small
        val thumb = buffers.thumb
        val laplacian = buffers.laplacian
        val denoisedCenter = buffers.denoisedCenter
        val diff = buffers.diff
        val meanMat = buffers.meanMat
        val stdMat = buffers.stdMat

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

        // Under moderately dim indoor light (35..95), suppress 1px ISO speckle with a 3x3 median
        // filter before measuring Laplacian variance and apply a mild, bounded luminance boost.
        val sharpnessTarget = if (mean in 35f..95f) {
            Imgproc.medianBlur(center, denoisedCenter, 3)
            denoisedCenter
        } else {
            center
        }
        Imgproc.Laplacian(sharpnessTarget, laplacian, CvType.CV_64F)
        Core.meanStdDev(laplacian, meanMat, stdMat)
        val std = stdMat.get(0, 0)?.get(0) ?: 0.0
        val rawSharpness = (std * std).toFloat()
        val sharpness = if (mean in 35f..95f) {
            val gain = (95f / mean.coerceAtLeast(50f)).coerceIn(1f, 1.55f)
            rawSharpness * gain * gain
        } else {
            rawSharpness
        }
        center.release()

        Imgproc.resize(small, thumb, Size(32.0, 24.0), 0.0, 0.0, Imgproc.INTER_AREA)
        val prev = previousThumbnail
        val motionDelta = if (prev != null && prev.size() == thumb.size()) {
            Core.absdiff(prev, thumb, diff)
            (Core.mean(diff).`val`[0] / 255.0).toFloat()
        } else {
            0.02f
        }

        if (previousThumbnail == null) {
            previousThumbnail = thumb.clone()
        } else {
            thumb.copyTo(previousThumbnail)
        }

        return FrameQualityMetrics(
            meanLuminance = mean.coerceIn(0f, 255f),
            sharpnessVariance = sharpness,
            motionDelta = abs(motionDelta),
        )
    }

    @Synchronized
    fun reset() {
        previousThumbnail?.release()
        previousThumbnail = null
    }
}
