package org.intabtools.intabpdf.save

import android.content.Context
import android.content.SharedPreferences

class SafTreeStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(): PersistedSafDestination? {
        val treeUri = prefs.getString(KEY_TREE_URI, null)?.takeIf { it.isNotBlank() } ?: return null
        val folderUri = prefs.getString(KEY_FOLDER_URI, null)?.takeIf { it.isNotBlank() } ?: return null
        val folderDocId = prefs.getString(KEY_FOLDER_DOC_ID, null)?.takeIf { it.isNotBlank() } ?: return null
        val folderName = prefs.getString(KEY_FOLDER_NAME, null)?.takeIf { it.isNotBlank() }
            ?: SafDocumentRules.TARGET_SUBFOLDER_NAME
        val displayPath = prefs.getString(KEY_DISPLAY_PATH, null)?.takeIf { it.isNotBlank() }
            ?: SafDocumentRules.BASE_DOCUMENTS_DISPLAY_PATH

        return PersistedSafDestination(
            treeUriString = treeUri,
            folderUriString = folderUri,
            folderDocumentId = folderDocId,
            folderDisplayName = folderName,
            displayPath = displayPath,
        )
    }

    fun save(destination: PersistedSafDestination) {
        prefs.edit()
            .putString(KEY_TREE_URI, destination.treeUriString)
            .putString(KEY_FOLDER_URI, destination.folderUriString)
            .putString(KEY_FOLDER_DOC_ID, destination.folderDocumentId)
            .putString(KEY_FOLDER_NAME, destination.folderDisplayName)
            .putString(KEY_DISPLAY_PATH, destination.displayPath)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val PREFS_NAME = "intabpdf_saf_save_prefs"
        private const val KEY_TREE_URI = "tree_uri"
        private const val KEY_FOLDER_URI = "folder_uri"
        private const val KEY_FOLDER_DOC_ID = "folder_doc_id"
        private const val KEY_FOLDER_NAME = "folder_name"
        private const val KEY_DISPLAY_PATH = "display_path"
    }
}
