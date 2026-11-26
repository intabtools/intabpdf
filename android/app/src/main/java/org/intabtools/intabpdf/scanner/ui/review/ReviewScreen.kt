package org.intabtools.intabpdf.scanner.ui.review

import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.intabtools.intabpdf.scanner.data.ReversiblePageRecord
import org.intabtools.intabpdf.scanner.data.ScanFilter
import org.intabtools.intabpdf.scanner.data.ScannerSessionUiState
import org.intabtools.intabpdf.scanner.imaging.ScanBitmapLoader
import org.intabtools.intabpdf.scanner.ui.theme.InTabColors

data class SaveConflictPrompt(
    val destUriString: String,
    val existingFileName: String,
    val suggestedFileName: String,
    val replaceDisabledReason: String? = null,
)

@Composable
fun ReviewScreen(
    uiState: ScannerSessionUiState,
    bitmapLoader: ScanBitmapLoader,
    onAddFromCamera: () -> Unit,
    onImportGallery: () -> Unit,
    onSelectPage: (Int) -> Unit,
    onMoveSelectedLeft: () -> Unit,
    onMoveSelectedRight: () -> Unit,
    onRotateSelected: () -> Unit,
    onCropPage: (String) -> Unit,
    onRetakePage: (String) -> Unit,
    onDeletePage: (String) -> Unit,
    onToggleApplyFilterToAll: (Boolean) -> Unit,
    onSelectFilter: (ScanFilter) -> Unit,
    onExportPdf: () -> Unit,
    onCancelExport: () -> Unit,
    onDismissExportError: () -> Unit,
    onCloseSession: () -> Unit,
    modifier: Modifier = Modifier,
    onSharePdf: () -> Unit = {},
    onRetryExport: () -> Unit = onExportPdf,
    isSavingToSaf: Boolean = false,
    saveErrorMessage: String? = null,
    onDismissSaveError: () -> Unit = {},
    conflictPrompt: SaveConflictPrompt? = null,
    onConflictSaveAsNewCopy: () -> Unit = {},
    onConflictReplace: () -> Unit = {},
    onConflictCancel: () -> Unit = {},
    onDismissStatusMessage: () -> Unit = {},
) {
    val isBusyExportOrSave = uiState.isExportingPdf || isSavingToSaf
    var showOverflowMenu by remember { mutableStateOf(false) }
    var showAddPageChooser by remember { mutableStateOf(false) }
    var pendingDeletePageId by remember { mutableStateOf<String?>(null) }

    val latestDismissStatusMessage by rememberUpdatedState(onDismissStatusMessage)
    LaunchedEffect(uiState.statusMessage) {
        if (uiState.statusMessage != null) {
            delay(2800L)
            latestDismissStatusMessage()
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(InTabColors.DarkBackground)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Top Header Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 6.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = onCloseSession,
                    enabled = !isBusyExportOrSave,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                    modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 36.dp),
                ) {
                    Text(
                        text = "Close",
                        color = InTabColors.DarkTextMuted,
                        maxLines = 1,
                        softWrap = false,
                    )
                }

                Text(
                    text = if (uiState.pages.isEmpty()) {
                        "Review Pages"
                    } else {
                        "Page ${uiState.selectedPageIndex + 1} of ${uiState.pages.size}"
                    },
                    color = InTabColors.DarkText,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    softWrap = false,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 4.dp),
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    if (uiState.pages.isNotEmpty()) {
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = InTabColors.BrandIndigoLight,
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .semantics(mergeDescendants = true) {
                                    contentDescription = "Save PDF"
                                }
                                .clickable(
                                    enabled = !isBusyExportOrSave && !uiState.isImportingGallery,
                                    onClick = onExportPdf,
                                ),
                        ) {
                            Text(
                                text = "Save PDF",
                                color = Color.White,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                softWrap = false,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                            )
                        }

                        Box {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .testTag("review_more_options")
                                    .semantics(mergeDescendants = true) {
                                        contentDescription = "More options"
                                    }
                                    .clickable(
                                        enabled = !isBusyExportOrSave && !uiState.isImportingGallery,
                                        onClick = { showOverflowMenu = true },
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                MoreVertIcon(
                                    tint = InTabColors.DarkText,
                                    modifier = Modifier.size(18.dp),
                                )
                            }

                            DropdownMenu(
                                expanded = showOverflowMenu,
                                onDismissRequest = { showOverflowMenu = false },
                                modifier = Modifier.background(InTabColors.DarkSurface),
                            ) {
                                DropdownMenuItem(
                                    text = {
                                        Text(
                                            text = "Share",
                                            color = InTabColors.DarkText,
                                            style = MaterialTheme.typography.bodyMedium,
                                        )
                                    },
                                    enabled = !isBusyExportOrSave && !uiState.isImportingGallery,
                                    onClick = {
                                        showOverflowMenu = false
                                        onSharePdf()
                                    },
                                    modifier = Modifier
                                        .testTag("review_menu_share")
                                        .semantics { contentDescription = "Share" },
                                )
                            }
                        }
                    }
                }
            }

            if (uiState.pages.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .padding(24.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (uiState.isImportingGallery) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = InTabColors.BrandIndigoSoftText)
                            Spacer(modifier = Modifier.height(14.dp))
                            Text(
                                text = "Importing gallery image(s)…",
                                color = InTabColors.DarkText,
                                style = MaterialTheme.typography.titleSmall,
                                textAlign = TextAlign.Center,
                            )
                        }
                    } else {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = "No pages in this scan yet",
                                color = InTabColors.DarkText,
                                style = MaterialTheme.typography.titleMedium,
                                textAlign = TextAlign.Center,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "Capture a document page with the camera or import photos from your gallery.",
                                color = InTabColors.DarkTextMuted,
                                style = MaterialTheme.typography.bodySmall,
                                textAlign = TextAlign.Center,
                            )
                            Spacer(modifier = Modifier.height(20.dp))
                            Button(
                                onClick = onAddFromCamera,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("Scan with Camera")
                            }
                            Spacer(modifier = Modifier.height(10.dp))
                            OutlinedButton(
                                onClick = onImportGallery,
                                enabled = !uiState.isImportingGallery,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("Import from Gallery")
                            }
                        }
                    }
                }
                return@Box
            }

            val pagerState = rememberPagerState(
                initialPage = uiState.selectedPageIndex.coerceIn(0, uiState.pages.lastIndex),
                pageCount = { uiState.pages.size },
            )
            val latestSelectedIndex by rememberUpdatedState(uiState.selectedPageIndex)
            val latestPageCount by rememberUpdatedState(uiState.pages.size)
            var pendingProgrammaticPage by remember { mutableStateOf<Int?>(null) }

            LaunchedEffect(pagerState) {
                snapshotFlow { pagerState.settledPage }
                    .collect { settled ->
                        val count = latestPageCount
                        if (count > 0 && pendingProgrammaticPage == null && !pagerState.isScrollInProgress) {
                            val clamped = settled.coerceIn(0, count - 1)
                            if (clamped != latestSelectedIndex && pagerState.currentPage == pagerState.targetPage) {
                                onSelectPage(clamped)
                            }
                        }
                    }
            }

            LaunchedEffect(uiState.selectedPageIndex, uiState.pages.size) {
                val target = uiState.selectedPageIndex.coerceIn(0, uiState.pages.lastIndex)
                if (pagerState.currentPage != target) {
                    pendingProgrammaticPage = target
                    try {
                        pagerState.scrollToPage(target)
                    } finally {
                        pendingProgrammaticPage = null
                    }
                }
            }

            // 1. Large Main Perspective-Corrected Page Preview
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .background(Color.Black)
                    .testTag("review_main_preview"),
            ) {
                HorizontalPager(
                    state = pagerState,
                    key = { index -> uiState.pages.getOrNull(index)?.pageId ?: index },
                    modifier = Modifier.fillMaxSize(),
                ) { pageIndex ->
                    val page = uiState.pages.getOrNull(pageIndex) ?: return@HorizontalPager
                    PagePreviewCanvas(
                        page = page,
                        renderedResultFile = uiState.renderedFiles[page.pageId]?.outputFile,
                        isRendering = uiState.renderingPageIds.contains(page.pageId),
                        bitmapLoader = bitmapLoader,
                    )
                }

                if (uiState.isImportingGallery) {
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = InTabColors.DarkSurface.copy(alpha = 0.92f),
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .padding(top = 12.dp),
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                            Text("Importing gallery image(s)…", color = InTabColors.DarkText, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }

                if (uiState.exportErrorMessage != null || saveErrorMessage != null) {
                    val isSaveError = saveErrorMessage != null
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = InTabColors.DarkSurface,
                        border = BorderStroke(1.dp, InTabColors.DangerDark),
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .fillMaxWidth()
                            .padding(12.dp),
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                text = if (isSaveError) "Could not save PDF" else "Could not create PDF",
                                color = InTabColors.DangerDark,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = saveErrorMessage ?: uiState.exportErrorMessage.orEmpty(),
                                color = InTabColors.DarkText,
                                style = MaterialTheme.typography.bodySmall,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End,
                            ) {
                                TextButton(
                                    onClick = {
                                        if (isSaveError) onDismissSaveError() else onDismissExportError()
                                    },
                                ) {
                                    Text("Dismiss")
                                }
                                TextButton(
                                    onClick = {
                                        if (isSaveError) onDismissSaveError()
                                        onRetryExport()
                                    },
                                ) {
                                    Text("Retry")
                                }
                            }
                        }
                    }
                }

                val statusMessage = uiState.statusMessage
                if (statusMessage != null) {
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = InTabColors.DarkSurface.copy(alpha = 0.92f),
                        border = BorderStroke(1.dp, InTabColors.DarkBorder),
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(horizontal = 16.dp, vertical = 10.dp)
                            .testTag("review_status_banner"),
                    ) {
                        Text(
                            text = statusMessage,
                            color = InTabColors.DarkText,
                            style = MaterialTheme.typography.labelMedium,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                        )
                    }
                }
            }

            // 2. Compact Filter Selector & Scope
            val activePage = uiState.selectedPage
            if (activePage != null) {
                FilterStripBar(
                    selectedFilter = activePage.selectedFilter,
                    applyToAll = uiState.applyFilterToAll,
                    pageCount = uiState.pages.size,
                    onToggleApplyToAll = onToggleApplyFilterToAll,
                    onSelectFilter = onSelectFilter,
                    modifier = Modifier.testTag("review_filter_selector"),
                )
                HorizontalDivider(color = InTabColors.DarkBorder, thickness = 1.dp)
            }

            // 3. Compact Page-Thumbnail Strip + Add Page Tile
            PageThumbnailStrip(
                pages = uiState.pages,
                selectedIndex = uiState.selectedPageIndex,
                renderedFiles = uiState.renderedFiles,
                bitmapLoader = bitmapLoader,
                canAddPage = !isBusyExportOrSave && !uiState.isImportingGallery,
                onSelectPage = onSelectPage,
                onMoveLeft = onMoveSelectedLeft,
                onMoveRight = onMoveSelectedRight,
                onOpenAddPage = { showAddPageChooser = true },
                modifier = Modifier.testTag("review_thumbnail_strip"),
            )

            // 4. Compact Editing Toolbar (icon-above-label, borderless)
            if (activePage != null) {
                HorizontalDivider(color = InTabColors.DarkBorder, thickness = 1.dp)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(InTabColors.DarkSurface)
                        .padding(horizontal = 4.dp, vertical = 4.dp)
                        .testTag("review_edit_toolbar"),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ReviewToolbarAction(
                        label = "Crop",
                        iconKind = ReviewToolIconKind.CROP,
                        tint = InTabColors.DarkText,
                        onClick = { onCropPage(activePage.pageId) },
                        modifier = Modifier.weight(1f),
                    )
                    ReviewToolbarAction(
                        label = "Rotate",
                        iconKind = ReviewToolIconKind.ROTATE,
                        tint = InTabColors.DarkText,
                        onClick = onRotateSelected,
                        modifier = Modifier.weight(1f),
                    )
                    ReviewToolbarAction(
                        label = "Retake",
                        iconKind = ReviewToolIconKind.RETAKE,
                        tint = InTabColors.DarkText,
                        onClick = { onRetakePage(activePage.pageId) },
                        modifier = Modifier.weight(1f),
                    )
                    ReviewToolbarAction(
                        label = "Delete",
                        iconKind = ReviewToolIconKind.DELETE,
                        tint = InTabColors.DangerDark,
                        onClick = { pendingDeletePageId = activePage.pageId },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        if (uiState.isExportingPdf) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.68f))
                    .clickable(enabled = false) {},
                contentAlignment = Alignment.Center,
            ) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = InTabColors.DarkSurface,
                    border = BorderStroke(1.dp, InTabColors.DarkBorder),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 32.dp),
                ) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = "Creating PDF…",
                            color = InTabColors.DarkText,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        val total = uiState.exportProgressTotal.coerceAtLeast(1)
                        val done = uiState.exportProgressCompleted.coerceIn(0, total)
                        Text(
                            text = "Processing page $done of $total",
                            color = InTabColors.DarkTextMuted,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Spacer(modifier = Modifier.height(14.dp))
                        LinearProgressIndicator(
                            progress = { done.toFloat() / total.toFloat() },
                            modifier = Modifier.fillMaxWidth(),
                            color = InTabColors.BrandIndigoLight,
                            trackColor = InTabColors.DarkSurfaceVariant,
                        )
                        Spacer(modifier = Modifier.height(14.dp))
                        OutlinedButton(onClick = onCancelExport) {
                            Text("Cancel")
                        }
                    }
                }
            }
        }
        if (isSavingToSaf) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.68f))
                    .clickable(enabled = false) {},
                contentAlignment = Alignment.Center,
            ) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = InTabColors.DarkSurface,
                    border = BorderStroke(1.dp, InTabColors.DarkBorder),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 32.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(20.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(22.dp),
                            strokeWidth = 2.5.dp,
                            color = InTabColors.BrandIndigoSoftText,
                        )
                        Text(
                            text = "Saving PDF…",
                            color = InTabColors.DarkText,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
        }

        if (conflictPrompt != null) {
            AlertDialog(
                onDismissRequest = onConflictCancel,
                containerColor = InTabColors.DarkSurface,
                titleContentColor = InTabColors.DarkText,
                textContentColor = InTabColors.DarkTextMuted,
                title = {
                    Text(
                        text = "File already exists",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            text = "A file named \"${conflictPrompt.existingFileName}\" already exists at the selected location.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = InTabColors.DarkText,
                        )
                        if (conflictPrompt.replaceDisabledReason != null) {
                            Text(
                                text = conflictPrompt.replaceDisabledReason,
                                style = MaterialTheme.typography.bodySmall,
                                color = InTabColors.DangerDark,
                            )
                        }
                    }
                },
                confirmButton = {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(
                            onClick = onConflictSaveAsNewCopy,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Save as New Copy")
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (conflictPrompt.replaceDisabledReason == null) {
                                OutlinedButton(
                                    onClick = onConflictReplace,
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Text("Replace", color = InTabColors.DangerDark)
                                }
                            }
                            TextButton(
                                onClick = onConflictCancel,
                                modifier = Modifier.weight(1f),
                            ) {
                                Text("Cancel", color = InTabColors.DarkTextMuted)
                            }
                        }
                    }
                },
            )
        }

        if (showAddPageChooser) {
            AlertDialog(
                onDismissRequest = { showAddPageChooser = false },
                containerColor = InTabColors.DarkSurface,
                titleContentColor = InTabColors.DarkText,
                textContentColor = InTabColors.DarkTextMuted,
                title = {
                    Text(
                        text = "Add page",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            text = "Choose how to add the next page to this scan.",
                            style = MaterialTheme.typography.bodySmall,
                            color = InTabColors.DarkTextMuted,
                        )
                        Button(
                            onClick = {
                                showAddPageChooser = false
                                onAddFromCamera()
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("review_add_camera"),
                        ) {
                            Text("Camera")
                        }
                        OutlinedButton(
                            onClick = {
                                showAddPageChooser = false
                                onImportGallery()
                            },
                            enabled = !uiState.isImportingGallery,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("review_add_import_photos"),
                        ) {
                            Text("Import Photos")
                        }
                    }
                },
                confirmButton = {},
                dismissButton = {
                    TextButton(onClick = { showAddPageChooser = false }) {
                        Text("Cancel", color = InTabColors.DarkTextMuted)
                    }
                },
            )
        }

        val deleteTargetId = pendingDeletePageId
        if (deleteTargetId != null) {
            val pageNumber = uiState.pages.indexOfFirst { it.pageId == deleteTargetId }
                .takeIf { it >= 0 }
                ?.plus(1)
            AlertDialog(
                onDismissRequest = { pendingDeletePageId = null },
                containerColor = InTabColors.DarkSurface,
                titleContentColor = InTabColors.DarkText,
                textContentColor = InTabColors.DarkTextMuted,
                title = {
                    Text(
                        text = if (pageNumber != null) "Delete page $pageNumber?" else "Delete page?",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                text = {
                    Text(
                        text = "This removes the page from the current scan.",
                        style = MaterialTheme.typography.bodySmall,
                        color = InTabColors.DarkTextMuted,
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            pendingDeletePageId = null
                            onDeletePage(deleteTargetId)
                        },
                        modifier = Modifier.testTag("review_confirm_delete"),
                    ) {
                        Text("Delete", color = InTabColors.DangerDark, fontWeight = FontWeight.SemiBold)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { pendingDeletePageId = null }) {
                        Text("Cancel", color = InTabColors.DarkTextMuted)
                    }
                },
            )
        }
    }
}

