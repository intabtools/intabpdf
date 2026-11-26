package org.intabtools.intabpdf.scanner.ui.review

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
            .padding(vertical = 6.dp),
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

                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = if (applyToAll) {
                        InTabColors.BrandIndigoLight.copy(alpha = 0.16f)
                    } else {
                        InTabColors.DarkSurfaceVariant
                    },
                    border = BorderStroke(
                        1.dp,
                        if (applyToAll) {
                            InTabColors.BrandIndigoSoftText.copy(alpha = 0.7f)
                        } else {
                            InTabColors.DarkBorder
                        },
                    ),
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .clickable { onToggleApplyToAll(!applyToAll) },
                ) {
                    Text(
                        text = if (applyToAll) "Apply to: All pages" else "Apply to: This page",
                        color = if (applyToAll) InTabColors.BrandIndigoSoftText else InTabColors.DarkText,
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
                    )
                }
            }
            Spacer(modifier = Modifier.height(5.dp))
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
            contentPadding = PaddingValues(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            items(displayOrder, key = { it.wireValue }) { mode ->
                val isSelected = mode == selectedFilter
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = if (isSelected) {
                        InTabColors.BrandIndigoLight.copy(alpha = 0.16f)
                    } else {
                        InTabColors.DarkSurfaceVariant
                    },
                    border = BorderStroke(
                        width = 1.dp,
                        color = if (isSelected) {
                            InTabColors.BrandIndigoSoftText.copy(alpha = 0.8f)
                        } else {
                            InTabColors.DarkBorder
                        },
                    ),
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .semantics(mergeDescendants = true) {
                            selected = isSelected
                            contentDescription = "Filter: ${filterDisplayName(mode)}"
                        }
                        .clickable { onSelectFilter(mode) },
                ) {
                    Text(
                        text = filterDisplayName(mode),
                        color = if (isSelected) InTabColors.BrandIndigoSoftText else InTabColors.DarkTextMuted,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
                        maxLines = 1,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
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
