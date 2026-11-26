package org.intabtools.intabpdf.savetodevice

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean

sealed interface SaveToDeviceUiState {
    data object Loading : SaveToDeviceUiState

    data class AwaitingDestination(
        val items: List<SharedFileDescriptor>,
        val isMultiple: Boolean,
        val rejectedCount: Int = 0,
        val truncatedCount: Int = 0,
    ) : SaveToDeviceUiState

    data class Copying(
        val currentIndex: Int,
        val totalCount: Int,
        val currentFileName: String,
        val bytesCopied: Long,
        val totalBytes: Long?,
    ) : SaveToDeviceUiState

    data class Success(
        val savedFiles: List<SavedFileResult>,
        val failedFiles: List<FailedFileResult> = emptyList(),
        val cancelledFiles: List<String> = emptyList(),
        val cleanupFailedCount: Int = 0,
        val totalBytesCopied: Long,
        val rejectedCount: Int = 0,
        val truncatedCount: Int = 0,
    ) : SaveToDeviceUiState

    data class Error(
        val title: String,
        val message: String,
        val canRetryDestination: Boolean,
        val cleanupWarning: String? = null,
    ) : SaveToDeviceUiState

    data object Cancelled : SaveToDeviceUiState
}

/**
 * Coordinates metadata extraction, destination picking deduplication across configuration changes,
 * background streaming copy execution, and cancellation cleanup without tying work to a specific view instance.
 */
