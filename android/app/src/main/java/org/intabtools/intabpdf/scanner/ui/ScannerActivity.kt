package org.intabtools.intabpdf.scanner.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.intabtools.intabpdf.scanner.data.ScanSessionController
import org.intabtools.intabpdf.scanner.data.ScannerLaunchOptions
import org.intabtools.intabpdf.scanner.data.ScannerPaths
import org.intabtools.intabpdf.scanner.data.ScannerRoute
import org.intabtools.intabpdf.scanner.data.StillCaptureStore
import org.intabtools.intabpdf.scanner.imaging.ScanBitmapLoader
import org.intabtools.intabpdf.scanner.pdf.PdfExportResult
import org.intabtools.intabpdf.scanner.ui.camera.CameraFoundationScreen
import org.intabtools.intabpdf.scanner.ui.camera.CameraPermissionScreen
import org.intabtools.intabpdf.scanner.ui.camera.CameraPreviewController
import org.intabtools.intabpdf.scanner.ui.crop.CropEditorScreen
import org.intabtools.intabpdf.scanner.ui.review.ReviewScreen
import org.intabtools.intabpdf.scanner.ui.theme.InTabScannerTheme
import org.intabtools.intabpdf.scanner.vision.OpenCvDocumentDetector
import java.util.UUID

/**
 * Native Kotlin scanner Activity hosted over Capacitor's WebView.
 * Coordinates Camera capture, Gallery import, Multi-Page Review, Filter Selection,
 * Crop & Perspective Editing, PDF export, and Activity recreation restoration.
 */
class ScannerActivity : ComponentActivity() {

    private lateinit var sessionId: String
    private lateinit var cameraController: CameraPreviewController
    private lateinit var sessionController: ScanSessionController
    private lateinit var bitmapLoader: ScanBitmapLoader
    private var hasCameraPermission by mutableStateOf(false)
    private var isPermissionPermanentlyDenied by mutableStateOf(false)
    private var hasRequestedPermissionOnce = false
    private var shouldDeleteSessionDirOnDestroy = false

