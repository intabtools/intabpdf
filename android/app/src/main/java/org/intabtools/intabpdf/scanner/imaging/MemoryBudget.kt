package org.intabtools.intabpdf.scanner.imaging

import android.app.ActivityManager
import android.content.Context
import org.intabtools.intabpdf.scanner.data.ScanFilter
import org.intabtools.intabpdf.scanner.data.ScanQuality
import kotlin.math.max
import kotlin.math.sqrt

data class DeviceMemoryProfile(
    val isLowRamDevice: Boolean,
    val memoryClassMb: Int,
) {
    val isConstrained: Boolean
        get() = isLowRamDevice || memoryClassMb <= 192

    fun maxDecodePixels(quality: ScanQuality): Long = when (quality) {
        ScanQuality.LOW -> if (isConstrained) 3_000_000L else 6_000_000L
        ScanQuality.BALANCED -> if (isConstrained) 6_000_000L else 12_000_000L
        ScanQuality.HIGH -> if (isConstrained) 9_000_000L else 16_000_000L
    }

    fun maxRenderedPixels(quality: ScanQuality, filter: ScanFilter): Long {
        val base = when (quality) {
            ScanQuality.LOW -> if (isConstrained) 800_000L else 1_000_000L
            ScanQuality.BALANCED -> if (isConstrained) 1_500_000L else 2_200_000L
            ScanQuality.HIGH -> if (isConstrained) 2_400_000L else 4_200_000L
        }
        return if (filter == ScanFilter.BLACK_AND_WHITE) {
            val multiplier = if (isConstrained) 2L else 3L
            (base * multiplier).coerceAtMost(if (isConstrained) 4_800_000L else 10_000_000L)
        } else {
            base
        }
    }

    companion object {
        fun forContext(context: Context): DeviceMemoryProfile {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            return if (am != null) {
                DeviceMemoryProfile(
                    isLowRamDevice = am.isLowRamDevice,
                    memoryClassMb = am.memoryClass,
                )
            } else {
                DeviceMemoryProfile(isLowRamDevice = false, memoryClassMb = 256)
            }
        }
    }
}

object MemoryBudget {
    /**
     * Computes power-of-two BitmapFactory inSampleSize so decoded source bitmaps remain
     * comfortably within [maxDecodePixels], preventing OOM on 24MP–108MP sensors.
     */
    fun calculateInSampleSize(srcWidth: Int, srcHeight: Int, maxDecodePixels: Long): Int {
        if (srcWidth <= 0 || srcHeight <= 0 || maxDecodePixels <= 0L) return 1
        var sampleSize = 1
        val rawPixels = srcWidth.toLong() * srcHeight.toLong()
        while ((rawPixels / (sampleSize.toLong() * sampleSize.toLong())) > maxDecodePixels && sampleSize < 16) {
            sampleSize *= 2
        }
        return max(1, sampleSize)
    }

    fun scaleToFitMaxPixels(width: Int, height: Int, maxPixels: Long): Pair<Int, Int> {
        if (width <= 0 || height <= 0 || maxPixels <= 0L) return width to height
        val current = width.toLong() * height.toLong()
        if (current <= maxPixels) return width to height
        val factor = sqrt(maxPixels.toDouble() / current.toDouble())
        return max(1, (width * factor).toInt()) to max(1, (height * factor).toInt())
    }
}