class SaveToDeviceCoordinator(
    private val gateway: ShareSaveGateway,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    mainDispatcher: CoroutineDispatcher = Dispatchers.Main,
) {
    private val scope = CoroutineScope(SupervisorJob() + mainDispatcher)
    private val _uiState = MutableStateFlow<SaveToDeviceUiState>(SaveToDeviceUiState.Loading)
    val uiState: StateFlow<SaveToDeviceUiState> = _uiState.asStateFlow()

    private var resolvedItems: List<SharedFileDescriptor> = emptyList()
    private var isMultipleMode: Boolean = false
    private var rejectedInputCount: Int = 0
    private var truncatedInputCount: Int = 0
    private var initialized = false
    var hasLaunchedPicker: Boolean = false
        private set
    private var hasShownCompletionToast: Boolean = false

    private var activeCopyJob: Job? = null
    private val cancelRequested = AtomicBoolean(false)

    fun initializeFromShare(input: ResolvedShareInput, intentMimeType: String?) {
        if (initialized) return
        initialized = true
        rejectedInputCount = input.rejectedCount
        truncatedInputCount = input.truncatedCount

        if (input.uriStrings.isEmpty()) {
            _uiState.value = SaveToDeviceUiState.Error(
                title = "No shared file found",
                message = if (input.rejectedCount > 0) {
                    "The shared item could not be accessed safely. Only Android content shares are supported."
                } else {
                    "The incoming share request did not include any readable files."
                },
                canRetryDestination = false,
            )
            return
        }

        scope.launch {
            try {
                val descriptors = withContext(ioDispatcher) {
                    gateway.resolveDescriptors(input, intentMimeType)
                }
                if (descriptors.isEmpty()) {
                    _uiState.value = SaveToDeviceUiState.Error(
                        title = "File unavailable",
                        message = "Could not inspect the shared file metadata.",
                        canRetryDestination = false,
                    )
                    return@launch
                }
                resolvedItems = descriptors
                isMultipleMode = descriptors.size > 1
                _uiState.value = SaveToDeviceUiState.AwaitingDestination(
                    items = descriptors,
                    isMultiple = isMultipleMode,
                    rejectedCount = rejectedInputCount,
                    truncatedCount = truncatedInputCount,
                )
            } catch (t: Throwable) {
                _uiState.value = SaveToDeviceUiState.Error(
                    title = "Could not open shared file",
                    message = AndroidShareSaveGateway.mapThrowableMessage(t),
                    canRetryDestination = false,
                )
            }
        }
    }

    fun markPickerLaunched() {
        hasLaunchedPicker = true
    }

    fun consumeCompletionToastFlag(): Boolean {
        if (hasShownCompletionToast) return false
        hasShownCompletionToast = true
        return true
    }

    fun onDestinationCancelled() {
        _uiState.value = SaveToDeviceUiState.Cancelled
    }

    fun retryDestinationSelection() {
        if (resolvedItems.isEmpty()) return
        hasLaunchedPicker = false
        _uiState.value = SaveToDeviceUiState.AwaitingDestination(
            items = resolvedItems,
            isMultiple = isMultipleMode,
            rejectedCount = rejectedInputCount,
            truncatedCount = truncatedInputCount,
        )
    }

    fun onSingleDestinationSelected(destUri: Uri) {
        val item = resolvedItems.firstOrNull() ?: return
        activeCopyJob?.cancel()
        cancelRequested.set(false)
        hasShownCompletionToast = false
        activeCopyJob = scope.launch {
            _uiState.value = SaveToDeviceUiState.Copying(
                currentIndex = 1,
                totalCount = 1,
                currentFileName = item.displayName,
                bytesCopied = 0L,
                totalBytes = item.sizeBytes,
            )
            try {
                val copied = withContext(ioDispatcher) {
                    gateway.copySingleToDocumentUri(
                        source = item,
                        destUri = destUri,
                        isCancelled = { cancelRequested.get() || activeCopyJob?.isActive != true },
                        onProgress = { bytes ->
                            _uiState.value = SaveToDeviceUiState.Copying(
                                currentIndex = 1,
                                totalCount = 1,
                                currentFileName = item.displayName,
                                bytesCopied = bytes,
                                totalBytes = item.sizeBytes,
                            )
                        },
                    )
                }
                _uiState.value = SaveToDeviceUiState.Success(
                    savedFiles = listOf(
                        SavedFileResult(
                            sourceUriString = item.uriString,
                            savedFileName = item.displayName,
                            bytesCopied = copied,
                        ),
                    ),
                    totalBytesCopied = copied,
                    rejectedCount = rejectedInputCount,
                    truncatedCount = truncatedInputCount,
                )
            } catch (_: CancellationException) {
                _uiState.value = SaveToDeviceUiState.Cancelled
            } catch (t: Throwable) {
                val unwrapped = (t as? IncompleteCleanupIOException)?.cause ?: t
                val isSourceSecurityError = unwrapped is SecurityException
                val cleanupWarn = if (t is IncompleteCleanupIOException && !t.cleanupSucceeded) {
                    "An incomplete file could not be removed automatically at the destination."
                } else {
                    null
                }
                _uiState.value = SaveToDeviceUiState.Error(
                    title = "Could not save file",
                    message = AndroidShareSaveGateway.mapThrowableMessage(t),
                    canRetryDestination = !isSourceSecurityError,
                    cleanupWarning = cleanupWarn,
                )
            }
        }
    }

    fun onMultipleDestinationTreeSelected(treeUri: Uri) {
        val items = resolvedItems
        if (items.isEmpty()) return
        activeCopyJob?.cancel()
        cancelRequested.set(false)
        hasShownCompletionToast = false
        activeCopyJob = scope.launch {
            _uiState.value = SaveToDeviceUiState.Copying(
                currentIndex = 1,
                totalCount = items.size,
                currentFileName = items.first().displayName,
                bytesCopied = 0L,
                totalBytes = items.first().sizeBytes,
            )
            try {
                val outcome = withContext(ioDispatcher) {
                    gateway.copyMultipleToTreeUri(
                        sources = items,
                        treeUri = treeUri,
                        isCancelled = { cancelRequested.get() || activeCopyJob?.isActive != true },
                        onProgress = { idx, total, name, bytes, totalBytes ->
                            _uiState.value = SaveToDeviceUiState.Copying(
                                currentIndex = idx,
                                totalCount = total,
                                currentFileName = name,
                                bytesCopied = bytes,
                                totalBytes = totalBytes,
                            )
                        },
                    )
                }
                if (outcome.savedFiles.isEmpty() && outcome.failedFiles.isEmpty() && outcome.cancelledFiles.isNotEmpty()) {
                    _uiState.value = SaveToDeviceUiState.Cancelled
                } else if (outcome.savedFiles.isEmpty()) {
                    val firstError = outcome.failedFiles.firstOrNull()?.reason
                        ?: "No files could be written to the selected folder."
                    val cleanupWarn = if (outcome.cleanupFailedCount > 0) {
                        "${outcome.cleanupFailedCount} incomplete file(s) could not be removed automatically."
                    } else {
                        null
                    }
                    _uiState.value = SaveToDeviceUiState.Error(
                        title = "Could not save files",
                        message = firstError,
                        canRetryDestination = true,
                        cleanupWarning = cleanupWarn,
                    )
                } else {
                    val totalBytes = outcome.savedFiles.sumOf { it.bytesCopied }
                    _uiState.value = SaveToDeviceUiState.Success(
                        savedFiles = outcome.savedFiles,
                        failedFiles = outcome.failedFiles,
                        cancelledFiles = outcome.cancelledFiles,
                        cleanupFailedCount = outcome.cleanupFailedCount,
                        totalBytesCopied = totalBytes,
                        rejectedCount = rejectedInputCount,
                        truncatedCount = truncatedInputCount,
                    )
                }
            } catch (_: CancellationException) {
                _uiState.value = SaveToDeviceUiState.Cancelled
            } catch (t: Throwable) {
                val unwrapped = (t as? IncompleteCleanupIOException)?.cause ?: t
                _uiState.value = SaveToDeviceUiState.Error(
                    title = "Could not save files",
                    message = AndroidShareSaveGateway.mapThrowableMessage(t),
                    canRetryDestination = unwrapped !is SecurityException,
                )
            }
        }
    }

    fun cancelActiveCopy() {
        cancelRequested.set(true)
        // For single-file copy, transition straight to Cancelled and let IO cleanup finish deterministically;
        // for multi-file batch copy, allow the loop to stop cleanly and report any already-saved files.
        if (!isMultipleMode) {
            activeCopyJob?.cancel()
            _uiState.value = SaveToDeviceUiState.Cancelled
        }
    }

    fun clear() {
        cancelRequested.set(true)
        activeCopyJob?.cancel()
        scope.cancel()
    }
}

class SaveToDeviceViewModel(application: Application) : AndroidViewModel(application) {
    val coordinator: SaveToDeviceCoordinator = SaveToDeviceCoordinator(
        gateway = AndroidShareSaveGateway(application),
    )

    override fun onCleared() {
        coordinator.clear()
        super.onCleared()
    }

    class Factory(private val application: Application) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return SaveToDeviceViewModel(application) as T
        }
    }
}
