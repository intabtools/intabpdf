package org.intabtools.intabpdf.scanner.imaging

import org.intabtools.intabpdf.scanner.data.ScanFilter
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.Rect
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

data class FilteredPageResult(
    val mat: Mat,
    val requestedFilter: ScanFilter,
    val effectiveFilter: ScanFilter,
    val isBitonal: Boolean,
)

/**
 * Clean-room non-destructive OpenCV image enhancement engine supporting:
 * ORIGINAL, AUTO, COLOR, GRAYSCALE, and BLACK_AND_WHITE (Sauvola + solid fill preservation).
 */
object PageFilterEngine {

    /**
     * Inspects interior CIELAB chroma after neutral paper white-balancing to classify whether
     * a cropped document contains significant color elements (stamps, highlights, photos)
     * versus monochrome text.
     */
    fun detectAutoFilter(warpedBgr: Mat): ScanFilter {
        if (warpedBgr.empty() || warpedBgr.channels() < 3) return ScanFilter.GRAYSCALE

        val small = resizeMaxDim(warpedBgr, 640.0)
        val balanced = applyPaperWhiteBalance(small)
        val lab = Mat()
        try {
            // Crop inner 88% to ignore residual border fringes
            val insetX = (balanced.cols() * 0.06).toInt()
            val insetY = (balanced.rows() * 0.06).toInt()
            val roiW = (balanced.cols() - insetX * 2).coerceAtLeast(16)
            val roiH = (balanced.rows() - insetY * 2).coerceAtLeast(16)
            val interior = balanced.submat(Rect(insetX, insetY, roiW, roiH))

            Imgproc.cvtColor(interior, lab, Imgproc.COLOR_BGR2Lab)
            interior.release()

            val channels = ArrayList<Mat>(3)
            Core.split(lab, channels)
            val lChan = channels[0]
            val aFloat = Mat()
            val bFloat = Mat()
            channels[1].convertTo(aFloat, CvType.CV_32F, 1.0, -128.0)
            channels[2].convertTo(bFloat, CvType.CV_32F, 1.0, -128.0)
            channels.forEach { it.release() }

            // Compute chroma magnitude sqrt(a^2 + b^2)
            val aSq = Mat()
            val bSq = Mat()
            val chromaSq = Mat()
            val chroma = Mat()
            val coloredMask = Mat()
            try {
                Core.multiply(aFloat, aFloat, aSq)
                Core.multiply(bFloat, bFloat, bSq)
                Core.add(aSq, bSq, chromaSq)
                Core.sqrt(chromaSq, chroma)

                // Pixels with Lab chroma > 14 denote non-neutral hue
                Core.compare(chroma, Scalar(14.0), coloredMask, Core.CMP_GT)
                val totalPixels = (chroma.rows() * chroma.cols()).coerceAtLeast(1)
                val coloredFraction = Core.countNonZero(coloredMask).toDouble() / totalPixels.toDouble()
                val highColoredMask = Mat()
                Core.compare(chroma, Scalar(24.0), highColoredMask, Core.CMP_GT)
                val highFraction = Core.countNonZero(highColoredMask).toDouble() / totalPixels.toDouble()
                highColoredMask.release()

                return if (coloredFraction >= 0.015 || highFraction >= 0.004) {
                    ScanFilter.COLOR
                } else {
                    ScanFilter.GRAYSCALE
                }
            } finally {
                aFloat.release()
                bFloat.release()
                aSq.release()
                bSq.release()
                chromaSq.release()
                chroma.release()
                coloredMask.release()
                lChan.release()
            }
        } finally {
            small.release()
            balanced.release()
            lab.release()
        }
    }

