package org.intabtools.intabpdf.scanner.imaging

import android.util.Log
import org.opencv.android.OpenCVLoader

sealed interface OpenCvStatus {
    data object Uninitialized : OpenCvStatus
    data object Ready : OpenCvStatus
    data class Failed(val reason: String) : OpenCvStatus
}

/**
 * Thread-safe, idempotent lazy initializer for the bundled OpenCV Android native runtime.
 */
object OpenCvRuntime {
    private val lock = Any()

    @Volatile
    var status: OpenCvStatus = OpenCvStatus.Uninitialized
        private set

    fun ensureInitialized(): Boolean {
        if (status is OpenCvStatus.Ready) return true
        synchronized(lock) {
            if (status is OpenCvStatus.Ready) return true
            return try {
                val ok = OpenCVLoader.initLocal()
                status = if (ok) {
                    OpenCvStatus.Ready
                } else {
                    Log.e(TAG, "OpenCVLoader.initLocal() returned false")
                    OpenCvStatus.Failed("OpenCV native library initialization failed.")
                }
                ok
            } catch (t: Throwable) {
                Log.e(TAG, "Exception while initializing OpenCV", t)
                status = OpenCvStatus.Failed(t.localizedMessage ?: "OpenCV native library missing.")
                false
            }
        }
    }

    private const val TAG = "InTabOpenCvRuntime"
}
