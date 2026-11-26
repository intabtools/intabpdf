package org.intabtools.intabpdf.scanner.ui.crop

import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import org.intabtools.intabpdf.scanner.data.ReversiblePageRecord
import org.intabtools.intabpdf.scanner.imaging.ScanBitmapLoader
import org.intabtools.intabpdf.scanner.ui.theme.InTabColors
import org.intabtools.intabpdf.scanner.vision.CoordinateTransform
import org.intabtools.intabpdf.scanner.vision.CropGeometry
import org.intabtools.intabpdf.scanner.vision.CropHandle
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import java.io.File
import kotlin.math.roundToInt

/**
 * Interactive Crop & Perspective Editor displaying the uncropped source image rotated into the
 * user's visual orientation, with 4 draggable corners, geometry validation, magnified corner
 * loupe, Fit All, Reset Auto, and step-by-step Undo.
 */
@Composable
fun CropEditorScreen(
    page: ReversiblePageRecord,
    bitmapLoader: ScanBitmapLoader,
    onCancel: () -> Unit,
    onApplyCrop: (NormalizedQuad) -> Unit,
    modifier: Modifier = Modifier,
) {
    var androidBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var imageBitmap by remember { mutableStateOf<ImageBitmap?>(null) }

    val initialVisibleQuad = remember(page.pageId, page.quadVersion, page.rotationDegrees) {
        CropGeometry.visibleQuadFromSource(page.activeQuad, page.rotationDegrees)
    }
    val autoVisibleQuad = remember(page.pageId, page.rotationDegrees, page.detectedQuad) {
        CropGeometry.visibleQuadFromSource(
            page.detectedQuad ?: NormalizedQuad.defaultInset(),
            page.rotationDegrees,
        )
    }

    var workingQuad by remember(page.pageId, page.quadVersion, page.rotationDegrees) {
        mutableStateOf(initialVisibleQuad)
    }
    val undoHistory = remember(page.pageId, page.quadVersion, page.rotationDegrees) {
        mutableStateListOf<NormalizedQuad>()
    }

    var activeHandle by remember { mutableStateOf<CropHandle?>(null) }
    var dragStartQuad by remember { mutableStateOf<NormalizedQuad?>(null) }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    val density = LocalDensity.current

    LaunchedEffect(page.sourceFilePath, page.rotationDegrees) {
        val loaded = bitmapLoader.loadRotatedSourceForCropEditor(
            sourceFile = File(page.sourceFilePath),
            rotationDegrees = page.rotationDegrees,
        )
        val old = androidBitmap
        androidBitmap = loaded
        imageBitmap = loaded?.asImageBitmap()
        if (old != null && old !== loaded && !old.isRecycled) {
            old.recycle()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            androidBitmap?.takeIf { !it.isRecycled }?.recycle()
            androidBitmap = null
            imageBitmap = null
        }
    }

    fun pushUndoAndSet(next: NormalizedQuad) {
        if (next != workingQuad) {
            undoHistory.add(workingQuad)
            workingQuad = next
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(InTabColors.DarkBackground)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = "Adjust Corners",
                color = InTabColors.DarkText,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "Drag corners to align page",
                color = InTabColors.DarkTextMuted,
                style = MaterialTheme.typography.bodySmall,
            )
        }

        // Source Crop Viewport + Draggable Handles + Magnified Loupe
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(Color.Black)
                .onSizeChanged { canvasSize = it },
            contentAlignment = Alignment.Center,
        ) {
            val bmp = imageBitmap
            if (bmp == null) {
                CircularProgressIndicator(color = InTabColors.BrandIndigoSoftText)
            } else {
                val imageAspect = bmp.width.toFloat() / bmp.height.coerceAtLeast(1).toFloat()
                val touchRadiusPx = with(density) { 52.dp.toPx() }

                Canvas(
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(imageAspect, canvasSize, touchRadiusPx) {
                            detectDragGestures(
                                onDragStart = { startOffset ->
                                    val found = CropGeometry.findClosestHandle(
                                        tapX = startOffset.x,
                                        tapY = startOffset.y,
                                        quad = workingQuad,
                                        imageAspectRatio = imageAspect,
                                        canvasWidth = size.width.toFloat(),
                                        canvasHeight = size.height.toFloat(),
                                        maxDistancePx = touchRadiusPx,
                                    )
                                    activeHandle = found
                                    dragStartQuad = if (found != null) workingQuad else null
                                },
                                onDrag = { change, _ ->
                                    val handle = activeHandle ?: return@detectDragGestures
                                    change.consume()
                                    val normPoint = CropGeometry.canvasPointToNormalizedImagePoint(
                                        canvasX = change.position.x,
                                        canvasY = change.position.y,
                                        imageAspectRatio = imageAspect,
                                        canvasWidth = size.width.toFloat(),
                                        canvasHeight = size.height.toFloat(),
                                    ) ?: return@detectDragGestures
                                    workingQuad = CropGeometry.updateCornerSafely(
                                        current = workingQuad,
                                        handle = handle,
                                        candidatePoint = normPoint,
                                    )
                                },
                                onDragEnd = {
                                    val snapshot = dragStartQuad
                                    if (snapshot != null && snapshot != workingQuad) {
                                        undoHistory.add(snapshot)
                                    }
                                    activeHandle = null
                                    dragStartQuad = null
                                },
                                onDragCancel = {
                                    dragStartQuad?.let { workingQuad = it }
                                    activeHandle = null
                                    dragStartQuad = null
                                },
                            )
                        },
                ) {
                    val topLeft = CoordinateTransform.mapNormalizedToFitCenterCanvas(
                        org.intabtools.intabpdf.scanner.vision.NormalizedPoint(0f, 0f),
                        imageAspect,
                        size.width,
                        size.height,
                    )
                    val bottomRight = CoordinateTransform.mapNormalizedToFitCenterCanvas(
                        org.intabtools.intabpdf.scanner.vision.NormalizedPoint(1f, 1f),
                        imageAspect,
                        size.width,
                        size.height,
                    )
                    val dstOffset = IntOffset(topLeft.x.roundToInt(), topLeft.y.roundToInt())
                    val dstSize = IntSize(
                        (bottomRight.x - topLeft.x).roundToInt().coerceAtLeast(1),
                        (bottomRight.y - topLeft.y).roundToInt().coerceAtLeast(1),
                    )
                    drawImage(image = bmp, dstOffset = dstOffset, dstSize = dstSize)

                    val pts = CoordinateTransform.mapQuadToFitCenterCanvas(
                        quad = workingQuad,
                        imageAspectRatio = imageAspect,
                        canvasWidth = size.width,
                        canvasHeight = size.height,
                    )
                    if (pts.size == 4) {
                        val scrimPath = Path().apply {
                            fillType = PathFillType.EvenOdd
                            moveTo(topLeft.x, topLeft.y)
                            lineTo(bottomRight.x, topLeft.y)
                            lineTo(bottomRight.x, bottomRight.y)
                            lineTo(topLeft.x, bottomRight.y)
                            close()

                            moveTo(pts[0].x, pts[0].y)
                            lineTo(pts[1].x, pts[1].y)
                            lineTo(pts[2].x, pts[2].y)
                            lineTo(pts[3].x, pts[3].y)
                            close()
                        }
                        drawPath(scrimPath, color = Color.Black.copy(alpha = 0.55f))

                        val quadPath = Path().apply {
                            moveTo(pts[0].x, pts[0].y)
                            lineTo(pts[1].x, pts[1].y)
                            lineTo(pts[2].x, pts[2].y)
                            lineTo(pts[3].x, pts[3].y)
                            close()
                        }
                        drawPath(
                            path = quadPath,
                            color = InTabColors.BrandIndigoSoftText,
                            style = Stroke(width = 2.5.dp.toPx(), join = StrokeJoin.Round),
                        )

                        CropHandle.entries.forEachIndexed { idx, handle ->
                            val pt = pts[idx]
                            val isDragging = handle == activeHandle
                            drawCircle(
                                color = Color.White,
                                radius = (if (isDragging) 14.dp else 11.dp).toPx(),
                                center = Offset(pt.x, pt.y),
                            )
                            drawCircle(
                                color = if (isDragging) InTabColors.BrandIndigoSoftText else InTabColors.BrandIndigoLight,
                                radius = (if (isDragging) 10.dp else 7.5.dp).toPx(),
                                center = Offset(pt.x, pt.y),
                            )
                        }
                    }
                }

                // Magnified Precision Loupe anchored away from the active finger position
                val draggingHandle = activeHandle
                if (draggingHandle != null) {
                    val focusCorner = CropGeometry.getCorner(workingQuad, draggingHandle)
                    val placeOnRight = focusCorner.x < 0.5f
                    MagnifiedCornerLoupe(
                        imageBitmap = bmp,
                        focusPoint = focusCorner,
                        modifier = Modifier
                            .align(if (placeOnRight) Alignment.TopEnd else Alignment.TopStart)
                            .padding(14.dp),
                    )
                }
            }
        }

        // Bottom Controls: Utilities (Undo, Fit All, Reset Auto) + Commit (Cancel, Apply)
        Surface(
            color = InTabColors.DarkSurface,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    CropUtilityChip(
                        label = "Undo",
                        enabled = undoHistory.isNotEmpty(),
                        onClick = {
                            if (undoHistory.isNotEmpty()) {
                                workingQuad = undoHistory.removeAt(undoHistory.lastIndex)
                            }
                        },
                        modifier = Modifier.weight(1f),
                    )
                    CropUtilityChip(
                        label = "Fit All",
                        enabled = workingQuad != NormalizedQuad.fullFrame(),
                        onClick = { pushUndoAndSet(NormalizedQuad.fullFrame()) },
                        modifier = Modifier.weight(1f),
                    )
                    CropUtilityChip(
                        label = "Reset Auto",
                        enabled = workingQuad != autoVisibleQuad,
                        onClick = { pushUndoAndSet(autoVisibleQuad) },
                        modifier = Modifier.weight(1f),
                    )
                }

                Spacer(modifier = Modifier.height(10.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    OutlinedButton(
                        onClick = onCancel,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("Cancel")
                    }
                    Button(
                        onClick = {
                            val sourceQuad = CropGeometry.sourceQuadFromVisible(workingQuad, page.rotationDegrees)
                            onApplyCrop(sourceQuad)
                        },
                        modifier = Modifier
                            .weight(1f)
                            .semantics { contentDescription = "Apply crop" },
                    ) {
                        Text("Apply Crop")
                    }
                }
            }
        }
    }
}

