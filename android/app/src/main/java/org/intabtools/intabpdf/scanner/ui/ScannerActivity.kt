package org.intabtools.intabpdf.scanner.ui

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.provider.Settings
import android.view.KeyEvent
import android.widget.Toast
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
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.intabtools.intabpdf.save.SafSaveOutcome
import org.intabtools.intabpdf.save.SafSaveRepository
import org.intabtools.intabpdf.scanner.data.PostExportAction
import org.intabtools.intabpdf.scanner.data.ScanSessionController
import org.intabtools.intabpdf.scanner.data.ScannerLaunchOptions
import org.intabtools.intabpdf.scanner.data.ScannerPaths
import org.intabtools.intabpdf.scanner.data.ScannerRoute
import org.intabtools.intabpdf.scanner.data.StillCaptureStore
import org.intabtools.intabpdf.scanner.imaging.ScanBitmapLoader
import org.intabtools.intabpdf.scanner.pdf.PdfExportResult
import org.intabtools.intabpdf.scanner.pdf.PdfScanExporter
import org.intabtools.intabpdf.scanner.ui.camera.CameraFoundationScreen
import org.intabtools.intabpdf.scanner.ui.camera.CameraPermissionScreen
import org.intabtools.intabpdf.scanner.ui.camera.CameraPreviewController
import org.intabtools.intabpdf.scanner.ui.crop.CropEditorScreen
import org.intabtools.intabpdf.scanner.ui.review.ReviewScreen
import org.intabtools.intabpdf.scanner.ui.review.SaveConflictPrompt
import org.intabtools.intabpdf.scanner.ui.theme.InTabScannerTheme
import org.intabtools.intabpdf.scanner.vision.OpenCvDocumentDetector
import java.io.File
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
    private lateinit var safSaveRepository: SafSaveRepository
    private var hasCameraPermission by mutableStateOf(false)
    private var isPermissionPermanentlyDenied by mutableStateOf(false)
    private var hasRequestedPermissionOnce = false
    private var shouldDeleteSessionDirOnDestroy = false
    private var isGalleryPickerOpen = false
    private var isCreateDocumentPickerOpen = false
    private var isShareSheetOpen = false
    private var isSavingToSaf by mutableStateOf(false)
    private var saveErrorMessage by mutableStateOf<String?>(null)
    private var saveConflictPrompt by mutableStateOf<SaveConflictPrompt?>(null)
    private var pendingSaveFilePath: String? = null
    private var pendingSaveFileName: String? = null

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
        isGalleryPickerOpen = false
        sessionController.importGalleryUris(uris)
    }

    private val createDocumentLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        isCreateDocumentPickerOpen = false
        val destUri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        handleCreateDocumentResult(destUri)
    }

    private val sharePdfLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        isShareSheetOpen = false
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
        safSaveRepository = SafSaveRepository.createDefault(applicationContext)
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
            pendingSaveFilePath = savedInstanceState.getString(KEY_PENDING_SAVE_PATH)
            pendingSaveFileName = savedInstanceState.getString(KEY_PENDING_SAVE_NAME)
            val conflictUri = savedInstanceState.getString(KEY_CONFLICT_URI)
            val conflictExisting = savedInstanceState.getString(KEY_CONFLICT_EXISTING)
            val conflictSuggested = savedInstanceState.getString(KEY_CONFLICT_SUGGESTED)
            if (!conflictUri.isNullOrBlank() && !conflictExisting.isNullOrBlank() && !conflictSuggested.isNullOrBlank()) {
                saveConflictPrompt = SaveConflictPrompt(
                    destUriString = conflictUri,
                    existingFileName = conflictExisting,
                    suggestedFileName = conflictSuggested,
                    replaceDisabledReason = savedInstanceState.getString(KEY_CONFLICT_REPLACE_REASON),
                )
            }
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
                        val action = sessionState.completedExportAction
                        sessionController.consumeCompletedExport()
                        when (action) {
                            PostExportAction.SAVE -> beginSafSavePicker(exported)
                            PostExportAction.SHARE -> launchShareSheet(exported)
                        }
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
                                canBindCamera = {
                                    !isGalleryPickerOpen &&
                                        !sessionController.uiState.value.isImportingGallery &&
                                        sessionController.uiState.value.route is ScannerRoute.Camera
                                },
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
                            onExportPdf = {
                                saveErrorMessage = null
                                sessionController.exportPdf(action = PostExportAction.SAVE)
                            },
                            onSharePdf = {
                                saveErrorMessage = null
                                sessionController.exportPdf(action = PostExportAction.SHARE)
                            },
                            onRetryExport = {
                                saveErrorMessage = null
                                sessionController.retryLastExport()
                            },
                            onCancelExport = { sessionController.cancelPdfExport() },
                            onDismissExportError = { sessionController.dismissExportError() },
                            onDismissStatusMessage = { sessionController.clearStatusMessage() },
                            onCloseSession = { cancelAndFinish() },
                            isSavingToSaf = isSavingToSaf,
                            saveErrorMessage = saveErrorMessage,
                            onDismissSaveError = { saveErrorMessage = null },
                            conflictPrompt = saveConflictPrompt,
                            onConflictSaveAsNewCopy = { handleConflictSaveAsNewCopy() },
                            onConflictReplace = { handleConflictReplace() },
                            onConflictCancel = { handleConflictCancel() },
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
        outState.putString(KEY_PENDING_SAVE_PATH, pendingSaveFilePath)
        outState.putString(KEY_PENDING_SAVE_NAME, pendingSaveFileName)
        saveConflictPrompt?.let { conflict ->
            outState.putString(KEY_CONFLICT_URI, conflict.destUriString)
            outState.putString(KEY_CONFLICT_EXISTING, conflict.existingFileName)
            outState.putString(KEY_CONFLICT_SUGGESTED, conflict.suggestedFileName)
            outState.putString(KEY_CONFLICT_REPLACE_REASON, conflict.replaceDisabledReason)
        }
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
        if (isGalleryPickerOpen || sessionController.uiState.value.isImportingGallery) return
        isGalleryPickerOpen = true
        runCatching {
            pickGalleryImagesLauncher.launch(
                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
            )
        }.onFailure {
            isGalleryPickerOpen = false
        }
    }

    private fun handleBackNavigation() {
        if (saveConflictPrompt != null) {
            handleConflictCancel()
            return
        }
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

    private fun beginSafSavePicker(exported: PdfExportResult) {
        clearPendingSaveFile()
        pendingSaveFilePath = exported.outputFile.absolutePath
        pendingSaveFileName = PdfScanExporter.sanitizePdfFileName(exported.fileName)
        launchCreateDocumentPicker(pendingSaveFileName!!)
    }

    private fun launchCreateDocumentPicker(suggestedTitle: String) {
        if (isCreateDocumentPickerOpen || isSavingToSaf) return
        val safeTitle = PdfScanExporter.sanitizePdfFileName(suggestedTitle)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/pdf"
            putExtra(Intent.EXTRA_TITLE, safeTitle)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                runCatching {
                    DocumentsContract.buildDocumentUri(
                        "com.android.externalstorage.documents",
                        "primary:Documents",
                    )
                }.getOrNull()?.let { initialUri ->
                    putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri)
                }
            }
        }
        isCreateDocumentPickerOpen = true
        runCatching {
            createDocumentLauncher.launch(intent)
        }.onFailure {
            isCreateDocumentPickerOpen = false
            clearPendingSaveFile()
            saveErrorMessage = "Could not open Android save picker."
        }
    }

    private fun handleCreateDocumentResult(destUri: Uri?) {
        if (destUri == null) {
            clearPendingSaveFile()
            saveConflictPrompt = null
            sessionController.setStatusMessage("Save cancelled")
            return
        }
        performSafUriSave(destUri, replaceExisting = false)
    }

    private fun handleConflictSaveAsNewCopy() {
        val prompt = saveConflictPrompt ?: return
        saveConflictPrompt = null
        launchCreateDocumentPicker(prompt.suggestedFileName)
    }

    private fun handleConflictReplace() {
        val prompt = saveConflictPrompt ?: return
        saveConflictPrompt = null
        performSafUriSave(Uri.parse(prompt.destUriString), replaceExisting = true)
    }

    private fun handleConflictCancel() {
        saveConflictPrompt = null
        clearPendingSaveFile()
        sessionController.setStatusMessage("Save cancelled")
    }

    private fun performSafUriSave(destUri: Uri, replaceExisting: Boolean) {
        val sourcePath = pendingSaveFilePath
        val sourceFile = sourcePath?.let(::File)
        if (sourceFile == null || !sourceFile.exists() || !sourceFile.isFile) {
            clearPendingSaveFile()
            saveConflictPrompt = null
            saveErrorMessage = "Generated PDF file is no longer available. Please retry."
            return
        }

        isSavingToSaf = true
        saveErrorMessage = null
        lifecycleScope.launch {
            val outcome = withContext(Dispatchers.IO) {
                val displayName = resolveDisplayNameBestEffort(destUri) ?: pendingSaveFileName
                safSaveRepository.saveLocalFileToDocumentUri(
                    sourceFile = sourceFile,
                    destUriString = destUri.toString(),
                    destDisplayName = displayName,
                    mimeType = "application/pdf",
                    replaceExisting = replaceExisting,
                )
            }
            isSavingToSaf = false
            when (outcome) {
                is SafSaveOutcome.Success -> {
                    clearPendingSaveFile()
                    saveConflictPrompt = null
                    val msg = if (outcome.replaced) {
                        "Replaced ${outcome.savedFileName}"
                    } else {
                        "Saved ${outcome.savedFileName}"
                    }
                    sessionController.setStatusMessage(msg)
                    Toast.makeText(this@ScannerActivity, msg, Toast.LENGTH_SHORT).show()
                }

                is SafSaveOutcome.ConflictDetected -> {
                    saveConflictPrompt = SaveConflictPrompt(
                        destUriString = destUri.toString(),
                        existingFileName = outcome.existingFileName,
                        suggestedFileName = outcome.suggestedFileName,
                    )
                }

                is SafSaveOutcome.ReplaceUnsupported -> {
                    saveConflictPrompt = SaveConflictPrompt(
                        destUriString = destUri.toString(),
                        existingFileName = outcome.existingFileName,
                        suggestedFileName = outcome.suggestedFileName,
                        replaceDisabledReason = outcome.reason,
                    )
                }

                is SafSaveOutcome.RecoveryFailed -> {
                    clearPendingSaveFile()
                    saveConflictPrompt = null
                    saveErrorMessage = outcome.errorMessage
                }

                is SafSaveOutcome.Failed -> {
                    clearPendingSaveFile()
                    saveConflictPrompt = null
                    saveErrorMessage = outcome.errorMessage
                }

                is SafSaveOutcome.NeedsFolderSelection -> {
                    clearPendingSaveFile()
                    saveConflictPrompt = null
                    saveErrorMessage = outcome.repromptMessage ?: "Could not access selected destination."
                }
            }
        }
    }

    private fun launchShareSheet(exported: PdfExportResult) {
        if (isShareSheetOpen) return
        isShareSheetOpen = true
        lifecycleScope.launch {
            try {
                val shareFile = withContext(Dispatchers.IO) {
                    PdfScanExporter.prepareShareablePdfFile(
                        outputDir = ScannerPaths.outputDir(applicationContext),
                        exported = exported,
                    )
                }
                val contentUri = FileProvider.getUriForFile(
                    this@ScannerActivity,
                    "$packageName.fileprovider",
                    shareFile,
                )
                val sendIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "application/pdf"
                    putExtra(Intent.EXTRA_STREAM, contentUri)
                    putExtra(Intent.EXTRA_SUBJECT, shareFile.name)
                    putExtra(Intent.EXTRA_TITLE, shareFile.name)
                    clipData = ClipData.newRawUri(shareFile.name, contentUri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val chooser = Intent.createChooser(sendIntent, "Share ${shareFile.name}").apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                sharePdfLauncher.launch(chooser)
            } catch (_: Throwable) {
                isShareSheetOpen = false
                sessionController.setStatusMessage("Could not open Android share sheet.")
                Toast.makeText(
                    this@ScannerActivity,
                    "Could not open Android share sheet.",
                    Toast.LENGTH_SHORT,
                ).show()
            }
        }
    }

    private fun resolveDisplayNameBestEffort(uri: Uri): String? {
        return try {
            applicationContext.contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0 && !cursor.isNull(idx)) cursor.getString(idx) else null
                } else {
                    null
                }
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun clearPendingSaveFile() {
        val path = pendingSaveFilePath
        pendingSaveFilePath = null
        pendingSaveFileName = null
        if (!path.isNullOrBlank()) {
            runCatching { File(path).delete() }
        }
    }

    private fun cancelAndFinish() {
        clearPendingSaveFile()
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
        const val KEY_PENDING_SAVE_PATH = "scanner_pending_save_path"
        const val KEY_PENDING_SAVE_NAME = "scanner_pending_save_name"
        const val KEY_CONFLICT_URI = "scanner_conflict_uri"
        const val KEY_CONFLICT_EXISTING = "scanner_conflict_existing"
        const val KEY_CONFLICT_SUGGESTED = "scanner_conflict_suggested"
        const val KEY_CONFLICT_REPLACE_REASON = "scanner_conflict_replace_reason"
        const val MAX_GALLERY_BATCH = 20
    }
}
