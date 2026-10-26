package org.intabtools.intabpdf;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity {
    private static volatile boolean hasPdfLaunchIntent = false;
    private static volatile String pendingPdfUri = null;
    private static volatile String pendingPdfName = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
        setupNativeBridge();
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_VIEW.equals(action)) return;

        Uri uri = intent.getData();
        if (uri == null && intent.getClipData() != null && intent.getClipData().getItemCount() > 0) {
            uri = intent.getClipData().getItemAt(0).getUri();
        }

        if (uri != null) {
            hasPdfLaunchIntent = true;
            pendingPdfUri = uri.toString();
            pendingPdfName = queryDisplayName(uri);
        }
    }

    private String queryDisplayName(Uri uri) {
        String name = null;
        if ("content".equalsIgnoreCase(uri.getScheme())) {
            try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx != -1) {
                        name = cursor.getString(idx);
                    }
                }
            } catch (Exception ignored) {
            }
        }
        if (name == null || name.trim().isEmpty()) {
            String path = uri.getPath();
            if (path != null) {
                int lastSlash = path.lastIndexOf('/');
                if (lastSlash != -1 && lastSlash < path.length() - 1) {
                    name = path.substring(lastSlash + 1);
                }
            }
        }
        if (name == null || name.trim().isEmpty()) {
            name = "document.pdf";
        }
        if (!name.toLowerCase().endsWith(".pdf")) {
            name = name + ".pdf";
        }
        return name;
    }

    private void setupNativeBridge() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new NativeIntentBridge(), "NativeIntent");
        }
    }

    public class NativeIntentBridge {
        @JavascriptInterface
        public boolean hasPendingPdf() {
            return hasPdfLaunchIntent;
        }

        @JavascriptInterface
        public String getPendingPdf() {
            if (hasPdfLaunchIntent && pendingPdfUri != null) {
                hasPdfLaunchIntent = false;
                String uri = pendingPdfUri;
                pendingPdfUri = null;
                return uri;
            }
            return "";
        }

        @JavascriptInterface
        public void clearPendingPdf() {
            hasPdfLaunchIntent = false;
            pendingPdfUri = null;
            pendingPdfName = null;
            Intent mainIntent = new Intent(Intent.ACTION_MAIN);
            mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);
            setIntent(mainIntent);
        }

        @JavascriptInterface
        public synchronized String resolveNativePdf(String uriString) {
            JSONObject response = new JSONObject();
            try {
                if (uriString == null || uriString.trim().isEmpty()) {
                    response.put("success", false);
                    response.put("error", "Empty URI provided");
                    return response.toString();
                }

                Uri uri = Uri.parse(uriString);
                String displayName = queryDisplayName(uri);

                File cacheFile = new File(getCacheDir(), "external_launch.pdf");
                if (cacheFile.exists()) {
                    cacheFile.delete();
                }

                try (InputStream in = getContentResolver().openInputStream(uri);
                     OutputStream out = new FileOutputStream(cacheFile)) {
                    if (in == null) {
                        response.put("success", false);
                        response.put("error", "Could not open stream for URI: " + uriString);
                        return response.toString();
                    }

                    byte[] buf = new byte[65536];
                    int len;
                    while ((len = in.read(buf)) > 0) {
                        out.write(buf, 0, len);
                    }
                    out.flush();
                }

                response.put("success", true);
                response.put("name", displayName);
                response.put("fileUrl", Uri.fromFile(cacheFile).toString());
                return response.toString();
            } catch (Exception ex) {
                try {
                    response.put("success", false);
                    response.put("error", ex.getMessage() != null ? ex.getMessage() : ex.toString());
                } catch (Exception ignored) {
                }
                return response.toString();
            }
        }
    }
}