@Composable
private fun MagnifiedCornerLoupe(
    imageBitmap: ImageBitmap,
    focusPoint: org.intabtools.intabpdf.scanner.vision.NormalizedPoint,
    modifier: Modifier = Modifier,
) {
    val sourceRect = CropGeometry.computeLoupeSourceRect(focusPoint, halfWidth = 0.11f, halfHeight = 0.11f)
    Surface(
        shape = CircleShape,
        color = Color.Black,
        border = BorderStroke(2.5.dp, InTabColors.BrandIndigoSoftText),
        shadowElevation = 6.dp,
        modifier = modifier.size(116.dp),
    ) {
        Canvas(modifier = Modifier.fillMaxSize().clip(CircleShape)) {
            val srcX = (sourceRect.left * imageBitmap.width).roundToInt().coerceIn(0, (imageBitmap.width - 2).coerceAtLeast(0))
            val srcY = (sourceRect.top * imageBitmap.height).roundToInt().coerceIn(0, (imageBitmap.height - 2).coerceAtLeast(0))
            val srcW = (sourceRect.width * imageBitmap.width).roundToInt().coerceIn(1, (imageBitmap.width - srcX).coerceAtLeast(1))
            val srcH = (sourceRect.height * imageBitmap.height).roundToInt().coerceIn(1, (imageBitmap.height - srcY).coerceAtLeast(1))

            drawImage(
                image = imageBitmap,
                srcOffset = IntOffset(srcX, srcY),
                srcSize = IntSize(srcW, srcH),
                dstOffset = IntOffset.Zero,
                dstSize = IntSize(size.width.roundToInt(), size.height.roundToInt()),
            )

            // Exact pixel position of focusPoint within sourceRect for accurate reticle alignment
            val relX = ((focusPoint.x - sourceRect.left) / sourceRect.width.coerceAtLeast(1e-4f)).coerceIn(0f, 1f) * size.width
            val relY = ((focusPoint.y - sourceRect.top) / sourceRect.height.coerceAtLeast(1e-4f)).coerceIn(0f, 1f) * size.height

            drawLine(
                color = InTabColors.BrandIndigoSoftText.copy(alpha = 0.8f),
                start = Offset(relX, 0f),
                end = Offset(relX, size.height),
                strokeWidth = 1.5.dp.toPx(),
            )
            drawLine(
                color = InTabColors.BrandIndigoSoftText.copy(alpha = 0.8f),
                start = Offset(0f, relY),
                end = Offset(size.width, relY),
                strokeWidth = 1.5.dp.toPx(),
            )
            drawCircle(
                color = Color.White,
                radius = 4.dp.toPx(),
                center = Offset(relX, relY),
                style = Stroke(width = 1.5.dp.toPx()),
            )
        }
    }
}

@Composable
private fun CropUtilityChip(
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = InTabColors.DarkSurfaceVariant,
        border = BorderStroke(
            1.dp,
            if (enabled) InTabColors.DarkBorder else InTabColors.DarkBorder.copy(alpha = 0.4f),
        ),
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .clickable(enabled = enabled, onClick = onClick),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.padding(vertical = 9.dp, horizontal = 8.dp),
        ) {
            Text(
                text = label,
                color = if (enabled) InTabColors.DarkText else InTabColors.DarkTextMuted.copy(alpha = 0.4f),
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}