    fun applyFilter(
        warpedBgr: Mat,
        requestedFilter: ScanFilter,
        isLowRamDevice: Boolean = false,
        targetBwMaxPixels: Long = 6_000_000L,
    ): FilteredPageResult {
        val resolved = if (requestedFilter == ScanFilter.AUTO) {
            detectAutoFilter(warpedBgr)
        } else {
            requestedFilter
        }

        val outMat = when (resolved) {
            ScanFilter.ORIGINAL -> warpedBgr.clone()
            ScanFilter.COLOR -> enhanceColor(warpedBgr)
            ScanFilter.GRAYSCALE -> enhanceGrayscale(warpedBgr)
            ScanFilter.BLACK_AND_WHITE -> enhanceBlackAndWhite(warpedBgr, isLowRamDevice, targetBwMaxPixels)
            ScanFilter.AUTO -> enhanceColor(warpedBgr) // unreachable due to resolution above
        }

        return FilteredPageResult(
            mat = outMat,
            requestedFilter = requestedFilter,
            effectiveFilter = resolved,
            isBitonal = resolved == ScanFilter.BLACK_AND_WHITE,
        )
    }

    /**
     * Color enhancement: neutral paper white-balance + smooth local illumination shadow lift
     * + mild Lab contrast boost without clipping colorful ink or photos.
     */
    fun enhanceColor(srcBgr: Mat): Mat {
        val balanced = applyPaperWhiteBalance(srcBgr)
        val lab = Mat()
        try {
            Imgproc.cvtColor(balanced, lab, Imgproc.COLOR_BGR2Lab)
            val channels = ArrayList<Mat>(3)
            Core.split(lab, channels)

            val lOrig = channels[0]
            val lFlattened = flattenLuminanceBackground(lOrig, blendWeight = 0.65, targetPaperLevel = 242.0)
            val lClahe = Mat()
            val clahe = Imgproc.createCLAHE(1.6, Size(8.0, 8.0))
            try {
                clahe.apply(lFlattened, lClahe)
                channels[0].release()
                channels[0] = lClahe

                Core.merge(channels, lab)
                val outBgr = Mat()
                Imgproc.cvtColor(lab, outBgr, Imgproc.COLOR_Lab2BGR)
                return outBgr
            } finally {
                lOrig.release()
                lFlattened.release()
                channels.forEach { it.release() }
            }
        } finally {
            balanced.release()
            lab.release()
        }
    }

    /**
     * Grayscale enhancement: local shadow removal normalizing paper background toward clean white
     * + percentile ink contrast stretch + light edge-preserving smoothing.
     */
    fun enhanceGrayscale(srcBgr: Mat): Mat {
        val gray = Mat()
        if (srcBgr.channels() >= 3) {
            Imgproc.cvtColor(srcBgr, gray, Imgproc.COLOR_BGR2GRAY)
        } else {
            srcBgr.copyTo(gray)
        }

        val flattened = flattenLuminanceBackground(gray, blendWeight = 0.92, targetPaperLevel = 250.0)
        val stretched = stretchGrayscalePercentiles(flattened, blackPercentile = 0.015, whitePercentile = 0.88)
        val denoised = Mat()
        try {
            Imgproc.bilateralFilter(stretched, denoised, 5, 16.0, 16.0)
            return denoised
        } finally {
            gray.release()
            flattened.release()
            stretched.release()
        }
    }

    /**
     * Black & White enhancement: flattened grayscale -> controlled crispness upscaling ->
     * Sauvola adaptive local thresholding -> solid dark fill preservation -> isolated speck cleanup.
     */
    fun enhanceBlackAndWhite(
        srcBgr: Mat,
        isLowRamDevice: Boolean = false,
        targetMaxPixels: Long = 6_000_000L,
    ): Mat {
        val flatGray = enhanceGrayscale(srcBgr)
        val effectiveCap = if (isLowRamDevice) targetMaxPixels.coerceAtMost(3_200_000L) else targetMaxPixels
        val working = upscaleIfBelowPixels(flatGray, effectiveCap)
        flatGray.release()

        val maxDim = max(working.cols(), working.rows())
        val window = ((maxDim / 10).coerceIn(15, 301)) or 1
        val binary = sauvolaThreshold(working, window = window, k = 0.22, r = 128.0)

        // Protect solid dark headers/bars/stamps from hollowing under local windows
        val darkFill = detectSmoothDarkFill(working, window)
        try {
            Core.subtract(binary, darkFill, binary)
            removeSmallSpecks(binary, minAreaPx = despeckleMinArea(maxDim), cleanWhiteInkHoles = true)
            removeSmallSpecks(binary, minAreaPx = despeckleMinArea(maxDim), cleanWhiteInkHoles = false)
            return binary
        } finally {
            working.release()
            darkFill.release()
        }
    }

