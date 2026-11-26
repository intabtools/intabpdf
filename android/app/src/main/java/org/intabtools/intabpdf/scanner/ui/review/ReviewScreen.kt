package org.intabtools.intabpdf.scanner.ui.review

import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.intabtools.intabpdf.scanner.data.ReversiblePageRecord
import org.intabtools.intabpdf.scanner.data.ScanFilter
import org.intabtools.intabpdf.scanner.data.ScannerSessionUiState
import org.intabtools.intabpdf.scanner.imaging.ScanBitmapLoader
import org.intabtools.intabpdf.scanner.ui.theme.InTabColors

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
    onOpenInViewer: () -> Unit = {},
    onSharePdf: () -> Unit = {},
    onRetryExport: () -> Unit = onExportPdf,
) {
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
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                TextButton(
                    onClick = onCloseSession,
                    enabled = !uiState.isExportingPdf,
                ) {
                    Text("Close", color = InTabColors.DarkTextMuted)
                }

                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = if (uiState.pages.isEmpty()) {
                            "Review Pages"
                        } else {
                            "Page ${uiState.selectedPageIndex + 1} of ${uiState.pages.size}"
                        },
                        color = InTabColors.DarkText,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    uiState.statusMessage?.let { msg ->
                        Text(
                            text = msg,
                            color = InTabColors.BrandIndigoSoftText,
                            style = MaterialTheme.typography.labelSmall,
                            maxLines = 1,
                        )
                    }
                }

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
                                .clickable(
                                    enabled = !uiState.isExportingPdf && !uiState.isImportingGallery,
                                    onClick = onExportPdf,
                                )
                                .semantics { contentDescription = "Save PDF" },
                        ) {
                            Text(
                                text = "Save PDF",
                                color = Color.White,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                            )
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

            // Secondary Export (Open in Viewer / Share) & Add-Page / Gallery Action Row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(InTabColors.DarkSurface)
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = onOpenInViewer,
                    enabled = !uiState.isExportingPdf && !uiState.isImportingGallery,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                    modifier = Modifier.semantics { contentDescription = "Open in Viewer" },
                ) {
                    Text("Open in Viewer", color = InTabColors.DarkText, style = MaterialTheme.typography.labelMedium)
                }
                TextButton(
                    onClick = onSharePdf,
                    enabled = !uiState.isExportingPdf && !uiState.isImportingGallery,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                    modifier = Modifier.semantics { contentDescription = "Share" },
                ) {
                    Text("Share", color = InTabColors.DarkText, style = MaterialTheme.typography.labelMedium)
                }
                TextButton(
                    onClick = onImportGallery,
                    enabled = !uiState.isImportingGallery && !uiState.isExportingPdf,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                ) {
                    Text("Import Photos", color = InTabColors.BrandIndigoSoftText, style = MaterialTheme.typography.labelMedium)
                }
                TextButton(
                    onClick = onAddFromCamera,
                    enabled = !uiState.isExportingPdf,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                ) {
                    Text("+ Add Page", color = InTabColors.BrandIndigoSoftText, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                }
            }

            val pagerState = rememberPagerState(
                initialPage = uiState.selectedPageIndex.coerceIn(0, uiState.pages.lastIndex),
                pageCount = { uiState.pages.size },
            )
            val latestSelectedIndex by rememberUpdatedState(uiState.selectedPageIndex)
            val latestPageCount by rememberUpdatedState(uiState.pages.size)

            LaunchedEffect(pagerState) {
                snapshotFlow { pagerState.settledPage }
                    .collect { settled ->
                        val count = latestPageCount
                        if (count > 0) {
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
                    pagerState.scrollToPage(target)
                }
            }

            // Main Perspective-Corrected Page Pager
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .background(Color.Black),
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

                if (uiState.exportErrorMessage != null) {
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
                                text = "Could not create PDF",
                                color = InTabColors.DangerDark,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = uiState.exportErrorMessage,
                                color = InTabColors.DarkText,
                                style = MaterialTheme.typography.bodySmall,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End,
                            ) {
                                TextButton(onClick = onDismissExportError) {
                                    Text("Dismiss")
                                }
                                TextButton(onClick = onRetryExport) {
                                    Text("Retry")
                                }
                            }
                        }
                    }
                }
            }

            // Compact Multi-Page Strip & Ordering Controls
            if (uiState.pages.size > 1) {
                PageOrderingStrip(
                    pages = uiState.pages,
                    selectedIndex = uiState.selectedPageIndex,
                    onSelectPage = onSelectPage,
                    onMoveLeft = onMoveSelectedLeft,
                    onMoveRight = onMoveSelectedRight,
                )
                HorizontalDivider(color = InTabColors.DarkBorder, thickness = 1.dp)
            }

            // Filter Selector Strip (5 Filters + This Page / All Pages)
            val activePage = uiState.selectedPage
            if (activePage != null) {
                FilterStripBar(
                    selectedFilter = activePage.selectedFilter,
                    thumbnails = uiState.filterThumbnails,
                    thumbnailCacheKey = uiState.thumbnailCacheKey,
                    isLoadingThumbnails = uiState.isLoadingThumbnails,
                    applyToAll = uiState.applyFilterToAll,
                    pageCount = uiState.pages.size,
                    bitmapLoader = bitmapLoader,
                    onToggleApplyToAll = onToggleApplyFilterToAll,
                    onSelectFilter = onSelectFilter,
                )
                HorizontalDivider(color = InTabColors.DarkBorder, thickness = 1.dp)

                // Per-Page Action Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(InTabColors.DarkSurface)
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ReviewActionButton(label = "Crop", onClick = { onCropPage(activePage.pageId) })
                    ReviewActionButton(label = "Rotate 90°", onClick = onRotateSelected)
                    ReviewActionButton(label = "Retake", onClick = { onRetakePage(activePage.pageId) })
                    ReviewActionButton(
                        label = "Delete",
                        textColor = InTabColors.DangerDark,
                        onClick = { onDeletePage(activePage.pageId) },
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

    var bitmap by remember(page.pageId) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(cacheKey) {
        val loaded = bitmapLoader.loadDisplayBitmap(
            file = fileToDisplay,
            cacheKey = cacheKey,
            maxPixels = 1_800_000L,
        )
        if (loaded != null) {
            bitmap = loaded
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap!!.asImageBitmap(),
                contentDescription = "Scanned page preview",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
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
private fun PageOrderingStrip(
    pages: List<ReversiblePageRecord>,
    selectedIndex: Int,
    onSelectPage: (Int) -> Unit,
    onMoveLeft: () -> Unit,
    onMoveRight: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(InTabColors.DarkSurface)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = InTabColors.DarkSurfaceVariant,
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable(enabled = selectedIndex > 0, onClick = onMoveLeft),
        ) {
            Text(
                text = "◀",
                color = if (selectedIndex > 0) InTabColors.DarkText else InTabColors.DarkTextMuted.copy(alpha = 0.35f),
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            )
        }

        LazyRow(
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            itemsIndexed(pages, key = { _, page -> page.pageId }) { idx, page ->
                val isSelected = idx == selectedIndex
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = if (isSelected) InTabColors.BrandIndigoLight.copy(alpha = 0.25f) else InTabColors.DarkSurfaceVariant,
                    border = BorderStroke(
                        width = if (isSelected) 1.5.dp else 1.dp,
                        color = if (isSelected) InTabColors.BrandIndigoSoftText else InTabColors.DarkBorder,
                    ),
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onSelectPage(idx) },
                ) {
                    Text(
                        text = "${idx + 1} · ${filterDisplayName(page.selectedFilter)}",
                        color = if (isSelected) InTabColors.DarkText else InTabColors.DarkTextMuted,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
                    )
                }
            }
        }

        Surface(
            shape = RoundedCornerShape(8.dp),
            color = InTabColors.DarkSurfaceVariant,
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable(enabled = selectedIndex < pages.lastIndex, onClick = onMoveRight),
        ) {
            Text(
                text = "▶",
                color = if (selectedIndex < pages.lastIndex) InTabColors.DarkText else InTabColors.DarkTextMuted.copy(alpha = 0.35f),
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            )
        }
    }
}

@Composable
private fun ReviewActionButton(
    label: String,
    textColor: Color = InTabColors.DarkText,
    onClick: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = InTabColors.DarkSurfaceVariant,
        border = BorderStroke(1.dp, InTabColors.DarkBorder),
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick),
    ) {
        Text(
            text = label,
            color = textColor,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        )
    }
}