@Composable
private fun PagePreviewCanvas(
    page: ReversiblePageRecord,
    renderedResultFile: java.io.File?,
    isRendering: Boolean,
    bitmapLoader: ScanBitmapLoader,
) {
    val fileToDisplay = renderedResultFile ?: java.io.File(page.sourceFilePath)
    val cacheKey = if (renderedResultFile != null) {
        "render_${renderedResultFile.absolutePath}_${renderedResultFile.lastModified()}"
    } else {
        "src_preview_${page.pageId}_${page.quadVersion}_${page.rotationDegrees}"
    }

    var bitmap by remember(page.pageId) {
        mutableStateOf(bitmapLoader.getCachedDisplayBitmap(cacheKey, 1_200_000L))
    }
    LaunchedEffect(cacheKey) {
        bitmapLoader.getCachedDisplayBitmap(cacheKey, 1_200_000L)?.let { cached ->
            bitmap = cached
            return@LaunchedEffect
        }
        val loaded = bitmapLoader.loadDisplayBitmap(
            file = fileToDisplay,
            cacheKey = cacheKey,
            maxPixels = 1_200_000L,
        )
        if (loaded != null) {
            bitmap = loaded
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(10.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap!!.asImageBitmap(),
                contentDescription = "Scanned page preview (${filterDisplayName(page.selectedFilter)})",
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        if (renderedResultFile == null && page.rotationDegrees != 0) {
                            rotationZ = page.rotationDegrees.toFloat()
                        }
                    },
            )
        } else {
            CircularProgressIndicator(color = InTabColors.BrandIndigoSoftText)
        }

        if (isRendering) {
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = InTabColors.DarkSurface.copy(alpha = 0.85f),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 10.dp),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        strokeWidth = 2.dp,
                        color = InTabColors.BrandIndigoSoftText,
                    )
                    Text(
                        text = "Enhancing page…",
                        color = InTabColors.DarkText,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun PageThumbnailStrip(
    pages: List<ReversiblePageRecord>,
    selectedIndex: Int,
    renderedFiles: Map<String, org.intabtools.intabpdf.scanner.data.RenderedPageResult>,
    bitmapLoader: ScanBitmapLoader,
    canAddPage: Boolean,
    onSelectPage: (Int) -> Unit,
    onMoveLeft: () -> Unit,
    onMoveRight: () -> Unit,
    onOpenAddPage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState()
    LaunchedEffect(selectedIndex, pages.size) {
        if (selectedIndex in pages.indices) {
            listState.animateScrollToItem(selectedIndex)
        }
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(InTabColors.DarkSurface)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (pages.size > 1) {
            ReorderPageButton(
                symbol = "◀",
                contentDescription = "Move page left",
                enabled = selectedIndex > 0,
                onClick = onMoveLeft,
                modifier = Modifier.testTag("review_move_left"),
            )
        }

        LazyRow(
            state = listState,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            itemsIndexed(pages, key = { _, page -> page.pageId }) { idx, page ->
                val isSelected = idx == selectedIndex
                val renderedFile = renderedFiles[page.pageId]?.outputFile
                val thumbFile = renderedFile ?: java.io.File(page.sourceFilePath)
                val cacheKey = if (renderedFile != null) {
                    "page_thumb_${page.pageId}_${renderedFile.absolutePath}_${renderedFile.lastModified()}"
                } else {
                    "page_thumb_src_${page.pageId}_${page.quadVersion}_${page.rotationDegrees}"
                }
                var thumbBitmap by remember(page.pageId) {
                    mutableStateOf(bitmapLoader.getCachedDisplayBitmap(cacheKey, 48_000L))
                }
                LaunchedEffect(cacheKey, page.sourceFilePath, page.quadVersion, page.rotationDegrees) {
                    bitmapLoader.getCachedDisplayBitmap(cacheKey, 48_000L)?.let { cached ->
                        thumbBitmap = cached
                        return@LaunchedEffect
                    }
                    val loaded = bitmapLoader.loadDisplayBitmap(
                        file = thumbFile,
                        cacheKey = cacheKey,
                        maxPixels = 48_000L,
                    ) ?: if (renderedFile != null) {
                        val fallbackKey = "page_thumb_src_${page.pageId}_${page.quadVersion}_${page.rotationDegrees}"
                        bitmapLoader.loadDisplayBitmap(
                            file = java.io.File(page.sourceFilePath),
                            cacheKey = fallbackKey,
                            maxPixels = 48_000L,
                        )
                    } else {
                        null
                    }
                    if (loaded != null) {
                        thumbBitmap = loaded
                    }
                }

                Box(
                    modifier = Modifier
                        .size(width = 52.dp, height = 64.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(InTabColors.DarkBackground)
                        .testTag("review_page_thumb_$idx")
                        .semantics(mergeDescendants = true) {
                            selected = isSelected
                            contentDescription = "Page ${idx + 1}"
                        }
                        .clickable { onSelectPage(idx) },
                ) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = InTabColors.DarkBackground,
                        border = BorderStroke(
                            width = if (isSelected) 2.dp else 1.dp,
                            color = if (isSelected) InTabColors.BrandIndigoSoftText else InTabColors.DarkBorder,
                        ),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            if (thumbBitmap != null) {
                                Image(
                                    bitmap = thumbBitmap!!.asImageBitmap(),
                                    contentDescription = null,
                                    contentScale = ContentScale.Fit,
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .padding(2.dp)
                                        .graphicsLayer {
                                            if (renderedFile == null && page.rotationDegrees != 0) {
                                                rotationZ = page.rotationDegrees.toFloat()
                                            }
                                        },
                                )
                            } else {
                                Text(
                                    text = "${idx + 1}",
                                    color = InTabColors.DarkTextMuted,
                                    style = MaterialTheme.typography.labelSmall,
                                )
                            }

                            Surface(
                                shape = RoundedCornerShape(4.dp),
                                color = if (isSelected) {
                                    InTabColors.BrandIndigoLight
                                } else {
                                    Color.Black.copy(alpha = 0.68f)
                                },
                                modifier = Modifier
                                    .align(Alignment.BottomEnd)
                                    .padding(2.dp),
                            ) {
                                Text(
                                    text = "${idx + 1}",
                                    color = Color.White,
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
                                )
                            }
                        }
                    }
                }
            }

            item(key = "add_page_tile") {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = InTabColors.DarkSurfaceVariant,
                    border = BorderStroke(1.dp, InTabColors.DarkBorder),
                    modifier = Modifier
                        .size(width = 52.dp, height = 64.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .testTag("review_add_page_tile")
                        .semantics(mergeDescendants = true) {
                            contentDescription = "Add Page"
                        }
                        .clickable(enabled = canAddPage, onClick = onOpenAddPage),
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        PlusIcon(
                            tint = if (canAddPage) InTabColors.BrandIndigoSoftText else InTabColors.DarkTextMuted.copy(alpha = 0.4f),
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "Add",
                            color = if (canAddPage) InTabColors.DarkTextMuted else InTabColors.DarkTextMuted.copy(alpha = 0.4f),
                            fontSize = 10.sp,
                            lineHeight = 11.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
            }
        }

        if (pages.size > 1) {
            ReorderPageButton(
                symbol = "▶",
                contentDescription = "Move page right",
                enabled = selectedIndex < pages.lastIndex,
                onClick = onMoveRight,
                modifier = Modifier.testTag("review_move_right"),
            )
        }
    }
}

@Composable
private fun ReorderPageButton(
    symbol: String,
    contentDescription: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = InTabColors.DarkSurfaceVariant,
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .semantics(mergeDescendants = true) {
                this.contentDescription = contentDescription
            }
            .clickable(enabled = enabled, onClick = onClick),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = symbol,
                color = if (enabled) InTabColors.DarkText else InTabColors.DarkTextMuted.copy(alpha = 0.35f),
                style = MaterialTheme.typography.labelMedium,
            )
            Text(
                text = "Move",
                color = if (enabled) InTabColors.DarkTextMuted else InTabColors.DarkTextMuted.copy(alpha = 0.35f),
                fontSize = 9.sp,
                lineHeight = 10.sp,
            )
        }
    }
}

