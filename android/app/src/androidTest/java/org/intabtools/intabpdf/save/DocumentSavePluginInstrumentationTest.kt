package org.intabtools.intabpdf.save

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class DocumentSavePluginInstrumentationTest {

    @Test
    fun manifestQueriesTreePickerWithoutBroadStoragePermissionsAndExposesCapacitorPlugin() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val pm = context.packageManager

        @Suppress("DEPRECATION")
        val pkgInfo = pm.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
        val perms = pkgInfo.requestedPermissions?.toSet().orEmpty()
        assertFalse("Must not request READ_EXTERNAL_STORAGE", perms.contains(Manifest.permission.READ_EXTERNAL_STORAGE))
        assertFalse("Must not request WRITE_EXTERNAL_STORAGE", perms.contains(Manifest.permission.WRITE_EXTERNAL_STORAGE))
        assertFalse("Must not request MANAGE_EXTERNAL_STORAGE", perms.contains("android.permission.MANAGE_EXTERNAL_STORAGE"))

        // Verify system ACTION_OPEN_DOCUMENT_TREE handler resolves cleanly across API 24+ (with <queries> on API 30+)
        val treeIntent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                putExtra(
                    DocumentsContract.EXTRA_INITIAL_URI,
                    DocumentsContract.buildDocumentUri(
                        "com.android.externalstorage.documents",
                        "primary:Documents",
                    ),
                )
            }
        }
        val treeHandlers = pm.queryIntentActivities(treeIntent, PackageManager.MATCH_DEFAULT_ONLY)
        assertTrue("Expected Android DocumentsUI tree picker to handle ACTION_OPEN_DOCUMENT_TREE", treeHandlers.isNotEmpty())

        // Verify DocumentSave Capacitor plugin contract & methods without tearing down mid-boot WebView in CameraX process
        val pluginAnn = DocumentSavePlugin::class.java.getAnnotation(CapacitorPlugin::class.java)
        assertNotNull("Expected @CapacitorPlugin on DocumentSavePlugin", pluginAnn)
        assertEquals("DocumentSave", pluginAnn?.name)
        val methods = DocumentSavePlugin::class.java.methods
            .filter { it.getAnnotation(PluginMethod::class.java) != null }
            .map { it.name }
            .toSet()
        assertTrue(methods.contains("prepareSaveDestination"))
        assertTrue(methods.contains("writeToDestination"))
    }

    @Test
    fun safStoreAndGatewayValidatePermissionsAndBuildRealDocumentsContractUris() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = SharedPrefsSafDestinationStorage(context)
        store.clear()
        val gateway = AndroidSafTreeGateway(context)
        val repo = SafSaveRepository(
            storage = store,
            gateway = gateway,
            stagingDir = File(context.cacheDir, "saf-test-staging"),
            recoveryBackupDir = File(context.filesDir, "saf-test-recovery"),
        )

        // Fresh state with no persisted SAF grant requires folder selection
        assertEquals(DestinationCheckResult.NeedsSelection, repo.checkOrValidateDestination())

        // Stale/ungranted tree URI persisted in prefs triggers clean NeedsSelection + store reset
        val ungrantedUri = DocumentsContract.buildTreeDocumentUri(
            "com.android.externalstorage.documents",
            "primary:Documents/InTabPDF",
        )
        val folderDocUri = gateway.buildDocumentUriUsingTree(ungrantedUri.toString(), "primary:Documents/InTabPDF")
        store.save(
            PersistedSafDestination(
                treeUriString = ungrantedUri.toString(),
                folderUriString = folderDocUri,
                folderDocumentId = "primary:Documents/InTabPDF",
                folderDisplayName = "InTabPDF",
                displayPath = "Documents/InTabPDF",
            ),
        )
        assertEquals(DestinationCheckResult.NeedsSelection, repo.checkOrValidateDestination())
        assertEquals(null, store.load())

        // Verify real DocumentsContract document URI helper & strict display path mapping on Android runtime
        val docUriString = gateway.buildDocumentUriUsingTree(ungrantedUri.toString(), "primary:Documents/InTabPDF/test.pdf")
        val docUri = Uri.parse(docUriString)
        assertEquals("com.android.externalstorage.documents", docUri.authority)
        assertEquals("primary:Documents/InTabPDF", DocumentsContract.getTreeDocumentId(ungrantedUri))
        assertEquals("primary:Documents/InTabPDF/test.pdf", DocumentsContract.getDocumentId(docUri))
    }
}
