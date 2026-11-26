package org.intabtools.intabpdf.scanner.imaging

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Bounded LRU bitmap loader keeping rendered previews and filter thumbnails comfortably within
 * a strict heap cap without retaining full-resolution source images simultaneously.
 */
class ScanBitmapLoader(context: Context) {

    private val memoryProfile = DeviceMemoryProfile.forContext(context.applicationContext)
    private val maxPreviewCacheBytes = if (memoryProfile.isConstrained) 5 * 1024 * 1024 else 10 * 1024 * 1024
    private val maxThumbCacheBytes = if (memoryProfile.isConstrained) 1 * 1024 * 1024 else 2 * 1024 * 1024

    private val previewCache = object : LruCache<String, Bitmap>(maxPreviewCacheBytes) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.allocationByteCount.coerceAtLeast(1)
    }

    private val thumbnailCache = object : LruCache<String, Bitmap>(maxThumbCacheBytes) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.allocationByteCount.coerceAtLeast(1)
    }

    fun getCachedDisplayBitmap(cacheKey: String, maxPixels: Long): Bitmap? {
        val targetCache = if (maxPixels <= THUMBNAIL_PIXEL_THRESHOLD) thumbnailCache else previewCache
        return targetCache.get(cacheKey)?.takeIf { !it.isRecycled }
    }

    suspend fun loadDisplayBitmap(
        file: File,
        cacheKey: String,
        maxPixels: Long = if (memoryProfile.isConstrained) 900_000L else 1_400_000L,
    ): Bitmap? = withContext(Dispatchers.IO) {
        val targetCache = if (maxPixels <= THUMBNAIL_PIXEL_THRESHOLD) thumbnailCache else previewCache
        targetCache.get(cacheKey)?.takeIf { !it.isRecycled }?.let { return@withContext it }
        if (!file.exists() || !file.isFile || file.length() <= 0L) return@withContext null

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@withContext null

        val sampleSize = MemoryBudget.calculateInSampleSize(bounds.outWidth, bounds.outHeight, maxPixels)
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val bitmap = BitmapFactory.decodeFile(file.absolutePath, opts) ?: return@withContext null
        targetCache.put(cacheKey, bitmap)
        bitmap
    }

    /**
     * Decodes a source capture once at bounded interactive-editor resolution and rotates it into
     * the page's visible [rotationDegrees] orientation without modifying the source JPEG file.
     */
    suspend fun loadRotatedSourceForCropEditor(
        sourceFile: File,
        rotationDegrees: Int,
        maxPixels: Long = if (memoryProfile.isConstrained) 1_400_000L else 2_400_000L,
    ): Bitmap? = withContext(Dispatchers.IO) {
        if (!sourceFile.exists() || !sourceFile.isFile) return@withContext null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(sourceFile.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@withContext null

        val sampleSize = MemoryBudget.calculateInSampleSize(bounds.outWidth, bounds.outHeight, maxPixels)
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val decoded = BitmapFactory.decodeFile(sourceFile.absolutePath, opts) ?: return@withContext null
        val rot = ImageOrientation.normalizeRotationDegrees(rotationDegrees)
        if (rot == 0) return@withContext decoded

        val matrix = Matrix().apply { postRotate(rot.toFloat()) }
        try {
            Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        } finally {
            decoded.recycle()
        }
    }

    fun evictAll() {
        previewCache.evictAll()
        thumbnailCache.evictAll()
    }

    private companion object {
        const val THUMBNAIL_PIXEL_THRESHOLD = 100_000L
    }
}
