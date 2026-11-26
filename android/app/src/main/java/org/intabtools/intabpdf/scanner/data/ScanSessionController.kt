package org.intabtools.intabpdf.scanner.data

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.intabtools.intabpdf.scanner.pdf.PdfExportResult
import org.intabtools.intabpdf.scanner.pdf.PdfScanExporter
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

sealed interface ScannerRoute {
    data object Camera : ScannerRoute
    data object Review : ScannerRoute
    data class CropEditor(val pageId: String) : ScannerRoute
}

data class ScannerSessionUiState(
    val route: ScannerRoute = ScannerRoute.Camera,
    val pages: List<ReversiblePageRecord> = emptyList(),
    val selectedPageIndex: Int = 0,
    val retakeTargetPageId: String? = null,
    val applyFilterToAll: Boolean = false,
    val renderedFiles: Map<String, RenderedPageResult> = emptyMap(),
    val renderingPageIds: Set<String> = emptySet(),
    val filterThumbnails: Map<ScanFilter, File> = emptyMap(),
    val thumbnailCacheKey: String? = null,
    val isLoadingThumbnails: Boolean = false,
    val isImportingGallery: Boolean = false,
    val isExportingPdf: Boolean = false,
    val exportProgressCompleted: Int = 0,
    val exportProgressTotal: Int = 0,
    val exportErrorMessage: String? = null,
    val completedExport: PdfExportResult? = null,
    val completedExportAction: PostExportAction = PostExportAction.SAVE,
    val statusMessage: String? = null,
) {
    val selectedPage: ReversiblePageRecord?
        get() = pages.getOrNull(selectedPageIndex)
}

/**
 * Coordinates the multi-page scanner session across Camera, Review, Filter selection, Gallery
 * import, Crop Editor, PDF export, and Activity state restoration.
 */