private enum class ReviewToolIconKind {
    CROP,
    ROTATE,
    RETAKE,
    DELETE,
}

@Composable
private fun ReviewToolbarAction(
    label: String,
    iconKind: ReviewToolIconKind,
    tint: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .defaultMinSize(minHeight = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .semantics(mergeDescendants = true) {
                contentDescription = label
            }
            .clickable(onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        ReviewToolbarIcon(
            kind = iconKind,
            tint = tint,
            modifier = Modifier.size(18.dp),
        )
        Spacer(modifier = Modifier.height(3.dp))
        Text(
            text = label,
            color = tint,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ReviewToolbarIcon(
    kind: ReviewToolIconKind,
    tint: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier) {
        val stroke = Stroke(width = 1.7.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        val w = size.width
        val h = size.height
        when (kind) {
            ReviewToolIconKind.CROP -> {
                val m = w * 0.2f
                val far = w * 0.8f
                drawLine(tint, Offset(m, h * 0.08f), Offset(m, far), strokeWidth = stroke.width, cap = StrokeCap.Round)
                drawLine(tint, Offset(m, far), Offset(w * 0.92f, far), strokeWidth = stroke.width, cap = StrokeCap.Round)
                drawLine(tint, Offset(w * 0.08f, m), Offset(far, m), strokeWidth = stroke.width, cap = StrokeCap.Round)
                drawLine(tint, Offset(far, m), Offset(far, h * 0.92f), strokeWidth = stroke.width, cap = StrokeCap.Round)
            }

            ReviewToolIconKind.ROTATE -> {
                drawArc(
                    color = tint,
                    startAngle = -55f,
                    sweepAngle = 275f,
                    useCenter = false,
                    topLeft = Offset(w * 0.16f, h * 0.16f),
                    size = Size(w * 0.68f, h * 0.68f),
                    style = stroke,
                )
                val arrow = Path().apply {
                    moveTo(w * 0.66f, h * 0.14f)
                    lineTo(w * 0.86f, h * 0.24f)
                    lineTo(w * 0.68f, h * 0.36f)
                }
                drawPath(arrow, color = tint, style = stroke)
            }

            ReviewToolIconKind.RETAKE -> {
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(w * 0.12f, h * 0.28f),
                    size = Size(w * 0.76f, h * 0.56f),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(w * 0.12f, w * 0.12f),
                    style = stroke,
                )
                val topRidge = Path().apply {
                    moveTo(w * 0.34f, h * 0.28f)
                    lineTo(w * 0.41f, h * 0.16f)
                    lineTo(w * 0.59f, h * 0.16f)
                    lineTo(w * 0.66f, h * 0.28f)
                }
                drawPath(topRidge, color = tint, style = stroke)
                drawCircle(
                    color = tint,
                    radius = w * 0.15f,
                    center = Offset(w * 0.5f, h * 0.56f),
                    style = stroke,
                )
            }

            ReviewToolIconKind.DELETE -> {
                drawLine(tint, Offset(w * 0.18f, h * 0.26f), Offset(w * 0.82f, h * 0.26f), strokeWidth = stroke.width, cap = StrokeCap.Round)
                drawLine(tint, Offset(w * 0.38f, h * 0.14f), Offset(w * 0.62f, h * 0.14f), strokeWidth = stroke.width, cap = StrokeCap.Round)
                val body = Path().apply {
                    moveTo(w * 0.26f, h * 0.26f)
                    lineTo(w * 0.32f, h * 0.86f)
                    lineTo(w * 0.68f, h * 0.86f)
                    lineTo(w * 0.74f, h * 0.26f)
                }
                drawPath(body, color = tint, style = stroke)
                drawLine(tint, Offset(w * 0.43f, h * 0.42f), Offset(w * 0.43f, h * 0.72f), strokeWidth = stroke.width, cap = StrokeCap.Round)
                drawLine(tint, Offset(w * 0.57f, h * 0.42f), Offset(w * 0.57f, h * 0.72f), strokeWidth = stroke.width, cap = StrokeCap.Round)
            }
        }
    }
}

@Composable
private fun MoreVertIcon(
    tint: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier) {
        val radius = size.minDimension * 0.1f
        val cx = size.width * 0.5f
        drawCircle(tint, radius = radius, center = Offset(cx, size.height * 0.22f))
        drawCircle(tint, radius = radius, center = Offset(cx, size.height * 0.50f))
        drawCircle(tint, radius = radius, center = Offset(cx, size.height * 0.78f))
    }
}

@Composable
private fun PlusIcon(
    tint: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier) {
        val stroke = 2.dp.toPx()
        val cx = size.width * 0.5f
        val cy = size.height * 0.5f
        drawLine(tint, Offset(cx, size.height * 0.18f), Offset(cx, size.height * 0.82f), strokeWidth = stroke, cap = StrokeCap.Round)
        drawLine(tint, Offset(size.width * 0.18f, cy), Offset(size.width * 0.82f, cy), strokeWidth = stroke, cap = StrokeCap.Round)
    }
}
