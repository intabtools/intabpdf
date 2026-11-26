package org.intabtools.intabpdf.scanner.ui.camera

import android.content.Context
import android.os.SystemClock
import android.util.Log
import android.util.Size
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.ui.geometry.Offset
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.intabtools.intabpdf.scanner.data.ScannedPageSource
import org.intabtools.intabpdf.scanner.data.StillCaptureStore
import org.intabtools.intabpdf.scanner.imaging.OpenCvRuntime
import org.intabtools.intabpdf.scanner.vision.CameraUserHint
import org.intabtools.intabpdf.scanner.vision.CoordinateTransform
import org.intabtools.intabpdf.scanner.vision.DetectionMode
import org.intabtools.intabpdf.scanner.vision.DocumentDetector
import org.intabtools.intabpdf.scanner.vision.FrameQualityAnalyzer
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import org.intabtools.intabpdf.scanner.vision.OpenCvDocumentDetector
import org.intabtools.intabpdf.scanner.vision.QuadStabilizer
import org.intabtools.intabpdf.scanner.vision.StabilizerState
import org.opencv.core.CvType
import org.opencv.core.Mat
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

sealed interface CameraBindState {
    data object Idle : CameraBindState
    data object Binding : CameraBindState
    data object Ready : CameraBindState
    data class Unavailable(val reason: String) : CameraBindState
}

sealed interface CaptureFeedbackState {
    data object Idle : CaptureFeedbackState
    data class Capturing(val autoCaptured: Boolean) : CaptureFeedbackState
    data class Success(val pageCount: Int, val autoCaptured: Boolean, val detectionRecovered: Boolean) : CaptureFeedbackState
    data class Failure(val message: String) : CaptureFeedbackState
}

data class CameraUiState(
    val bindState: CameraBindState = CameraBindState.Idle,
    val hasFlashUnit: Boolean = false,
    val isTorchEnabled: Boolean = false,
    val autoCaptureEnabled: Boolean = true,
    val overlayQuad: NormalizedQuad? = null,
    val isQuadLocked: Boolean = false,
    val autoCaptureProgress: Float = 0f,
    val userHint: CameraUserHint = CameraUserHint.ALIGN_DOCUMENT,
    val analysisAspectRatio: Float = 3f / 4f,
    val capturedCount: Int = 0,
    val lastCapturedPage: ScannedPageSource? = null,
    val captureFeedback: CaptureFeedbackState = CaptureFeedbackState.Idle,
    val openCvAvailable: Boolean = true,
)

/**
 * Coordinates CameraX Preview, ImageAnalysis (OpenCV live detection + QuadStabilizer),
 * and full-resolution ImageCapture using thread-safe StateFlow emissions without touching JS.
 */