class ScanSessionController(
    context: Context,
    val captureStore: StillCaptureStore,
    val pipeline: NonDestructivePagePipeline = NonDestructivePagePipeline(context.applicationContext, captureStore.sessionId),
    private val launchOptions: ScannerLaunchOptions = ScannerLaunchOptions(),
    private val pdfExporter: PdfScanExporter = PdfScanExporter(context.applicationContext),
    mainDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
) {
    private val scope = CoroutineScope(SupervisorJob() + mainDispatcher)
    private val _uiState = MutableStateFlow(ScannerSessionUiState())
    val uiState: StateFlow<ScannerSessionUiState> = _uiState.asStateFlow()

    private val mutationQueue = Channel<suspend () -> Unit>(Channel.UNLIMITED)
    private val renderJobs = ConcurrentHashMap<String, Job>()
    private val renderTokens = ConcurrentHashMap<String, AtomicLong>()
    private var thumbnailJob: Job? = null
    private val thumbnailToken = AtomicLong(0L)
    private var galleryImportJob: Job? = null
    private val galleryImportToken = AtomicLong(0L)
    private var exportJob: Job? = null
    private var lastRequestedExportAction: PostExportAction = PostExportAction.SAVE

    init {
        scope.launch {
            for (action in mutationQueue) {
                runCatching { action() }.onFailure { err ->
                    if (err is kotlinx.coroutines.CancellationException) throw err
                    _uiState.update { it.copy(statusMessage = err.localizedMessage ?: "Scanner session error.") }
                }
            }
        }
    }

    private fun enqueueMutation(block: suspend () -> Unit) {
        mutationQueue.trySend(block)
    }

    fun restoreFromDisk(
        routeName: String?,
        cropPageId: String?,
        selectedPageIndex: Int,
        applyFilterToAll: Boolean,
        retakeTargetPageId: String?,
    ) {
        enqueueMutation {
            val sources = captureStore.restoreFromDisk()
            if (sources.isEmpty()) return@enqueueMutation

            val restoredPages = pipeline.restoreFromSources(sources, launchOptions.defaultFilter)
            if (restoredPages.isEmpty()) return@enqueueMutation

            val clampedIndex = selectedPageIndex.coerceIn(0, restoredPages.lastIndex)
            val resolvedRoute = when (routeName) {
                "crop" -> {
                    val targetCropId = cropPageId?.takeIf { id -> restoredPages.any { it.pageId == id } }
                    if (targetCropId != null) ScannerRoute.CropEditor(targetCropId) else ScannerRoute.Review
                }
                "review" -> ScannerRoute.Review
                else -> ScannerRoute.Camera
            }
            val validRetakeId = retakeTargetPageId?.takeIf { id -> restoredPages.any { it.pageId == id } }

            _uiState.update { state ->
                state.copy(
                    route = resolvedRoute,
                    pages = restoredPages,
                    selectedPageIndex = clampedIndex,
                    applyFilterToAll = applyFilterToAll,
                    retakeTargetPageId = validRetakeId,
                )
            }
            if (resolvedRoute is ScannerRoute.Review) {
                refreshReviewAssetsForCurrentSelection()
            }
        }
    }

    fun clearStatusMessage() {
        enqueueMutation {
            _uiState.update { it.copy(statusMessage = null) }
        }
    }

    fun dismissExportError() {
        enqueueMutation {
            _uiState.update { it.copy(exportErrorMessage = null) }
        }
    }

    fun setStatusMessage(message: String?) {
        enqueueMutation {
            _uiState.update { it.copy(statusMessage = message) }
        }
    }

    fun consumeCompletedExport() {
        enqueueMutation {
            _uiState.update { it.copy(completedExport = null) }
        }
    }

    fun onCameraPageCaptured(source: ScannedPageSource, replacedPageId: String?) {
        enqueueMutation {
            val existingPagesBefore = pipeline.orderedRecords()
            val shouldInheritGlobalFilter = _uiState.value.applyFilterToAll && existingPagesBefore.isNotEmpty()
            val filterForNewPage = if (shouldInheritGlobalFilter) {
                existingPagesBefore.first().selectedFilter
            } else {
                launchOptions.defaultFilter
            }

            val record = pipeline.registerCapturedPage(
                source = source,
                defaultFilter = filterForNewPage,
                replacePageId = replacedPageId,
            )
            val updated = pipeline.orderedRecords()
            val targetIdx = updated.indexOfFirst { it.pageId == record.pageId }.coerceAtLeast(0)

            if (replacedPageId != null) {
                cancelRenderForPage(replacedPageId)
                cancelRenderForPage(record.pageId)
                _uiState.update { state ->
                    state.copy(
                        route = ScannerRoute.Review,
                        pages = updated,
                        selectedPageIndex = targetIdx,
                        retakeTargetPageId = null,
                        renderedFiles = state.renderedFiles - replacedPageId - record.pageId,
                        filterThumbnails = emptyMap(),
                        thumbnailCacheKey = null,
                        statusMessage = "Page ${targetIdx + 1} updated",
                    )
                }
                refreshReviewAssetsForCurrentSelection()
            } else {
                _uiState.update { state ->
                    state.copy(
                        pages = updated,
                        selectedPageIndex = targetIdx,
                    )
                }
            }
        }
    }

    fun importGalleryUris(uris: List<Uri>) {
        val uniqueUris = uris.distinct()
        if (uniqueUris.isEmpty()) return
        val token = galleryImportToken.incrementAndGet()
        galleryImportJob?.cancel()
        // Transition off Camera synchronously before Activity.onResume() so CameraX will not rebind
        _uiState.update {
            it.copy(
                route = ScannerRoute.Review,
                isImportingGallery = true,
                statusMessage = null,
            )
        }
        galleryImportJob = scope.launch {
            enqueueMutation {
                if (galleryImportToken.get() != token) return@enqueueMutation
                cancelBackgroundWork()
                _uiState.update {
                    it.copy(
                        route = ScannerRoute.Review,
                        isImportingGallery = true,
                        statusMessage = null,
                    )
                }
            }
            try {
                val summary = captureStore.importFromGalleryUris(uniqueUris)
                enqueueMutation {
                    if (galleryImportToken.get() != token) return@enqueueMutation
                    val existingBefore = pipeline.orderedRecords()
                    val inheritFilter = if (_uiState.value.applyFilterToAll && existingBefore.isNotEmpty()) {
                        existingBefore.first().selectedFilter
                    } else {
                        launchOptions.defaultFilter
                    }

                    var firstImportedId: String? = null
                    for (source in summary.imported) {
                        val rec = pipeline.registerCapturedPage(source = source, defaultFilter = inheritFilter)
                        if (firstImportedId == null) firstImportedId = rec.pageId
                    }

                    val updated = pipeline.orderedRecords()
                    val nextIndex = firstImportedId?.let { id ->
                        updated.indexOfFirst { it.pageId == id }
                    }?.takeIf { it >= 0 } ?: updated.lastIndex.coerceAtLeast(0)

                    val msg = when {
                        summary.imported.isEmpty() && summary.failedCount > 0 ->
                            "Could not import selected image(s)."
                        summary.failedCount > 0 ->
                            "Imported ${summary.imported.size} image(s); ${summary.failedCount} skipped."
                        summary.imported.size == 1 ->
                            "Imported 1 image."
                        else ->
                            "Imported ${summary.imported.size} images."
                    }

                    _uiState.update { state ->
                        state.copy(
                            route = if (updated.isNotEmpty()) ScannerRoute.Review else state.route,
                            pages = updated,
                            selectedPageIndex = nextIndex,
                            isImportingGallery = false,
                            statusMessage = msg,
                        )
                    }
                    if (updated.isNotEmpty()) {
                        refreshReviewAssetsForCurrentSelection()
                    }
                }
            } catch (ex: Exception) {
                if (ex is kotlinx.coroutines.CancellationException) throw ex
                enqueueMutation {
                    if (galleryImportToken.get() != token) return@enqueueMutation
                    _uiState.update {
                        it.copy(
                            isImportingGallery = false,
                            statusMessage = ex.localizedMessage ?: "Gallery import failed.",
                        )
                    }
                }
            }
        }
    }

    fun openReview() {
        enqueueMutation {
            _uiState.update { state ->
                val clampedIdx = if (state.pages.isEmpty()) 0 else state.selectedPageIndex.coerceIn(0, state.pages.lastIndex)
                state.copy(
                    route = ScannerRoute.Review,
                    selectedPageIndex = clampedIdx,
                    retakeTargetPageId = null,
                )
            }
            refreshReviewAssetsForCurrentSelection()
        }
    }

    fun openCameraForAddMore() {
        enqueueMutation {
            cancelBackgroundWork()
            _uiState.update { it.copy(route = ScannerRoute.Camera, retakeTargetPageId = null) }
        }
    }

    fun beginRetakePage(pageId: String) {
        enqueueMutation {
            cancelBackgroundWork()
            _uiState.update { it.copy(route = ScannerRoute.Camera, retakeTargetPageId = pageId) }
        }
    }

    fun openCropEditor(pageId: String) {
        enqueueMutation {
            if (_uiState.value.pages.none { it.pageId == pageId }) return@enqueueMutation
            _uiState.update { it.copy(route = ScannerRoute.CropEditor(pageId)) }
        }
    }

    fun closeCropEditorToReview() {
        enqueueMutation {
            _uiState.update { it.copy(route = ScannerRoute.Review) }
            refreshReviewAssetsForCurrentSelection()
        }
    }

    fun selectPage(index: Int) {
        enqueueMutation {
            val pages = _uiState.value.pages
            if (pages.isEmpty()) return@enqueueMutation
            val clamped = index.coerceIn(0, pages.lastIndex)
            if (_uiState.value.selectedPageIndex == clamped && _uiState.value.route is ScannerRoute.Review) return@enqueueMutation
            _uiState.update { it.copy(selectedPageIndex = clamped) }
            refreshReviewAssetsForCurrentSelection()
        }
    }

    fun moveSelectedPage(delta: Int) {
        enqueueMutation {
            val currentState = _uiState.value
            val from = currentState.selectedPageIndex
            val to = from + delta
            if (from !in currentState.pages.indices || to !in currentState.pages.indices) return@enqueueMutation
            val reordered = pipeline.movePage(from, to)
            captureStore.reorderPages(reordered.map { it.pageId })
            _uiState.update { state ->
                state.copy(
                    pages = reordered,
                    selectedPageIndex = to.coerceIn(0, reordered.lastIndex.coerceAtLeast(0)),
                )
            }
        }
    }

    fun deletePage(pageId: String) {
        enqueueMutation {
            cancelRenderForPage(pageId)
            pipeline.deletePage(pageId)
            captureStore.deletePage(pageId)
            val updated = pipeline.orderedRecords()
            val currentIdx = _uiState.value.selectedPageIndex
            val nextIdx = if (updated.isEmpty()) 0 else currentIdx.coerceIn(0, updated.lastIndex)
            val deletingActiveThumbs = _uiState.value.thumbnailCacheKey?.startsWith("${pageId}_") == true
            _uiState.update { state ->
                state.copy(
                    pages = updated,
                    selectedPageIndex = nextIdx,
                    renderedFiles = state.renderedFiles - pageId,
                    renderingPageIds = state.renderingPageIds - pageId,
                    filterThumbnails = if (deletingActiveThumbs) emptyMap() else state.filterThumbnails,
                    thumbnailCacheKey = if (deletingActiveThumbs) null else state.thumbnailCacheKey,
                    statusMessage = if (updated.isEmpty()) "All pages removed" else "Page deleted",
                )
            }
            if (updated.isNotEmpty() && _uiState.value.route is ScannerRoute.Review) {
                refreshReviewAssetsForCurrentSelection()
            }
        }
    }

    fun rotateSelectedPage(deltaDegrees: Int = 90) {
        enqueueMutation {
            val selected = _uiState.value.selectedPage ?: return@enqueueMutation
            val pageId = selected.pageId
            cancelRenderForPage(pageId)
            pipeline.rotatePage(pageId, deltaDegrees)
            val updated = pipeline.orderedRecords()
            _uiState.update { state ->
                state.copy(
                    pages = updated,
                    renderedFiles = state.renderedFiles - pageId,
                    filterThumbnails = emptyMap(),
                    thumbnailCacheKey = null,
                )
            }
            refreshReviewAssetsForCurrentSelection()
        }
    }

    fun applyCropQuad(pageId: String, newSourceQuad: NormalizedQuad) {
        enqueueMutation {
            cancelRenderForPage(pageId)
            pipeline.updateCropQuad(pageId, newSourceQuad)
            val updated = pipeline.orderedRecords()
            val idx = updated.indexOfFirst { it.pageId == pageId }.coerceAtLeast(0)
            _uiState.update { state ->
                state.copy(
                    route = ScannerRoute.Review,
                    pages = updated,
                    selectedPageIndex = idx,
                    renderedFiles = state.renderedFiles - pageId,
                    filterThumbnails = emptyMap(),
                    thumbnailCacheKey = null,
                    statusMessage = "Crop updated",
                )
            }
            refreshReviewAssetsForCurrentSelection()
        }
    }

    fun setApplyFilterToAll(enabled: Boolean) {
        enqueueMutation {
            if (!enabled) {
                _uiState.update { it.copy(applyFilterToAll = false) }
                return@enqueueMutation
            }
            val selectedFilter = _uiState.value.selectedPage?.selectedFilter ?: launchOptions.defaultFilter
            _uiState.update { it.copy(applyFilterToAll = true) }
            applyFilterInternal(selectedFilter)
        }
    }

    fun selectFilter(filter: ScanFilter) {
        enqueueMutation {
            applyFilterInternal(filter)
        }
    }

    fun exportPdf(
        availableSpaceOverrideBytes: Long? = null,
        action: PostExportAction = PostExportAction.SAVE,
    ) {
        enqueueMutation {
            val state = _uiState.value
            if (state.isExportingPdf || state.completedExport != null) return@enqueueMutation
            lastRequestedExportAction = action
            val pagesSnapshot = pipeline.orderedRecords()
            if (pagesSnapshot.isEmpty()) {
                _uiState.update {
                    it.copy(exportErrorMessage = "Capture or import at least one page before saving a PDF.")
                }
                return@enqueueMutation
            }

            cancelBackgroundWork()
            _uiState.update {
                it.copy(
                    isExportingPdf = true,
                    exportProgressCompleted = 0,
                    exportProgressTotal = pagesSnapshot.size,
                    exportErrorMessage = null,
                    statusMessage = null,
                )
            }

            exportJob = scope.launch {
                try {
                    val result = pdfExporter.exportSessionToPdf(
                        pages = pagesSnapshot,
                        pipeline = pipeline,
                        quality = launchOptions.quality,
                        suggestedFileName = launchOptions.suggestedFileName,
                        availableSpaceOverrideBytes = availableSpaceOverrideBytes,
                        onProgress = { done, total ->
                            _uiState.update {
                                it.copy(
                                    exportProgressCompleted = done,
                                    exportProgressTotal = total,
                                )
                            }
                        },
                    )
                    _uiState.update {
                        it.copy(
                            isExportingPdf = false,
                            completedExport = result,
                            completedExportAction = action,
                        )
                    }
                } catch (ex: Exception) {
                    if (ex is kotlinx.coroutines.CancellationException) {
                        _uiState.update { it.copy(isExportingPdf = false) }
                        throw ex
                    }
                    _uiState.update {
                        it.copy(
                            isExportingPdf = false,
                            exportErrorMessage = ex.localizedMessage ?: "Failed to generate PDF.",
                        )
                    }
                }
            }
        }
    }

    fun retryLastExport() {
        exportPdf(action = lastRequestedExportAction)
    }

    fun cancelPdfExport() {
        exportJob?.cancel()
        exportJob = null
        enqueueMutation {
            _uiState.update { it.copy(isExportingPdf = false) }
            if (_uiState.value.route is ScannerRoute.Review) {
                refreshReviewAssetsForCurrentSelection()
            }
        }
    }

    private suspend fun applyFilterInternal(filter: ScanFilter) {
        val currentState = _uiState.value
        val selected = currentState.selectedPage ?: return
        if (currentState.applyFilterToAll) {
            val changedIds = currentState.pages.filter { it.selectedFilter != filter }.map { it.pageId }
            changedIds.forEach(::cancelRenderForPage)
            val updated = pipeline.applyFilterToAll(filter)
            _uiState.update { state ->
                state.copy(
                    pages = updated,
                    renderedFiles = state.renderedFiles - changedIds.toSet(),
                )
            }
        } else {
            if (selected.selectedFilter == filter && currentState.renderedFiles.containsKey(selected.pageId)) {
                return
            }
            cancelRenderForPage(selected.pageId)
            pipeline.setFilter(selected.pageId, filter)
            val updated = pipeline.orderedRecords()
            _uiState.update { state ->
                state.copy(
                    pages = updated,
                    renderedFiles = state.renderedFiles - selected.pageId,
                )
            }
        }
        refreshReviewAssetsForCurrentSelection(regenerateThumbs = false)
    }

    private fun refreshReviewAssetsForCurrentSelection(regenerateThumbs: Boolean = true) {
        val state = _uiState.value
        if (state.route !is ScannerRoute.Review || state.isExportingPdf) return
        val pages = state.pages
        if (pages.isEmpty()) return
        val selectedIdx = state.selectedPageIndex.coerceIn(0, pages.lastIndex)
        val selected = pages[selectedIdx]

        val priorityIndices = listOf(selectedIdx, selectedIdx + 1, selectedIdx - 1)
            .distinct()
            .filter { it in pages.indices }
        val remainingIndices = pages.indices.filter { it !in priorityIndices }

        for (idx in priorityIndices) {
            ensureRendered(pages[idx])
        }
        for (idx in remainingIndices) {
            ensureRendered(pages[idx])
        }

        if (regenerateThumbs) {
            ensureFilterThumbnails(selected)
        }
    }

    private fun ensureRendered(record: ReversiblePageRecord) {
        val cachedOnDisk = pipeline.findCachedRender(record, launchOptions.quality)
        if (cachedOnDisk != null) {
            _uiState.update { state ->
                val currentRecord = state.pages.firstOrNull { it.pageId == record.pageId }
                if (currentRecord == record) {
                    state.copy(
                        renderedFiles = state.renderedFiles + (record.pageId to cachedOnDisk),
                        renderingPageIds = state.renderingPageIds - record.pageId,
                    )
                } else state
            }
            return
        }

        if (renderJobs[record.pageId]?.isActive == true &&
            _uiState.value.pages.firstOrNull { it.pageId == record.pageId } == record
        ) {
            return
        }

        cancelRenderForPage(record.pageId)
        val token = renderTokens.getOrPut(record.pageId) { AtomicLong(0L) }.incrementAndGet()

        _uiState.update { it.copy(renderingPageIds = it.renderingPageIds + record.pageId) }

        val job = scope.launch {
            try {
                val result = pipeline.renderPage(record.pageId, launchOptions.quality)
                _uiState.update { state ->
                    val latestRecord = state.pages.firstOrNull { it.pageId == record.pageId }
                    val latestToken = renderTokens[record.pageId]?.get()
                    if (latestToken == token && latestRecord == record) {
                        state.copy(
                            renderedFiles = state.renderedFiles + (record.pageId to result),
                            renderingPageIds = state.renderingPageIds - record.pageId,
                        )
                    } else {
                        state.copy(renderingPageIds = state.renderingPageIds - record.pageId)
                    }
                }
            } catch (ex: Exception) {
                if (ex is kotlinx.coroutines.CancellationException) throw ex
                _uiState.update { state ->
                    state.copy(
                        renderingPageIds = state.renderingPageIds - record.pageId,
                        statusMessage = ex.localizedMessage ?: "Failed to render page preview.",
                    )
                }
            }
        }
        renderJobs[record.pageId] = job
    }

    private fun ensureFilterThumbnails(record: ReversiblePageRecord) {
        val expectedKey = "${record.pageId}_v${record.quadVersion}_r${record.rotationDegrees}"
        val currentState = _uiState.value
        if (currentState.thumbnailCacheKey == expectedKey &&
            currentState.filterThumbnails.size == ScanFilter.entries.size
        ) {
            return
        }

        pipeline.findCachedFilterThumbnails(record)?.let { cachedThumbs ->
            _uiState.update { state ->
                if (state.selectedPage?.pageId == record.pageId &&
                    state.selectedPage?.quadVersion == record.quadVersion &&
                    state.selectedPage?.rotationDegrees == record.rotationDegrees
                ) {
                    state.copy(
                        filterThumbnails = cachedThumbs,
                        thumbnailCacheKey = expectedKey,
                        isLoadingThumbnails = false,
                    )
                } else state
            }
            return
        }

        thumbnailJob?.cancel()
        val token = thumbnailToken.incrementAndGet()
        _uiState.update {
            it.copy(
                isLoadingThumbnails = true,
                filterThumbnails = if (it.thumbnailCacheKey?.startsWith("${record.pageId}_") == true) {
                    it.filterThumbnails
                } else {
                    emptyMap()
                },
            )
        }

        thumbnailJob = scope.launch {
            try {
                val thumbs = pipeline.generateFilterThumbnails(record.pageId)
                _uiState.update { state ->
                    val active = state.selectedPage
                    val matchesActive = active != null &&
                        active.pageId == record.pageId &&
                        active.quadVersion == record.quadVersion &&
                        active.rotationDegrees == record.rotationDegrees
                    if (thumbnailToken.get() == token && matchesActive) {
                        state.copy(
                            filterThumbnails = thumbs,
                            thumbnailCacheKey = expectedKey,
                            isLoadingThumbnails = false,
                        )
                    } else {
                        state.copy(isLoadingThumbnails = false)
                    }
                }
            } catch (ex: Exception) {
                if (ex is kotlinx.coroutines.CancellationException) throw ex
                _uiState.update { it.copy(isLoadingThumbnails = false) }
            }
        }
    }

    private fun cancelRenderForPage(pageId: String) {
        renderTokens.getOrPut(pageId) { AtomicLong(0L) }.incrementAndGet()
        renderJobs.remove(pageId)?.cancel()
    }

    private fun cancelBackgroundWork() {
        thumbnailToken.incrementAndGet()
        thumbnailJob?.cancel()
        thumbnailJob = null
        renderJobs.keys.toList().forEach(::cancelRenderForPage)
    }

    fun shutdown() {
        mutationQueue.close()
        cancelBackgroundWork()
        galleryImportJob?.cancel()
        exportJob?.cancel()
        scope.cancel()
    }
}
