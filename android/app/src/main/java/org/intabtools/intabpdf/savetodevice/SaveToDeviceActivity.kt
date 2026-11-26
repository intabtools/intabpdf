package org.intabtools.intabpdf.savetodevice

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import org.intabtools.intabpdf.R
import org.intabtools.intabpdf.scanner.ui.theme.InTabColors
import org.intabtools.intabpdf.scanner.ui.theme.InTabScannerTheme

internal data class CreateDocumentRequest(
    val mimeType: String,
    val suggestedTitle: String,
)

internal class CreateDocumentWithMimeContract : ActivityResultContract<CreateDocumentRequest, Uri?>() {
    override fun createIntent(context: Context, input: CreateDocumentRequest): Intent {
        return Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(input.mimeType)
            .putExtra(Intent.EXTRA_TITLE, input.suggestedTitle)
    }

    override fun parseResult(resultCode: Int, intent: Intent?): Uri? {
        return if (resultCode == Activity.RESULT_OK) intent?.data else null
    }
}

/**
 * Native Android share target ("InTabPDF – Save to Device") allowing users to stream
 * any shared file(s) from another app directly into a system-chosen SAF location without
 * opening MainActivity or the PDF Viewer.
 */
class SaveToDeviceActivity : ComponentActivity() {

    private lateinit var viewModel: SaveToDeviceViewModel

    private val createSingleDocumentLauncher = registerForActivityResult(
        CreateDocumentWithMimeContract(),
    ) { destUri ->
        if (destUri == null) {
            viewModel.coordinator.onDestinationCancelled()
        } else {
            viewModel.coordinator.onSingleDestinationSelected(destUri)
        }
    }

    private val openDocumentTreeLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree(),
    ) { treeUri ->
        if (treeUri == null) {
            viewModel.coordinator.onDestinationCancelled()
        } else {
            viewModel.coordinator.onMultipleDestinationTreeSelected(treeUri)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        viewModel = ViewModelProvider(
            this,
            SaveToDeviceViewModel.Factory(application),
        )[SaveToDeviceViewModel::class.java]

        val parsedInput = AndroidShareSaveGateway.parseIncomingIntent(intent)
        viewModel.coordinator.initializeFromShare(parsedInput, intent?.type)

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val current = viewModel.coordinator.uiState.value
                    when (current) {
                        is SaveToDeviceUiState.Copying -> viewModel.coordinator.cancelActiveCopy()
                        is SaveToDeviceUiState.Success -> {
                            setResult(Activity.RESULT_OK)
                            finish()
                        }
                        else -> {
                            setResult(Activity.RESULT_CANCELED)
                            finish()
                        }
                    }
                }
            },
        )

        setContent {
            InTabScannerTheme {
                val state by viewModel.coordinator.uiState.collectAsState()

                LaunchedEffect(state) {
                    when (val current = state) {
                        is SaveToDeviceUiState.AwaitingDestination -> {
                            if (!viewModel.coordinator.hasLaunchedPicker) {
                                viewModel.coordinator.markPickerLaunched()
                                if (current.isMultiple) {
                                    openDocumentTreeLauncher.launch(null)
                                } else {
                                    val first = current.items.first()
                                    createSingleDocumentLauncher.launch(
                                        CreateDocumentRequest(
                                            mimeType = first.mimeType,
                                            suggestedTitle = first.displayName,
                                        ),
                                    )
                                }
                            }
                        }

                        is SaveToDeviceUiState.Success -> {
                            if (viewModel.coordinator.consumeCompletionToastFlag()) {
                                val toastText = if (current.savedFiles.size == 1 &&
                                    current.failedFiles.isEmpty() &&
                                    current.cancelledFiles.isEmpty()
                                ) {
                                    "Saved ${current.savedFiles.first().savedFileName}"
                                } else {
                                    "Saved ${current.savedFiles.size} file(s)"
                                }
                                Toast.makeText(this@SaveToDeviceActivity, toastText, Toast.LENGTH_SHORT).show()
                            }
                        }

                        SaveToDeviceUiState.Cancelled -> {
                            setResult(Activity.RESULT_CANCELED)
                            finish()
                        }

                        else -> Unit
                    }
                }

                SaveToDeviceScreen(
                    state = state,
                    onCancelCopy = { viewModel.coordinator.cancelActiveCopy() },
                    onRetryDestination = { viewModel.coordinator.retryDestinationSelection() },
                    onDone = {
                        setResult(Activity.RESULT_OK)
                        finish()
                    },
                    onDismissError = {
                        setResult(Activity.RESULT_CANCELED)
                        finish()
                    },
                )
            }
        }
    }
}