class CameraPreviewController(
    context: Context,
    initialAutoCaptureEnabled: Boolean = true,
    private val detector: DocumentDetector = OpenCvDocumentDetector(),
    private val captureStore: StillCaptureStore = StillCaptureStore(context.applicationContext, detector),
    private val onPagePersisted: ((source: ScannedPageSource, replacedPageId: String?) -> Unit)? = null,
) {
    private val appContext = context.applicationContext
    private val stabilizer = QuadStabilizer()
    private val qualityAnalyzer = FrameQualityAnalyzer()
    @Volatile
    private var pendingReplacePageId: String? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val analysisExecutor = Executors.newSingleThreadExecutor()
    private val captureExecutor = Executors.newSingleThreadExecutor()

    private val isShutdown = AtomicBoolean(false)
    private val isCaptureInFlight = AtomicBoolean(false)
    private var reusableRgbaBytes = ByteArray(0)
    private var reusableRowScratch = ByteArray(0)

    private val _uiState = MutableStateFlow(CameraUiState(autoCaptureEnabled = initialAutoCaptureEnabled))
    val uiState: StateFlow<CameraUiState> = _uiState.asStateFlow()

    private var cameraProvider: ProcessCameraProvider? = null
    private var boundCamera: Camera? = null
    private var previewView: PreviewView? = null
    private var imageCapture: ImageCapture? = null
    private var imageAnalysis: ImageAnalysis? = null
    private var cameraStateObserver: Observer<CameraState>? = null
    private var observedLifecycleOwner: LifecycleOwner? = null

    fun createPreviewView(): PreviewView {
        return PreviewView(appContext).apply {
            implementationMode = PreviewView.ImplementationMode.PERFORMANCE
            scaleType = PreviewView.ScaleType.FIT_CENTER
        }.also { view ->
            previewView = view
        }
    }

    fun setAutoCaptureEnabled(enabled: Boolean) {
        _uiState.update { it.copy(autoCaptureEnabled = enabled) }
    }

    fun setPendingReplacePageId(pageId: String?) {
        pendingReplacePageId = pageId
    }

    fun syncCapturedCount(count: Int) {
        _uiState.update { it.copy(capturedCount = count.coerceAtLeast(0)) }
    }

    fun clearCaptureFeedback() {
        _uiState.update { it.copy(captureFeedback = CaptureFeedbackState.Idle) }
    }

    fun bindToLifecycle(lifecycleOwner: LifecycleOwner) {
        if (isShutdown.get()) return
        if (lifecycleOwner.lifecycle.currentState == Lifecycle.State.DESTROYED) return
        val view = previewView ?: return
        val currentBind = _uiState.value.bindState
        if (currentBind is CameraBindState.Binding || currentBind is CameraBindState.Ready) return

        _uiState.update { it.copy(bindState = CameraBindState.Binding) }

        val future = ProcessCameraProvider.getInstance(appContext)
        future.addListener({
            if (isShutdown.get() || lifecycleOwner.lifecycle.currentState == Lifecycle.State.DESTROYED) {
                return@addListener
            }
            if (_uiState.value.bindState !is CameraBindState.Binding) {
                return@addListener
            }
            try {
                val provider = future.get()
                cameraProvider = provider

                val previewResolutionSelector = ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                    .build()

                val preview = Preview.Builder()
                    .setResolutionSelector(previewResolutionSelector)
                    .build()
                    .also { it.surfaceProvider = view.surfaceProvider }

                val analysisResolutionSelector = ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                    .setResolutionStrategy(
                        ResolutionStrategy(
                            Size(640, 480),
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER,
                        )
                    )
                    .build()

                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(analysisResolutionSelector)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                    .build()
                    .also { useCase ->
                        useCase.setAnalyzer(analysisExecutor) { imageProxy ->
                            processAnalysisFrame(imageProxy)
                        }
                    }
                imageAnalysis = analysis

                val captureResolutionSelector = ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                    .build()

                val capture = ImageCapture.Builder()
                    .setResolutionSelector(captureResolutionSelector)
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .build()
                imageCapture = capture

                provider.unbindAll()
                val camera = provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis,
                    capture,
                )
                attachCamera(camera, lifecycleOwner)
                _uiState.update { it.copy(bindState = CameraBindState.Ready) }
            } catch (ex: Exception) {
                Log.e(TAG, "Failed to bind CameraX use cases", ex)
                _uiState.update {
                    it.copy(
                        bindState = CameraBindState.Unavailable(
                            ex.localizedMessage ?: "Camera unavailable on this device."
                        )
                    )
                }
            }
        }, ContextCompat.getMainExecutor(appContext))
    }

    private fun processAnalysisFrame(imageProxy: ImageProxy) {
        try {
            if (isShutdown.get() || isCaptureInFlight.get()) return

            val openCvReady = OpenCvRuntime.ensureInitialized()
            if (!openCvReady) {
                _uiState.update { it.copy(openCvAvailable = false) }
                return
            }

            val rgbaMat = imageProxyRgbaToMat(imageProxy) ?: return
            try {
                analyzeAndStabilizeMat(
                    rgbaMat = rgbaMat,
                    rotationDegrees = imageProxy.imageInfo.rotationDegrees,
                    nowMs = SystemClock.elapsedRealtime(),
                    triggerCaptureIfReady = true,
                )
            } finally {
                rgbaMat.release()
            }
        } catch (ex: Throwable) {
            Log.w(TAG, "Error analyzing preview frame", ex)
        } finally {
            imageProxy.close()
        }
    }

    @androidx.annotation.VisibleForTesting
    internal fun analyzeAndStabilizeMat(
        rgbaMat: Mat,
        rotationDegrees: Int,
        nowMs: Long,
        triggerCaptureIfReady: Boolean = false,
    ): StabilizerState {
        val uprightDims = CoordinateTransform.rotatedDimensions(
            rawWidth = rgbaMat.cols(),
            rawHeight = rgbaMat.rows(),
            rotationDegrees = rotationDegrees,
        )
        val aspectRatio = uprightDims.width.toFloat() / uprightDims.height.coerceAtLeast(1).toFloat()

        val detection = detector.detect(rgbaMat, DetectionMode.LIVE_PREVIEW)
        val rotatedQuad = detection.normalizedQuad?.let {
            CoordinateTransform.rotateNormalizedQuad(it, rotationDegrees)
        }
        val quality = qualityAnalyzer.analyze(rgbaMat)

        val autoEnabled = _uiState.value.autoCaptureEnabled
        val stabilized = stabilizer.update(
            detectedQuad = rotatedQuad,
            confidence = detection.confidence,
            quality = quality,
            autoCaptureEnabled = autoEnabled,
            nowMs = nowMs,
        )

        _uiState.update { current ->
            current.copy(
                openCvAvailable = true,
                overlayQuad = stabilized.overlayQuad,
                isQuadLocked = stabilized.isLocked,
                autoCaptureProgress = stabilized.autoCaptureProgress,
                userHint = stabilized.userHint,
                analysisAspectRatio = aspectRatio,
            )
        }

        if (triggerCaptureIfReady && autoEnabled && stabilized.shouldTriggerAutoCapture) {
            captureStillPicture(autoCaptured = true, liveFallbackQuad = stabilized.overlayQuad)
        }
        return stabilized
    }

    @androidx.annotation.VisibleForTesting
    internal fun markCaptureTriggeredForTest(nowMs: Long, quad: NormalizedQuad?) {
        stabilizer.notifyCaptureTriggered(nowMs, quad)
    }

    private fun imageProxyRgbaToMat(imageProxy: ImageProxy): Mat? {
        val plane = imageProxy.planes.firstOrNull() ?: return null
        val width = imageProxy.width
        val height = imageProxy.height
        if (width <= 0 || height <= 0) return null

        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        val buffer: ByteBuffer = plane.buffer
        buffer.rewind()

        val tightRowBytes = width * 4
        val totalTightBytes = tightRowBytes * height
        if (reusableRgbaBytes.size != totalTightBytes) {
            reusableRgbaBytes = ByteArray(totalTightBytes)
        }

        if (pixelStride == 4 && rowStride == tightRowBytes) {
            buffer.get(reusableRgbaBytes, 0, totalTightBytes)
        } else {
            if (reusableRowScratch.size < rowStride) {
                reusableRowScratch = ByteArray(rowStride)
            }
            val rowScratch = reusableRowScratch
            for (row in 0 until height) {
                val remaining = buffer.remaining()
                val toRead = minOf(rowStride, remaining)
                if (toRead <= 0) break
                buffer.get(rowScratch, 0, toRead)
                val destOffset = row * tightRowBytes
                if (pixelStride == 4) {
                    System.arraycopy(rowScratch, 0, reusableRgbaBytes, destOffset, minOf(tightRowBytes, toRead))
                } else {
                    for (col in 0 until width) {
                        val srcIdx = col * pixelStride
                        val dstIdx = destOffset + col * 4
                        if (srcIdx + 3 < toRead) {
                            reusableRgbaBytes[dstIdx] = rowScratch[srcIdx]
                            reusableRgbaBytes[dstIdx + 1] = rowScratch[srcIdx + 1]
                            reusableRgbaBytes[dstIdx + 2] = rowScratch[srcIdx + 2]
                            reusableRgbaBytes[dstIdx + 3] = rowScratch[srcIdx + 3]
                        }
                    }
                }
            }
        }

        val mat = Mat(height, width, CvType.CV_8UC4)
        mat.put(0, 0, reusableRgbaBytes)
        return mat
    }

    fun captureManual() {
        captureStillPicture(autoCaptured = false, liveFallbackQuad = _uiState.value.overlayQuad)
    }

    private fun captureStillPicture(autoCaptured: Boolean, liveFallbackQuad: NormalizedQuad?) {
        val captureUseCase = imageCapture ?: return
        if (isShutdown.get()) return
        if (!isCaptureInFlight.compareAndSet(false, true)) return

        val triggerTimeMs = SystemClock.elapsedRealtime()
        val replacePageId = pendingReplacePageId
        pendingReplacePageId = null
        stabilizer.notifyCaptureTriggered(triggerTimeMs, liveFallbackQuad)
        _uiState.update {
            it.copy(
                captureFeedback = CaptureFeedbackState.Capturing(autoCaptured),
                autoCaptureProgress = 0f,
            )
        }

        val rawFile = captureStore.newTempRawCaptureFile()
        val outputOptions = ImageCapture.OutputFileOptions.Builder(rawFile).build()

        captureUseCase.takePicture(
            outputOptions,
            captureExecutor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    scope.launch {
                        try {
                            val saved = captureStore.saveFullResolutionCapture(
                                rawCapturedJpegFile = rawFile,
                                fallbackQuad = liveFallbackQuad,
                                autoCaptured = autoCaptured,
                                replacePageId = replacePageId,
                            )
                            val count = captureStore.currentPages().size
                            _uiState.update { state ->
                                state.copy(
                                    capturedCount = count,
                                    lastCapturedPage = saved,
                                    captureFeedback = CaptureFeedbackState.Success(
                                        pageCount = count,
                                        autoCaptured = autoCaptured,
                                        detectionRecovered = saved.detectionRecovered,
                                    ),
                                )
                            }
                            onPagePersisted?.invoke(saved, replacePageId)
                        } catch (ex: Exception) {
                            Log.e(TAG, "Failed to persist full-res capture", ex)
                            rawFile.delete()
                            _uiState.update {
                                it.copy(
                                    captureFeedback = CaptureFeedbackState.Failure(
                                        ex.localizedMessage ?: "Failed to process captured page."
                                    )
                                )
                            }
                        } finally {
                            isCaptureInFlight.set(false)
                        }
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    Log.e(TAG, "CameraX still capture failed: ${exception.message}", exception)
                    rawFile.delete()
                    isCaptureInFlight.set(false)
                    _uiState.update {
                        it.copy(
                            captureFeedback = CaptureFeedbackState.Failure(
                                exception.localizedMessage ?: "Capture failed. Please try again."
                            )
                        )
                    }
                }
            },
        )
    }

    private fun attachCamera(camera: Camera, lifecycleOwner: LifecycleOwner) {
        detachCameraObserver()
        boundCamera = camera
        val hasFlash = camera.cameraInfo.hasFlashUnit()
        _uiState.update { state ->
            state.copy(
                hasFlashUnit = hasFlash,
                isTorchEnabled = if (hasFlash) state.isTorchEnabled else false,
            )
        }

        val observer = Observer<CameraState> { state ->
            if (state.type == CameraState.Type.OPEN && _uiState.value.hasFlashUnit) {
                camera.cameraControl.enableTorch(_uiState.value.isTorchEnabled)
            }
        }
        camera.cameraInfo.cameraState.observe(lifecycleOwner, observer)
        cameraStateObserver = observer
        observedLifecycleOwner = lifecycleOwner
    }

    fun toggleTorch() {
        val camera = boundCamera ?: return
        if (!_uiState.value.hasFlashUnit) return
        val next = !_uiState.value.isTorchEnabled
        _uiState.update { it.copy(isTorchEnabled = next) }
        camera.cameraControl.enableTorch(next)
    }

    fun tapToFocus(tapOffset: Offset) {
        val view = previewView ?: return
        val camera = boundCamera ?: return
        val point = view.meteringPointFactory.createPoint(tapOffset.x, tapOffset.y)
        val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
            .setAutoCancelDuration(4, TimeUnit.SECONDS)
            .build()
        camera.cameraControl.startFocusAndMetering(action)
    }

    fun unbind() {
        detachCameraObserver()
        runCatching { imageAnalysis?.clearAnalyzer() }
        runCatching { cameraProvider?.unbindAll() }
        boundCamera = null
        imageAnalysis = null
        imageCapture = null
        if (!isShutdown.get()) {
            _uiState.update {
                it.copy(
                    bindState = CameraBindState.Idle,
                    overlayQuad = null,
                    isQuadLocked = false,
                    autoCaptureProgress = 0f,
                )
            }
        }
    }

    fun shutdown() {
        if (!isShutdown.compareAndSet(false, true)) return
        unbind()
        qualityAnalyzer.reset()
        stabilizer.reset()
        analysisExecutor.shutdown()
        captureExecutor.shutdown()
        scope.cancel()
    }

    private fun detachCameraObserver() {
        val existingObserver = cameraStateObserver
        val existingOwner = observedLifecycleOwner
        if (existingObserver != null && existingOwner != null) {
            boundCamera?.cameraInfo?.cameraState?.removeObserver(existingObserver)
        }
        cameraStateObserver = null
        observedLifecycleOwner = null
    }

    private companion object {
        const val TAG = "InTabCameraController"
    }
}
