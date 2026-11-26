package org.intabtools.intabpdf.savetodevice

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.CancellationException

/**
 * Streaming file copier using bounded fixed-size buffers so arbitrarily large shared files
 * can be saved without loading their contents into memory.
 */
object StreamFileCopier {

    const val DEFAULT_BUFFER_SIZE_BYTES = 32 * 1024

    @Throws(IOException::class)
    fun copyStream(
        input: InputStream,
        output: OutputStream,
        bufferSizeBytes: Int = DEFAULT_BUFFER_SIZE_BYTES,
        isCancelled: () -> Boolean = { false },
        onProgress: (bytesCopied: Long) -> Unit = {},
    ): Long {
        require(bufferSizeBytes >= 1024) { "Buffer size must be at least 1024 bytes." }
        val buffer = ByteArray(bufferSizeBytes)
        var totalCopied = 0L

        while (true) {
            if (isCancelled()) {
                throw CancellationException("File copy cancelled by user.")
            }
            val read = input.read(buffer)
            if (read == -1) {
                break
            }
            if (read > 0) {
                if (isCancelled()) {
                    throw CancellationException("File copy cancelled by user.")
                }
                output.write(buffer, 0, read)
                totalCopied += read
                onProgress(totalCopied)
            }
        }
        output.flush()
        return totalCopied
    }
}
