package org.intabtools.intabpdf.scanner.data

import android.content.Context
import android.content.Intent
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import java.io.File

enum class ScanFilter(val wireValue: String) {
    AUTO("auto"),
    ORIGINAL("original"),
    COLOR("color"),
    GRAYSCALE("grayscale"),
    BLACK_AND_WHITE("bw");

    companion object {
        fun fromWireValue(value: String?): ScanFilter {
            val normalized = value?.trim()?.lowercase() ?: return AUTO
            return entries.firstOrNull { it.wireValue == normalized } ?: AUTO
        }
    }
}

enum class ScanQuality(val wireValue: String) {
    LOW("low"),
    BALANCED("balanced"),
    HIGH("high");

    companion object {
        fun fromWireValue(value: String?): ScanQuality {
            val normalized = value?.trim()?.lowercase() ?: return BALANCED
            return entries.firstOrNull { it.wireValue == normalized } ?: BALANCED
        }
    }
}

data class ScannedPageSource(
    val pageId: String,
    val sourceFilePath: String,
    val widthPx: Int,
    val heightPx: Int,
    val detectedQuad: NormalizedQuad?,
    val effectiveQuad: NormalizedQuad,
    val detectionConfidence: Float,
    val detectionRecovered: Boolean,
    val autoCaptured: Boolean,
    val capturedAtMs: Long,
)

data class ScannerLaunchOptions(
    val defaultFilter: ScanFilter = ScanFilter.AUTO,
    val quality: ScanQuality = ScanQuality.BALANCED,
    val autoCaptureDefault: Boolean = true,
    val suggestedFileName: String? = null,
) {
    fun applyToIntent(intent: Intent): Intent = intent.apply {
        putExtra(EXTRA_DEFAULT_FILTER, defaultFilter.wireValue)
        putExtra(EXTRA_QUALITY, quality.wireValue)
        putExtra(EXTRA_AUTO_CAPTURE_DEFAULT, autoCaptureDefault)
        suggestedFileName?.takeIf { it.isNotBlank() }?.let {
            putExtra(EXTRA_SUGGESTED_FILE_NAME, it.trim())
        }
    }

    companion object {
        const val EXTRA_DEFAULT_FILTER = "org.intabtools.intabpdf.scanner.EXTRA_DEFAULT_FILTER"
        const val EXTRA_QUALITY = "org.intabtools.intabpdf.scanner.EXTRA_QUALITY"
        const val EXTRA_AUTO_CAPTURE_DEFAULT = "org.intabtools.intabpdf.scanner.EXTRA_AUTO_CAPTURE_DEFAULT"
        const val EXTRA_SUGGESTED_FILE_NAME = "org.intabtools.intabpdf.scanner.EXTRA_SUGGESTED_FILE_NAME"

        const val EXTRA_PDF_FILE_URL = "org.intabtools.intabpdf.scanner.EXTRA_PDF_FILE_URL"
        const val EXTRA_FILE_NAME = "org.intabtools.intabpdf.scanner.EXTRA_FILE_NAME"
        const val EXTRA_PAGE_COUNT = "org.intabtools.intabpdf.scanner.EXTRA_PAGE_COUNT"
        const val EXTRA_SIZE_BYTES = "org.intabtools.intabpdf.scanner.EXTRA_SIZE_BYTES"
        const val EXTRA_ERROR_CODE = "org.intabtools.intabpdf.scanner.EXTRA_ERROR_CODE"
        const val EXTRA_ERROR_MESSAGE = "org.intabtools.intabpdf.scanner.EXTRA_ERROR_MESSAGE"

        fun fromIntent(intent: Intent?): ScannerLaunchOptions {
            if (intent == null) return ScannerLaunchOptions()
            return ScannerLaunchOptions(
                defaultFilter = ScanFilter.fromWireValue(intent.getStringExtra(EXTRA_DEFAULT_FILTER)),
                quality = ScanQuality.fromWireValue(intent.getStringExtra(EXTRA_QUALITY)),
                autoCaptureDefault = intent.getBooleanExtra(EXTRA_AUTO_CAPTURE_DEFAULT, true),
                suggestedFileName = intent.getStringExtra(EXTRA_SUGGESTED_FILE_NAME)?.takeIf { it.isNotBlank() },
            )
        }
    }
}

object ScannerPaths {
    const val OUTPUT_DIR_NAME = "scanner_outputs"
    const val SESSIONS_DIR_NAME = "scanner_sessions"
    const val SOURCES_SUBDIR_NAME = "sources"
    const val DEFAULT_STALE_AGE_MS = 24L * 60L * 60L * 1000L

    fun outputDir(context: Context): File = File(context.cacheDir, OUTPUT_DIR_NAME)

    fun sessionsDir(context: Context): File = File(context.cacheDir, SESSIONS_DIR_NAME)

    fun sessionDir(context: Context, sessionId: String): File = File(sessionsDir(context), sessionId)

    fun sessionSourcesDir(sessionDir: File): File = File(sessionDir, SOURCES_SUBDIR_NAME)

    fun sourceImageFile(sessionDir: File, pageId: String): File =
        File(sessionSourcesDir(sessionDir), "$pageId.jpg")

    /**
     * Checks that [candidate] resides inside [outputDir] via canonical path comparison
     * so cleanup requests from JavaScript cannot delete files outside scanner outputs.
     */
    fun isOwnedOutputFile(context: Context, candidate: File): Boolean {
        val base = outputDir(context).canonicalFile
        val resolved = candidate.canonicalFile
        val basePrefix = base.path.let { if (it.endsWith(File.separator)) it else it + File.separator }
        return resolved.path.startsWith(basePrefix)
    }

    fun pruneStaleDirectory(dir: File, maxAgeMs: Long = DEFAULT_STALE_AGE_MS, nowMs: Long = System.currentTimeMillis()) {
        if (!dir.exists() || !dir.isDirectory) return
        dir.listFiles()?.forEach { child ->
            if (nowMs - child.lastModified() > maxAgeMs) {
                child.deleteRecursively()
            }
        }
    }
}