    private val requestCameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
        isPermissionPermanentlyDenied =
            !granted && !ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.CAMERA)
    }

    private val pickGalleryImagesLauncher = registerForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(MAX_GALLERY_BATCH)
    ) { uris ->
        sessionController.importGalleryUris(uris)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val options = ScannerLaunchOptions.fromIntent(intent)
        sessionId = savedInstanceState?.getString(KEY_SESSION_ID) ?: UUID.randomUUID().toString()
        val autoCaptureInitial = savedInstanceState?.getBoolean(KEY_AUTO_CAPTURE, options.autoCaptureDefault)
            ?: options.autoCaptureDefault
        hasRequestedPermissionOnce = savedInstanceState?.getBoolean(KEY_ASKED_PERM, false) ?: false

        val detector = OpenCvDocumentDetector()
        val store = StillCaptureStore(applicationContext, detector, sessionId = sessionId)
        bitmapLoader = ScanBitmapLoader(applicationContext)
        sessionController = ScanSessionController(
            context = applicationContext,
            captureStore = store,
            launchOptions = options,
        )
        cameraController = CameraPreviewController(
            context = applicationContext,
            initialAutoCaptureEnabled = autoCaptureInitial,
            detector = detector,
            captureStore = store,
            onPagePersisted = { source, replacedPageId ->
                sessionController.onCameraPageCaptured(source, replacedPageId)
            },
        )

        if (savedInstanceState != null) {
            sessionController.restoreFromDisk(
                routeName = savedInstanceState.getString(KEY_ROUTE_NAME),
                cropPageId = savedInstanceState.getString(KEY_CROP_PAGE_ID),
                selectedPageIndex = savedInstanceState.getInt(KEY_SELECTED_INDEX, 0),
                applyFilterToAll = savedInstanceState.getBoolean(KEY_APPLY_ALL, false),
                retakeTargetPageId = savedInstanceState.getString(KEY_RETAKE_ID),
            )
        }

        refreshCameraPermissionState()

        if (!hasCameraPermission && !hasRequestedPermissionOnce) {
            hasRequestedPermissionOnce = true
            requestCameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    handleBackNavigation()
                }
            },
        )

        setContent {
            InTabScannerTheme(darkTheme = true) {
                val sessionState by sessionController.uiState.collectAsState()
                LaunchedEffect(sessionState.pages.size) {
                    cameraController.syncCapturedCount(sessionState.pages.size)
                }

                val exported = sessionState.completedExport
                LaunchedEffect(exported) {
                    if (exported != null) {
                        completeWithPdfResult(exported)
                    }
                }

                when (val route = sessionState.route) {
                    ScannerRoute.Camera -> {
                        if (hasCameraPermission) {
                            val controller = remember { cameraController }
                            CameraFoundationScreen(
                                controller = controller,
                                sessionPageCount = sessionState.pages.size,
                                isRetakeMode = sessionState.retakeTargetPageId != null,
                                isImportingGallery = sessionState.isImportingGallery,
                                onOpenGallery = ::launchGalleryPicker,
                                onOpenReview = { sessionController.openReview() },
                                onClose = { handleBackNavigation() },
                            )
                        } else {
                            CameraPermissionScreen(
                                isPermanentlyDenied = isPermissionPermanentlyDenied,
                                onRequestPermission = {
                                    requestCameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                                },
                                onOpenSettings = {
                                    val settingsIntent = Intent(
                                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                        Uri.fromParts("package", packageName, null),
                                    )
                                    startActivity(settingsIntent)
                                },
                                onClose = { cancelAndFinish() },
                            )
                        }
                    }

                    ScannerRoute.Review -> {
                        ReviewScreen(
                            uiState = sessionState,
                            bitmapLoader = bitmapLoader,
                            onAddFromCamera = {
                                cameraController.setPendingReplacePageId(null)
                                sessionController.openCameraForAddMore()
                            },
                            onImportGallery = ::launchGalleryPicker,
                            onSelectPage = { idx -> sessionController.selectPage(idx) },
                            onMoveSelectedLeft = { sessionController.moveSelectedPage(-1) },
                            onMoveSelectedRight = { sessionController.moveSelectedPage(1) },
                            onRotateSelected = { sessionController.rotateSelectedPage(90) },
                            onCropPage = { pageId -> sessionController.openCropEditor(pageId) },
                            onRetakePage = { pageId ->
                                cameraController.setPendingReplacePageId(pageId)
                                sessionController.beginRetakePage(pageId)
                            },
                            onDeletePage = { pageId -> sessionController.deletePage(pageId) },
                            onToggleApplyFilterToAll = { applyAll ->
                                sessionController.setApplyFilterToAll(applyAll)
                            },
                            onSelectFilter = { filter -> sessionController.selectFilter(filter) },
                            onExportPdf = { sessionController.exportPdf() },
                            onCancelExport = { sessionController.cancelPdfExport() },
                            onDismissExportError = { sessionController.dismissExportError() },
                            onCloseSession = { cancelAndFinish() },
                        )
                    }

                    is ScannerRoute.CropEditor -> {
                        val page = sessionState.pages.firstOrNull { it.pageId == route.pageId }
                        if (page == null) {
                            LaunchedEffect(Unit) { sessionController.closeCropEditorToReview() }
                        } else {
                            CropEditorScreen(
                                page = page,
                                bitmapLoader = bitmapLoader,
                                onCancel = { sessionController.closeCropEditorToReview() },
                                onApplyCrop = { newSourceQuad ->
                                    sessionController.applyCropQuad(page.pageId, newSourceQuad)
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        refreshCameraPermissionState()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::sessionId.isInitialized) {
            outState.putString(KEY_SESSION_ID, sessionId)
        }
        if (::cameraController.isInitialized) {
            outState.putBoolean(KEY_AUTO_CAPTURE, cameraController.uiState.value.autoCaptureEnabled)
        }
        if (::sessionController.isInitialized) {
            val s = sessionController.uiState.value
            val routeName = when (s.route) {
                ScannerRoute.Camera -> "camera"
                ScannerRoute.Review -> "review"
                is ScannerRoute.CropEditor -> "crop"
            }
            outState.putString(KEY_ROUTE_NAME, routeName)
            (s.route as? ScannerRoute.CropEditor)?.let {
                outState.putString(KEY_CROP_PAGE_ID, it.pageId)
            }
            outState.putInt(KEY_SELECTED_INDEX, s.selectedPageIndex)
            outState.putBoolean(KEY_APPLY_ALL, s.applyFilterToAll)
            outState.putString(KEY_RETAKE_ID, s.retakeTargetPageId)
        }
        outState.putBoolean(KEY_ASKED_PERM, hasRequestedPermissionOnce)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (
            hasCameraPermission &&
            sessionController.uiState.value.route is ScannerRoute.Camera &&
            (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)
        ) {
            cameraController.captureManual()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::sessionController.isInitialized) {
            sessionController.shutdown()
        }
        if (::cameraController.isInitialized) {
            cameraController.shutdown()
        }
        if (::bitmapLoader.isInitialized) {
            bitmapLoader.evictAll()
        }
        if (shouldDeleteSessionDirOnDestroy && !isChangingConfigurations && ::sessionId.isInitialized) {
            runCatching {
                ScannerPaths.sessionDir(applicationContext, sessionId).deleteRecursively()
            }
        }
    }

    private fun launchGalleryPicker() {
        pickGalleryImagesLauncher.launch(
            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
        )
    }

    private fun handleBackNavigation() {
        val state = sessionController.uiState.value
        if (state.isExportingPdf) {
            sessionController.cancelPdfExport()
            return
        }
        when (state.route) {
            is ScannerRoute.CropEditor -> sessionController.closeCropEditorToReview()
            is ScannerRoute.Review -> {
                cameraController.setPendingReplacePageId(null)
                sessionController.openCameraForAddMore()
            }
            is ScannerRoute.Camera -> {
                if (state.retakeTargetPageId != null) {
                    cameraController.setPendingReplacePageId(null)
                    sessionController.openReview()
                } else {
                    cancelAndFinish()
                }
            }
        }
    }

    private fun refreshCameraPermissionState() {
        hasCameraPermission = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA,
        ) == PackageManager.PERMISSION_GRANTED
        if (hasCameraPermission) {
            isPermissionPermanentlyDenied = false
        }
    }

    private fun completeWithPdfResult(exported: PdfExportResult) {
        shouldDeleteSessionDirOnDestroy = true
        val resultIntent = Intent().apply {
            putExtra(ScannerLaunchOptions.EXTRA_PDF_FILE_URL, Uri.fromFile(exported.outputFile).toString())
            putExtra(ScannerLaunchOptions.EXTRA_FILE_NAME, exported.fileName)
            putExtra(ScannerLaunchOptions.EXTRA_PAGE_COUNT, exported.pageCount)
            putExtra(ScannerLaunchOptions.EXTRA_SIZE_BYTES, exported.sizeBytes)
        }
        setResult(Activity.RESULT_OK, resultIntent)
        finish()
    }

    private fun cancelAndFinish() {
        shouldDeleteSessionDirOnDestroy = true
        setResult(Activity.RESULT_CANCELED)
        finish()
    }

    @androidx.annotation.VisibleForTesting
    internal fun currentUiStateForTest() = cameraController.uiState.value

    @androidx.annotation.VisibleForTesting
    internal fun currentSessionStateForTest() = sessionController.uiState.value

    @androidx.annotation.VisibleForTesting
    internal fun sessionControllerForTest() = sessionController

    private companion object {
        const val KEY_SESSION_ID = "scanner_session_id"
        const val KEY_AUTO_CAPTURE = "scanner_auto_capture"
        const val KEY_ASKED_PERM = "scanner_asked_permission"
        const val KEY_ROUTE_NAME = "scanner_route_name"
        const val KEY_CROP_PAGE_ID = "scanner_crop_page_id"
        const val KEY_SELECTED_INDEX = "scanner_selected_index"
        const val KEY_APPLY_ALL = "scanner_apply_all"
        const val KEY_RETAKE_ID = "scanner_retake_id"
        const val MAX_GALLERY_BATCH = 20
    }
}
