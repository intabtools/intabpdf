package org.intabtools.intabpdf.scanner.ui.camera

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import org.intabtools.intabpdf.scanner.ui.theme.InTabColors
import org.intabtools.intabpdf.scanner.vision.CameraUserHint
import org.intabtools.intabpdf.scanner.vision.CoordinateTransform
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad

@Composable
fun CameraFoundationScreen(
    controller: CameraPreviewController,
    onClose: () -> Unit,
    sessionPageCount: Int = 0,
    isRetakeMode: Boolean = false,
    isImportingGallery: Boolean = false,
    canBindCamera: () -> Boolean = { true },
    onOpenGallery: () -> Unit = {},
    onOpenReview: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val uiState by controller.uiState.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current
    val haptics = LocalHapticFeedback.current
    var focusTapPoint by remember { mutableStateOf<Offset?>(null) }
    var showShutterFlash by remember { mutableStateOf(false) }

    LaunchedEffect(focusTapPoint) {
        if (focusTapPoint != null) {
            delay(1000L)
            focusTapPoint = null
        }
    }

    LaunchedEffect(uiState.captureFeedback) {
        when (uiState.captureFeedback) {
            is CaptureFeedbackState.Capturing -> {
                showShutterFlash = true
                delay(140L)
                showShutterFlash = false
            }

            is CaptureFeedbackState.Success,
            is CaptureFeedbackState.Failure -> {
                delay(2000L)
                controller.clearCaptureFeedback()
            }

            is CaptureFeedbackState.Idle -> Unit
        }
    }

    val latestIsImportingGallery by rememberUpdatedState(isImportingGallery)
    val latestCanBindCamera by rememberUpdatedState(canBindCamera)

    DisposableEffect(lifecycleOwner, controller) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && !latestIsImportingGallery && latestCanBindCamera()) {
                val bindState = controller.uiState.value.bindState
                if (bindState is CameraBindState.Idle || bindState is CameraBindState.Unavailable) {
                    controller.bindToLifecycle(lifecycleOwner)
                }
            } else if (event == Lifecycle.Event.ON_STOP) {
                controller.unbind()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            controller.unbind()
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(InTabColors.DarkBackground)
            .statusBarsPadding()
            .navigationBarsPadding(),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        // Top control bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Surface(
                shape = CircleShape,
                color = InTabColors.DarkSurface.copy(alpha = 0.85f),
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onClose)
                    .semantics { contentDescription = "Close scanner" },
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = "✕",
                        color = InTabColors.DarkText,
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
            }

            Surface(
                shape = RoundedCornerShape(999.dp),
                color = if (uiState.autoCaptureEnabled) {
                    InTabColors.BrandIndigoLight.copy(alpha = 0.28f)
                } else {
                    InTabColors.DarkSurface
                },
                border = BorderStroke(
                    width = 1.dp,
                    color = if (uiState.autoCaptureEnabled) InTabColors.BrandIndigoSoftText else InTabColors.DarkBorder,
                ),
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .clickable {
                        controller.setAutoCaptureEnabled(!uiState.autoCaptureEnabled)
                    },
            ) {
                Text(
                    text = if (uiState.autoCaptureEnabled) "Auto-Capture: ON" else "Auto-Capture: OFF",
                    color = InTabColors.DarkText,
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }

            if (uiState.hasFlashUnit) {
                Surface(
                    shape = CircleShape,
                    color = if (uiState.isTorchEnabled) {
                        InTabColors.BrandIndigoLight
                    } else {
                        InTabColors.DarkSurface.copy(alpha = 0.85f)
                    },
                    modifier = Modifier
                        .size(48.dp)
                        .clip(CircleShape)
                        .clickable { controller.toggleTorch() }
                        .semantics {
                            contentDescription = if (uiState.isTorchEnabled) "Turn off flash" else "Turn on flash"
                        },
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = "Flash",
                            color = Color.White.copy(alpha = if (uiState.isTorchEnabled) 1f else 0.72f),
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            } else {
                Spacer(modifier = Modifier.size(48.dp))
            }
        }

        // CameraX 4:3 Preview box with synchronized document boundary overlay & focus reticle
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(3f / 4f)
                    .background(Color.Black)
                    .pointerInput(controller) {
                        detectTapGestures { offset ->
                            focusTapPoint = offset
                            controller.tapToFocus(offset)
                        }
                    },
            ) {
                AndroidView(
                    factory = {
                        controller.createPreviewView().also {
                            if (!latestIsImportingGallery && latestCanBindCamera()) {
                                controller.bindToLifecycle(lifecycleOwner)
                            }
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )

                DocumentBoundaryOverlay(
                    targetQuad = uiState.overlayQuad,
                    isLocked = uiState.isQuadLocked,
                    imageAspectRatio = uiState.analysisAspectRatio,
                )

                FocusReticleOverlay(focusPoint = focusTapPoint)

                androidx.compose.animation.AnimatedVisibility(
                    visible = showShutterFlash,
                    enter = fadeIn(animationSpec = tween(40)),
                    exit = fadeOut(animationSpec = tween(120)),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(Color.White.copy(alpha = 0.35f)),
                    )
                }

                when (val state = uiState.bindState) {
                    is CameraBindState.Idle,
                    is CameraBindState.Binding -> {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(Color.Black.copy(alpha = 0.45f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(color = InTabColors.BrandIndigoLight)
                        }
                    }

                    is CameraBindState.Unavailable -> {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(Color.Black.copy(alpha = 0.85f))
                                .padding(24.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = "Camera preview unavailable",
                                    color = InTabColors.DarkText,
                                    style = MaterialTheme.typography.titleMedium,
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = state.reason,
                                    color = InTabColors.DarkTextMuted,
                                    textAlign = TextAlign.Center,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                Spacer(modifier = Modifier.height(16.dp))
                                OutlinedButton(onClick = { controller.bindToLifecycle(lifecycleOwner) }) {
                                    Text("Retry camera")
                                }
                            }
                        }
                    }

                    is CameraBindState.Ready -> Unit
                }

                val feedbackBannerText = when (val feedback = uiState.captureFeedback) {
                    is CaptureFeedbackState.Capturing -> if (feedback.autoCaptured) "Auto-capturing page…" else "Capturing full-res page…"
                    is CaptureFeedbackState.Success -> if (feedback.detectionRecovered) {
                        "Saved page ${feedback.pageCount} (border fallback — ready for crop later)"
                    } else {
                        "Saved full-res page ${feedback.pageCount}"
                    }
                    is CaptureFeedbackState.Failure -> feedback.message
                    is CaptureFeedbackState.Idle -> null
                }

                if (feedbackBannerText != null) {
                    Surface(
                        color = if (uiState.captureFeedback is CaptureFeedbackState.Failure) {
                            InTabColors.Danger.copy(alpha = 0.92f)
                        } else {
                            InTabColors.DarkSurface.copy(alpha = 0.92f)
                        },
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(bottom = 14.dp, start = 16.dp, end = 16.dp),
                    ) {
                        Text(
                            text = feedbackBannerText,
                            color = Color.White,
                            style = MaterialTheme.typography.bodySmall,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                }
            }
        }

        // Bottom control bar with Auto-Capture countdown ring & page counter
        Surface(
            color = InTabColors.DarkSurface,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 14.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = if (isRetakeMode) "Retaking page • Capture replacement" else hintMessage(uiState),
                    color = if (isRetakeMode) InTabColors.BrandIndigoSoftText else InTabColors.DarkTextMuted,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                )
                Spacer(modifier = Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Box(modifier = Modifier.size(width = 96.dp, height = 56.dp), contentAlignment = Alignment.CenterStart) {
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = InTabColors.DarkSurfaceVariant,
                            border = BorderStroke(1.dp, InTabColors.DarkBorder),
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .clickable(enabled = !isImportingGallery, onClick = onOpenGallery)
                                .semantics { contentDescription = "Import from gallery" },
                        ) {
                            Text(
                                text = if (isImportingGallery) "Loading…" else "Gallery",
                                color = InTabColors.DarkText,
                                style = MaterialTheme.typography.labelMedium,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            )
                        }
                    }

                    ShutterButtonWithProgress(
                        enabled = uiState.bindState is CameraBindState.Ready && uiState.captureFeedback !is CaptureFeedbackState.Capturing,
                        autoCaptureProgress = uiState.autoCaptureProgress,
                        onCapture = {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            controller.captureManual()
                        },
                    )

                    Box(modifier = Modifier.size(width = 96.dp, height = 56.dp), contentAlignment = Alignment.CenterEnd) {
                        val effectiveCount = maxOf(uiState.capturedCount, sessionPageCount)
                        if (effectiveCount > 0 && !isRetakeMode) {
                            Surface(
                                shape = RoundedCornerShape(999.dp),
                                color = InTabColors.BrandIndigoLight,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(999.dp))
                                    .clickable(onClick = onOpenReview)
                                    .semantics { contentDescription = "Review $effectiveCount pages" },
                            ) {
                                Text(
                                    text = "Review ($effectiveCount)",
                                    color = Color.White,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ShutterButtonWithProgress(
    enabled: Boolean,
    autoCaptureProgress: Float,
    onCapture: () -> Unit,
) {
    val animatedSweep by animateFloatAsState(
        targetValue = (autoCaptureProgress.coerceIn(0f, 1f)) * 360f,
        animationSpec = tween(durationMillis = 80),
        label = "autoCaptureRing",
    )

    Box(
        modifier = Modifier.size(80.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (animatedSweep > 1f) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                drawArc(
                    color = InTabColors.BrandIndigoSoftText,
                    startAngle = -90f,
                    sweepAngle = animatedSweep,
                    useCenter = false,
                    style = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round),
                )
            }
        }
        Box(
            modifier = Modifier
                .size(68.dp)
                .clip(CircleShape)
                .border(3.5.dp, Color.White, CircleShape)
                .padding(6.dp)
                .clip(CircleShape)
                .background(
                    if (enabled) InTabColors.BrandIndigoLight else InTabColors.DarkSurfaceVariant
                )
                .clickable(enabled = enabled, onClick = onCapture)
                .semantics { contentDescription = "Capture page" },
        )
    }
}

@Composable
private fun DocumentBoundaryOverlay(
    targetQuad: NormalizedQuad?,
    isLocked: Boolean,
    imageAspectRatio: Float,
) {
    var displayedQuad by remember { mutableStateOf<NormalizedQuad?>(null) }

    LaunchedEffect(targetQuad, isLocked) {
        if (targetQuad == null || !isLocked) {
            displayedQuad = null
            return@LaunchedEffect
        }
        if (displayedQuad == null) {
            displayedQuad = targetQuad
        }
        while (true) {
            val current = displayedQuad ?: targetQuad
            val alignedTarget = targetQuad.alignCornersTo(current)
            if (current.maxCornerDistance(alignedTarget) <= 0.0005f) {
                displayedQuad = alignedTarget
                break
            }
            displayedQuad = current.lerpTo(alignedTarget, 0.28f)
            withFrameNanos { }
        }
    }

    val quadToDraw = displayedQuad ?: return
    Canvas(modifier = Modifier.fillMaxSize()) {
        val pts = CoordinateTransform.mapQuadToFitCenterCanvas(
            quad = quadToDraw,
            imageAspectRatio = imageAspectRatio,
            canvasWidth = size.width,
            canvasHeight = size.height,
        )
        if (pts.size != 4) return@Canvas

        val path = Path().apply {
            moveTo(pts[0].x, pts[0].y)
            lineTo(pts[1].x, pts[1].y)
            lineTo(pts[2].x, pts[2].y)
            lineTo(pts[3].x, pts[3].y)
            close()
        }

        drawPath(
            path = path,
            color = InTabColors.BrandIndigoLight.copy(alpha = 0.14f),
        )
        drawPath(
            path = path,
            color = InTabColors.BrandIndigoSoftText,
            style = Stroke(width = 3.dp.toPx(), join = StrokeJoin.Round),
        )
        for (corner in pts) {
            drawCircle(
                color = Color.White,
                radius = 5.dp.toPx(),
                center = Offset(corner.x, corner.y),
            )
            drawCircle(
                color = InTabColors.BrandIndigoLight,
                radius = 3.dp.toPx(),
                center = Offset(corner.x, corner.y),
            )
        }
    }
}

private fun hintMessage(uiState: CameraUiState): String {
    if (!uiState.openCvAvailable) {
        return "Edge detection unavailable • Manual capture ready"
    }
    return when (uiState.userHint) {
        CameraUserHint.LOW_LIGHT -> "Low light • Turn on Flash or improve lighting"
        CameraUserHint.BLURRY_OR_MOVING -> "Hold phone steady for sharp edge lock"
        CameraUserHint.HOLD_STEADY -> if (uiState.autoCaptureEnabled) "Hold still • Auto-capturing…" else "Document locked • Tap shutter"
        CameraUserHint.LOCKED_READY -> "Document framed • Tap capture button"
        CameraUserHint.CAPTURING_NEXT_COOLDOWN -> "Captured • Shift page slightly for next auto-scan"
        CameraUserHint.ALIGN_DOCUMENT -> "Point camera at a document page"
    }
}

@Composable
private fun FocusReticleOverlay(focusPoint: Offset?) {
    val alpha by animateFloatAsState(
        targetValue = if (focusPoint != null) 1f else 0f,
        animationSpec = tween(durationMillis = 180),
        label = "focusReticleAlpha",
    )
    if (focusPoint == null || alpha <= 0.01f) return

    Canvas(modifier = Modifier.fillMaxSize()) {
        drawCircle(
            color = InTabColors.BrandIndigoSoftText.copy(alpha = alpha),
            radius = 34.dp.toPx(),
            center = focusPoint,
            style = Stroke(width = 2.dp.toPx()),
        )
    }
}

@Composable
fun CameraPermissionScreen(
    isPermanentlyDenied: Boolean,
    onRequestPermission: () -> Unit,
    onOpenSettings: () -> Unit,
    onClose: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(InTabColors.DarkBackground)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = "Camera access required",
            color = InTabColors.DarkText,
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "InTab PDF scans documents locally on your device. Grant camera permission to preview and capture pages.",
            color = InTabColors.DarkTextMuted,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
        )
        Spacer(modifier = Modifier.height(24.dp))
        if (isPermanentlyDenied) {
            Button(
                onClick = onOpenSettings,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Open App Settings")
            }
        } else {
            Button(
                onClick = onRequestPermission,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Allow Camera")
            }
        }
        Spacer(modifier = Modifier.height(12.dp))
        OutlinedButton(
            onClick = onClose,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Cancel")
        }
    }
}
