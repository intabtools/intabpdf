package org.intabtools.intabpdf.scanner.ui.review

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.intabtools.intabpdf.scanner.data.ScanFilter
import org.intabtools.intabpdf.scanner.imaging.ScanBitmapLoader
import org.intabtools.intabpdf.scanner.ui.theme.InTabColors
import java.io.File

@Suppress("UNUSED_PARAMETER")
@Composable
fun FilterStripBar(
    selectedFilter: ScanFilter,
    thumbnails: Map<ScanFilter, File> = emptyMap(),
    thumbnailCacheKey: String? = null,
    isLoadingThumbnails: Boolean = false,
    applyToAll: Boolean,
    pageCount: Int,
    bitmapLoader: ScanBitmapLoader? = null,
    onToggleApplyToAll: (Boolean) -> Unit,
    onSelectFilter: (ScanFilter) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(InTabColors.DarkSurface)
            .padding(vertical = 4.dp),
    ) {
        if (pageCount > 1) {
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
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Medium,
                )

                Text(
                    text = if (applyToAll) "Apply to: All pages" else "Apply to: This page",
                    color = if (applyToAll) InTabColors.BrandIndigoSoftText else InTabColors.DarkTextMuted,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = if (applyToAll) FontWeight.SemiBold else FontWeight.Medium,
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .clickable { onToggleApplyToAll(!applyToAll) }
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
            Spacer(modifier = Modifier.height(2.dp))
        }

        val displayOrder = listOf(
            ScanFilter.AUTO,
            ScanFilter.ORIGINAL,
            ScanFilter.COLOR,
            ScanFilter.GRAYSCALE,
            ScanFilter.BLACK_AND_WHITE,
        )
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            items(displayOrder, key = { it.wireValue }) { mode ->
                val isSelected = mode == selectedFilter
                Column(
                    modifier = Modifier
                        .defaultMinSize(minWidth = 48.dp, minHeight = 34.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .semantics(mergeDescendants = true) {
                            selected = isSelected
                            contentDescription = "Filter: ${filterDisplayName(mode)}"
                        }
                        .clickable { onSelectFilter(mode) }
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        text = filterDisplayName(mode),
                        color = if (isSelected) InTabColors.BrandIndigoSoftText else InTabColors.DarkTextMuted,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                        maxLines = 1,
                    )
                    Spacer(modifier = Modifier.height(3.dp))
                    Box(
                        modifier = Modifier
                            .width(20.dp)
                            .height(2.dp)
                            .background(
                                color = if (isSelected) InTabColors.BrandIndigoSoftText else Color.Transparent,
                                shape = RoundedCornerShape(1.dp),
                            ),
                    )
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