    private fun applyPaperWhiteBalance(srcBgr: Mat): Mat {
        if (srcBgr.channels() < 3) return srcBgr.clone()

        val small = resizeMaxDim(srcBgr, 400.0)
        val gray = Mat()
        val mask = Mat()
        try {
            Imgproc.cvtColor(small, gray, Imgproc.COLOR_BGR2GRAY)
            val threshold = computePercentileValue(gray, 0.84)
            Core.compare(gray, Scalar(threshold), mask, Core.CMP_GE)
            if (Core.countNonZero(mask) < 25) {
                return srcBgr.clone()
            }

            val paperMean = Core.mean(small, mask).`val`
            val b = paperMean[0].coerceAtLeast(30.0)
            val g = paperMean[1].coerceAtLeast(30.0)
            val r = paperMean[2].coerceAtLeast(30.0)
            val lum = (b + g + r) / 3.0

            // Clamp gains conservatively so strongly colored paper isn't inverted
            val gainB = (lum / b).coerceIn(0.82, 1.32)
            val gainG = (lum / g).coerceIn(0.82, 1.32)
            val gainR = (lum / r).coerceIn(0.82, 1.32)

            if (abs(gainB - 1.0) < 0.02 && abs(gainG - 1.0) < 0.02 && abs(gainR - 1.0) < 0.02) {
                return srcBgr.clone()
            }

            val lutData = ByteArray(256 * 3)
            for (i in 0 until 256) {
                lutData[i * 3] = (i * gainB).roundToInt().coerceIn(0, 255).toByte()
                lutData[i * 3 + 1] = (i * gainG).roundToInt().coerceIn(0, 255).toByte()
                lutData[i * 3 + 2] = (i * gainR).roundToInt().coerceIn(0, 255).toByte()
            }
            val lut = Mat(1, 256, CvType.CV_8UC3)
            val out = Mat()
            try {
                lut.put(0, 0, lutData)
                Core.LUT(srcBgr, lut, out)
                return out
            } finally {
                lut.release()
            }
        } finally {
            small.release()
            gray.release()
            mask.release()
        }
    }