@Composable
internal fun SaveToDeviceScreen(
    state: SaveToDeviceUiState,
    onCancelCopy: () -> Unit,
    onRetryDestination: () -> Unit,
    onDone: () -> Unit,
    onDismissError: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(20.dp),
            contentAlignment = Alignment.Center,
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = 420.dp),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
                elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        text = stringResource(R.string.save_to_device_label),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                    )

                    when (state) {
                        SaveToDeviceUiState.Loading,
                        is SaveToDeviceUiState.AwaitingDestination,
                        -> {
                            Text(
                                text = "Choose a destination folder",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = if (state is SaveToDeviceUiState.AwaitingDestination && state.isMultiple) {
                                    "Preparing ${state.items.size} files. Select where to save them."
                                } else {
                                    "Opening Android system file picker…"
                                },
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End,
                            ) {
                                TextButton(onClick = onDismissError) {
                                    Text("Cancel")
                                }
                            }
                        }

                        is SaveToDeviceUiState.Copying -> {
                            Text(
                                text = if (state.totalCount > 1) {
                                    "Saving file ${state.currentIndex} of ${state.totalCount}"
                                } else {
                                    "Saving file…"
                                },
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = state.currentFileName,
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            val total = state.totalBytes
                            if (total != null && total > 0L) {
                                val fraction = (state.bytesCopied.toFloat() / total.toFloat()).coerceIn(0f, 1f)
                                LinearProgressIndicator(
                                    progress = { fraction },
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                Text(
                                    text = "${SharedFileMetadata.formatByteCount(state.bytesCopied)} / ${
                                        SharedFileMetadata.formatByteCount(total)
                                    }",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            } else {
                                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                                Text(
                                    text = "${SharedFileMetadata.formatByteCount(state.bytesCopied)} copied",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End,
                            ) {
                                OutlinedButton(onClick = onCancelCopy) {
                                    Text("Cancel")
                                }
                            }
                        }

                        is SaveToDeviceUiState.Success -> {
                            val totalAttempted = state.savedFiles.size +
                                state.failedFiles.size +
                                state.cancelledFiles.size
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                StatusBadgeIcon(isSuccess = true, tint = InTabColors.Success)
                                Text(
                                    text = when {
                                        state.savedFiles.size == 1 &&
                                            state.failedFiles.isEmpty() &&
                                            state.cancelledFiles.isEmpty() -> "Saved to device"
                                        state.failedFiles.isEmpty() && state.cancelledFiles.isEmpty() ->
                                            "Saved ${state.savedFiles.size} files"
                                        else -> "Saved ${state.savedFiles.size} of $totalAttempted files"
                                    },
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                            val summaryText = if (state.savedFiles.size == 1) {
                                "Saved: ${state.savedFiles.first().savedFileName} (${
                                    SharedFileMetadata.formatByteCount(state.totalBytesCopied)
                                })"
                            } else {
                                "Saved ${state.savedFiles.size} files (${
                                    SharedFileMetadata.formatByteCount(state.totalBytesCopied)
                                })"
                            }
                            Text(
                                text = summaryText,
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (state.failedFiles.isNotEmpty()) {
                                Text(
                                    text = "Failed (${state.failedFiles.size}): ${
                                        state.failedFiles.joinToString(", ") { "${it.displayName} (${it.reason})" }
                                    }",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                            if (state.cancelledFiles.isNotEmpty()) {
                                Text(
                                    text = "Cancelled (${state.cancelledFiles.size}): ${
                                        state.cancelledFiles.joinToString(", ")
                                    }",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if (state.cleanupFailedCount > 0) {
                                Text(
                                    text = "${state.cleanupFailedCount} incomplete file(s) could not be removed automatically.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                            if (state.rejectedCount > 0 || state.truncatedCount > 0) {
                                val notices = buildList {
                                    if (state.rejectedCount > 0) {
                                        add("${state.rejectedCount} unsupported item(s) skipped")
                                    }
                                    if (state.truncatedCount > 0) {
                                        add("${state.truncatedCount} item(s) over batch limit skipped")
                                    }
                                }
                                Text(
                                    text = notices.joinToString("; "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End,
                            ) {
                                Button(onClick = onDone) {
                                    Text("Done")
                                }
                            }
                        }

                        is SaveToDeviceUiState.Error -> {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                StatusBadgeIcon(
                                    isSuccess = false,
                                    tint = MaterialTheme.colorScheme.error,
                                )
                                Text(
                                    text = state.title,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                            Text(
                                text = state.message,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (!state.cleanupWarning.isNullOrBlank()) {
                                Text(
                                    text = state.cleanupWarning,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                            ) {
                                OutlinedButton(onClick = onDismissError) {
                                    Text("Close")
                                }
                                if (state.canRetryDestination) {
                                    Button(onClick = onRetryDestination) {
                                        Text("Try again")
                                    }
                                }
                            }
                        }

                        SaveToDeviceUiState.Cancelled -> {
                            Text(
                                text = "Cancelled",
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusBadgeIcon(isSuccess: Boolean, tint: Color) {
    Canvas(modifier = Modifier.size(28.dp)) {
        val strokeWidth = 2.4.dp.toPx()
        drawCircle(
            color = tint.copy(alpha = 0.14f),
        )
        if (isSuccess) {
            val checkPath = Path().apply {
                moveTo(size.width * 0.28f, size.height * 0.52f)
                lineTo(size.width * 0.44f, size.height * 0.67f)
                lineTo(size.width * 0.72f, size.height * 0.36f)
            }
            drawPath(
                path = checkPath,
                color = tint,
                style = Stroke(width = strokeWidth, cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        } else {
            drawLine(
                color = tint,
                start = Offset(size.width * 0.5f, size.height * 0.28f),
                end = Offset(size.width * 0.5f, size.height * 0.56f),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round,
            )
            drawCircle(
                color = tint,
                radius = strokeWidth * 0.65f,
                center = Offset(size.width * 0.5f, size.height * 0.70f),
            )
        }
    }
}
