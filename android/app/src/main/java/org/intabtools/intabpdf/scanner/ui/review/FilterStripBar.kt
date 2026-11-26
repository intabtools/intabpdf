package org.intabtools.intabpdf.scanner.ui.review

import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.intabtools.intabpdf.scanner.data.ScanFilter
import org.intabtools.intabpdf.scanner.imaging.ScanBitmapLoader
import org.intabtools.intabpdf.scanner.ui.theme.InTabColors
import java.io.File

@Composable
fun FilterStripBar(
    selectedFilter: ScanFilter,
    thumbnails: Map<ScanFilter, File>,
    thumbnailCacheKey: String?,
    isLoadingThumbnails: Boolean,
    applyToAll: Boolean,
    pageCount: Int,
    bitmapLoader: ScanBitmapLoader,
    onToggleApplyToAll: (Boolean) -> Unit,
    onSelectFilter: (ScanFilter) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(InTabColors.DarkSurface)
            .padding(top = 8.dp, bottom = 6.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = "Filter",
                color = InTabColors.DarkTextMuted,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )

            if (pageCount > 1) {
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = if (applyToAll) {
                        InTabColors.BrandIndigoLight.copy(alpha = 0.25f)
                    } else {
                        InTabColors.DarkSurfaceVariant
                    },
                    border = BorderStroke(
                        1.dp,
                        if (applyToAll) InTabColors.BrandIndigoSoftText else InTabColors.DarkBorder,
                    ),
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .clickable { onToggleApplyToAll(!applyToAll) },
                ) {
                    Text(
                        text = if (applyToAll) "Scope: All Pages" else "Scope: This Page",
                        color = InTabColors.DarkText,
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(6.dp))

        LazyRow(
            contentPadding = PaddingValues(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(ScanFilter.entries, key = { it.wireValue }) { mode ->
                val isSelected = mode == selectedFilter
                val thumbFile = thumbnails[mode]
                var thumbBitmap by remember(mode.wireValue) { mutableStateOf<Bitmap?>(null) }
                LaunchedEffect(thumbFile?.absolutePath, thumbnailCacheKey) {
                    if (thumbFile != null) {
                        val loaded = bitmapLoader.loadDisplayBitmap(
                            file = thumbFile,
                            cacheKey = "thumb_${thumbFile.absolutePath}_${thumbFile.lastModified()}",
                            maxPixels = 48_000L,
                        )
                        if (loaded != null) {
                            thumbBitmap = loaded
                        }
                    } else if (thumbnailCacheKey == null) {
                        thumbBitmap = null
                    }
                }

                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = InTabColors.DarkSurfaceVariant,
                    border = BorderStroke(
                        width = if (isSelected) 2.dp else 1.dp,
                        color = if (isSelected) InTabColors.BrandIndigoSoftText else InTabColors.DarkBorder,
                    ),
                    modifier = Modifier
                        .width(68.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { onSelectFilter(mode) },
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(4.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(InTabColors.DarkBackground),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (thumbBitmap != null) {
                                Image(
                                    bitmap = thumbBitmap!!.asImageBitmap(),
                                    contentDescription = "${filterDisplayName(mode)} preview",
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize(),
                                )
                            } else if (isLoadingThumbnails) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                    color = InTabColors.BrandIndigoSoftText,
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = filterDisplayName(mode),
                            color = if (isSelected) InTabColors.BrandIndigoSoftText else InTabColors.DarkTextMuted,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

fun filterDisplayName(filter: ScanFilter): String = when (filter) {
    ScanFilter.AUTO -> "Auto"
    ScanFilter.COLOR -> "Color"
    ScanFilter.GRAYSCALE -> "Gray"
    ScanFilter.BLACK_AND_WHITE -> "B&W"
    ScanFilter.ORIGINAL -> "Original"
}