    /**
     * Estimates smooth paper illumination envelope at reduced scale and lifts darker shadow zones.
     */
    private fun flattenLuminanceBackground(lChan: Mat, blendWeight: Double, targetPaperLevel: Double): Mat {
        val maxDim = max(lChan.cols(), lChan.rows())
        val smallScale = if (maxDim > 480) 480.0 / maxDim else 1.0
        val smallW = max(16, (lChan.cols() * smallScale).roundToInt())
        val smallH = max(16, (lChan.rows() * smallScale).roundToInt())

        val small = Mat()
        val dilated = Mat()
        val blurBg = Mat()
        val bgFull = Mat()
        val srcFloat = Mat()
        val bgFloat = Mat()
        val normalized = Mat()
        val blended = Mat()
        try {
            Imgproc.resize(lChan, small, Size(smallW.toDouble(), smallH.toDouble()), 0.0, 0.0, Imgproc.INTER_AREA)
            val k = ((max(smallW, smallH) / 14).coerceIn(11, 55)) or 1
            val kernel = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(k.toDouble(), k.toDouble()))
            Imgproc.dilate(small, dilated, kernel)
            kernel.release()

            val blurK = (k * 2) or 1
            Imgproc.GaussianBlur(dilated, blurBg, Size(blurK.toDouble(), blurK.toDouble()), 0.0)
            Imgproc.resize(blurBg, bgFull, lChan.size(), 0.0, 0.0, Imgproc.INTER_LINEAR)

            lChan.convertTo(srcFloat, CvType.CV_32F)
            bgFull.convertTo(bgFloat, CvType.CV_32F)
            Core.max(bgFloat, Scalar(32.0), bgFloat)

            Core.divide(srcFloat, bgFloat, normalized, targetPaperLevel)
            Core.min(normalized, Scalar(255.0), normalized)
            Core.max(normalized, Scalar(0.0), normalized)

            Core.addWeighted(normalized, blendWeight, srcFloat, 1.0 - blendWeight, 0.0, blended)
            val out = Mat()
            blended.convertTo(out, CvType.CV_8U)
            return out
        } finally {
            small.release()
            dilated.release()
            blurBg.release()
            bgFull.release()
            srcFloat.release()
            bgFloat.release()
            normalized.release()
            blended.release()
        }
    }

    private fun stretchGrayscalePercentiles(
        gray: Mat,
        blackPercentile: Double,
        whitePercentile: Double,
    ): Mat {
        val low = computePercentileValue(gray, blackPercentile).coerceIn(0.0, 120.0)
        val high = computePercentileValue(gray, whitePercentile).coerceIn(low + 25.0, 255.0)
        val span = (high - low).coerceAtLeast(25.0)

        val lutData = ByteArray(256)
        for (i in 0 until 256) {
            val v = ((i - low) * 255.0 / span).roundToInt().coerceIn(0, 255)
            lutData[i] = v.toByte()
        }
        val lut = Mat(1, 256, CvType.CV_8U)
        val out = Mat()
        try {
            lut.put(0, 0, lutData)
            Core.LUT(gray, lut, out)
            return out
        } finally {
            lut.release()
        }
    }

    private fun computePercentileValue(singleChannel: Mat, percentile: Double): Double {
        val sample = if (max(singleChannel.cols(), singleChannel.rows()) > 320) {
            resizeMaxDim(singleChannel, 320.0)
        } else {
            singleChannel.clone()
        }
        try {
            val total = sample.rows() * sample.cols()
            val bytes = ByteArray(total)
            sample.get(0, 0, bytes)
            val hist = IntArray(256)
            for (b in bytes) {
                hist[b.toInt() and 0xFF]++
            }
            val targetCount = (total * percentile.coerceIn(0.0, 1.0)).toInt()
            var acc = 0
            for (v in 0 until 256) {
                acc += hist[v]
                if (acc >= targetCount) return v.toDouble()
            }
            return 255.0
        } finally {
            sample.release()
        }
    }

    private fun sauvolaThreshold(gray: Mat, window: Int, k: Double, r: Double): Mat {
        val winSize = Size(window.toDouble(), window.toDouble())
        val srcFloat = Mat()
        val mean = Mat()
        val squares = Mat()
        val meanSq = Mat()
        val variance = Mat()
        val stdDev = Mat()
        val thresh = Mat()
        val binary = Mat()
        try {
            gray.convertTo(srcFloat, CvType.CV_32F)
            Imgproc.boxFilter(srcFloat, mean, CvType.CV_32F, winSize)
            Core.multiply(srcFloat, srcFloat, squares)
            Imgproc.boxFilter(squares, variance, CvType.CV_32F, winSize)
            Core.multiply(mean, mean, meanSq)
            Core.subtract(variance, meanSq, variance)
            Core.max(variance, Scalar(0.0), variance)
            Core.sqrt(variance, stdDev)

            // thresh = mean * (1 + k * (stdDev / r - 1))
            Core.multiply(stdDev, Scalar(k / r), stdDev)
            Core.add(stdDev, Scalar(1.0 - k), stdDev)
            Core.multiply(mean, stdDev, thresh)

            Core.compare(srcFloat, thresh, binary, Core.CMP_GT)
            return binary
        } finally {
            srcFloat.release()
            mean.release()
            squares.release()
            meanSq.release()
            variance.release()
            stdDev.release()
            thresh.release()
        }
    }

    private fun detectSmoothDarkFill(gray: Mat, window: Int): Mat {
        val srcFloat = Mat()
        val mean = Mat()
        val sq = Mat()
        val dev = Mat()
        val meanSq = Mat()
        val smoothMask = Mat()
        val darkMask = Mat()
        val seeds = Mat()
        val grown = Mat()
        val dilateKernel = Imgproc.getStructuringElement(
            Imgproc.MORPH_RECT,
            Size(max(3, window / 3).toDouble(), max(3, window / 3).toDouble()),
        )
        try {
            val kSize = Size(9.0, 9.0)
            gray.convertTo(srcFloat, CvType.CV_32F)
            Imgproc.boxFilter(srcFloat, mean, CvType.CV_32F, kSize)
            Core.multiply(srcFloat, srcFloat, sq)
            Imgproc.boxFilter(sq, dev, CvType.CV_32F, kSize)
            Core.multiply(mean, mean, meanSq)
            Core.subtract(dev, meanSq, dev)
            Core.max(dev, Scalar(0.0), dev)
            Core.sqrt(dev, dev)

            Core.compare(dev, Scalar(13.0), smoothMask, Core.CMP_LT)
            Core.compare(srcFloat, Scalar(148.0), darkMask, Core.CMP_LT)
            Core.bitwise_and(smoothMask, darkMask, seeds)
            Imgproc.dilate(seeds, grown, dilateKernel)
            Core.bitwise_and(grown, darkMask, grown)
            return grown.clone()
        } finally {
            srcFloat.release()
            mean.release()
            sq.release()
            dev.release()
            meanSq.release()
            smoothMask.release()
            darkMask.release()
            seeds.release()
            grown.release()
            dilateKernel.release()
        }
    }

    private fun despeckleMinArea(maxDim: Int): Int {
        val scale = maxDim / 2400.0
        return max(2, (6.0 * scale * scale).roundToInt())
    }

    private fun removeSmallSpecks(binary: Mat, minAreaPx: Int, cleanWhiteInkHoles: Boolean) {
        if (minAreaPx <= 1) return
        val subject = Mat()
        val labels = Mat()
        val stats = Mat()
        val centroids = Mat()
        try {
            if (cleanWhiteInkHoles) {
                binary.copyTo(subject)
            } else {
                Core.bitwise_not(binary, subject)
            }
            val count = Imgproc.connectedComponentsWithStats(subject, labels, stats, centroids, 8, CvType.CV_32S)
            if (count <= 1) return
            val statsData = IntArray(count * 5)
            stats.get(0, 0, statsData)
            val fillVal = Scalar(if (cleanWhiteInkHoles) 0.0 else 255.0)

            for (label in 1 until count) {
                val base = label * 5
                val area = statsData[base + Imgproc.CC_STAT_AREA]
                if (area >= minAreaPx) continue
                val box = Rect(
                    statsData[base + Imgproc.CC_STAT_LEFT],
                    statsData[base + Imgproc.CC_STAT_TOP],
                    statsData[base + Imgproc.CC_STAT_WIDTH],
                    statsData[base + Imgproc.CC_STAT_HEIGHT],
                )
                val subLabel = labels.submat(box)
                val speck = Mat()
                val dstBox = binary.submat(box)
                try {
                    Core.compare(subLabel, Scalar(label.toDouble()), speck, Core.CMP_EQ)
                    dstBox.setTo(fillVal, speck)
                } finally {
                    subLabel.release()
                    speck.release()
                    dstBox.release()
                }
            }
        } finally {
            subject.release()
            labels.release()
            stats.release()
            centroids.release()
        }
    }

    private fun upscaleIfBelowPixels(gray: Mat, targetPixels: Long): Mat {
        val current = gray.cols().toLong() * gray.rows().toLong()
        if (current >= targetPixels || current <= 0L) return gray.clone()
        val scale = sqrt(targetPixels.toDouble() / current.toDouble()).coerceAtMost(2.0)
        val out = Mat()
        Imgproc.resize(
            gray,
            out,
            Size((gray.cols() * scale).roundToInt().toDouble(), (gray.rows() * scale).roundToInt().toDouble()),
            0.0,
            0.0,
            Imgproc.INTER_CUBIC,
        )
        return out
    }

    private fun resizeMaxDim(mat: Mat, maxDimTarget: Double): Mat {
        val m = max(mat.cols(), mat.rows()).toDouble()
        if (m <= maxDimTarget || m <= 0.0) return mat.clone()
        val scale = maxDimTarget / m
        val out = Mat()
        Imgproc.resize(
            mat,
            out,
            Size(max(1, (mat.cols() * scale).roundToInt()).toDouble(), max(1, (mat.rows() * scale).roundToInt()).toDouble()),
            0.0,
            0.0,
            Imgproc.INTER_AREA,
        )
        return out
    }
}
