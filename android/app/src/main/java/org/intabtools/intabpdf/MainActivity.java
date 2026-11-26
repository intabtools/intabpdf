package org.intabtools.intabpdf;

import android.content.Intent;
import android.database.Cursor;
import android.graphics.Outline;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.ViewTreeObserver;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import androidx.annotation.VisibleForTesting;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import org.intabtools.intabpdf.platform.ScreenAwakePlugin;
import org.intabtools.intabpdf.save.DocumentSavePlugin;
import org.intabtools.intabpdf.scanner.bridge.DocumentScannerPlugin;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity {
    static volatile boolean isProcessInitialized = false;
    private static volatile boolean hasPdfLaunchIntent = false;
    private static volatile String pendingPdfUri = null;
    private static volatile String pendingPdfName = null;
    private volatile boolean isWebUiReady = false;
    private WebViewListener startupWebViewListener = null;
    private FrameLayout splashOverlay = null;
    private boolean isHidingSplashOverlay = false;
    private Runnable pendingFallbackRemoval = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        isWebUiReady = false;
        isHidingSplashOverlay = false;

        registerPlugin(DocumentScannerPlugin.class);
        registerPlugin(DocumentSavePlugin.class);
        registerPlugin(ScreenAwakePlugin.class);
        super.onCreate(savedInstanceState);

        // Override Capacitor BridgeActivity's dark theme with the app's DayNight theme
        setTheme(org.intabtools.intabpdf.R.style.AppTheme_NoActionBar);
        applyInitialWindowColors();
        attachSplashOverlay();

        if (!isProcessInitialized) {
            isProcessInitialized = true;
            cleanStaleExternalLaunchPdf(getCacheDir());
        }
        handleIntent(getIntent());
        setupNativeBridge();
        setupStartupListeners();
    }

    static void cleanStaleExternalLaunchPdf(File cacheDir) {
        try {
            if (cacheDir != null) {
                File staleFile = new File(cacheDir, "external_launch.pdf");
                if (staleFile.exists() && staleFile.isFile()) {
                    staleFile.delete();
                }
            }
        } catch (Exception ignored) {
        }
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

    private void attachSplashOverlay() {
        ViewGroup content = findViewById(android.R.id.content);
        if (content == null) {
            return;
        }
        int splashBgColor = ContextCompat.getColor(this, org.intabtools.intabpdf.R.color.splash_background);
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(splashBgColor);
        overlay.setClickable(true);
        overlay.setFocusable(true);

        int iconSizePx = Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, 192f, getResources().getDisplayMetrics()
        ));
        ImageView iconView = new ImageView(this);
        iconView.setImageResource(org.intabtools.intabpdf.R.mipmap.ic_launcher);
        iconView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        iconView.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setOval(0, 0, view.getWidth(), view.getHeight());
            }
        });
        iconView.setClipToOutline(true);

        FrameLayout.LayoutParams iconParams = new FrameLayout.LayoutParams(
            iconSizePx,
            iconSizePx,
            Gravity.CENTER
        );
        overlay.addView(iconView, iconParams);
        content.addView(overlay, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        splashOverlay = overlay;
    }

    private void revealMainContentAfterHwuiCommit() {
        if (isWebUiReady || isHidingSplashOverlay) {
            return;
        }
        if (isFinishing() || isDestroyed()) {
            removeSplashOverlayImmediate();
            return;
        }
        isHidingSplashOverlay = true;
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null || splashOverlay == null) {
            removeSplashOverlayImmediate();
            return;
        }
        webView.invalidate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ViewTreeObserver observer = webView.getViewTreeObserver();
            if (observer.isAlive()) {
                observer.registerFrameCommitCallback(this::removeSplashOverlayImmediate);
                return;
            }
        }
        pendingFallbackRemoval = () -> {
            pendingFallbackRemoval = null;
            if (isFinishing() || isDestroyed()) {
                removeSplashOverlayImmediate();
                return;
            }
            WebView currentWebView = getBridge() != null ? getBridge().getWebView() : null;
            if (currentWebView == null) {
                removeSplashOverlayImmediate();
                return;
            }
            pendingFallbackRemoval = this::removeSplashOverlayImmediate;
            currentWebView.postOnAnimation(pendingFallbackRemoval);
        };
        webView.postOnAnimation(pendingFallbackRemoval);
    }

    private void removeSplashOverlayImmediate() {
        isWebUiReady = true;
        isHidingSplashOverlay = true;
        if (pendingFallbackRemoval != null) {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                webView.removeCallbacks(pendingFallbackRemoval);
            }
            pendingFallbackRemoval = null;
        }
        if (splashOverlay != null) {
            if (splashOverlay.getParent() instanceof ViewGroup parent) {
                parent.removeView(splashOverlay);
            }
            splashOverlay = null;
        }
    }

    private void setupNativeBridge() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new NativeIntentBridge(), "NativeIntent");
        } else {
            removeSplashOverlayImmediate();
        }
    }

    private void applyInitialWindowColors() {
        int bgColor = ContextCompat.getColor(this, org.intabtools.intabpdf.R.color.app_background);
        getWindow().getDecorView().setBackgroundColor(bgColor);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(bgColor);
        }
    }

    private void setupStartupListeners() {
        if (getBridge() == null) {
            removeSplashOverlayImmediate();
            return;
        }
        startupWebViewListener = new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                if (!isWebUiReady && getBridge() != null) {
                    String errorUrl = getBridge().getErrorUrl();
                    if (errorUrl != null && errorUrl.equals(webView.getUrl())) {
                        markInitialUiReadyAfterPaint();
                    }
                }
            }

            @Override
            public void onReceivedError(WebView webView) {
                if (!isWebUiReady) {
                    markInitialUiReadyAfterPaint();
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                removeSplashOverlayImmediate();
                return super.onRenderProcessGone(view, detail);
            }
        };
        getBridge().addWebViewListener(startupWebViewListener);
    }

    private void markInitialUiReadyAfterPaint() {
        if (isWebUiReady || isHidingSplashOverlay || isFinishing() || isDestroyed()) {
            removeSplashOverlayImmediate();
            return;
        }
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            removeSplashOverlayImmediate();
            return;
        }
        webView.postVisualStateCallback(0L, new WebView.VisualStateCallback() {
            @Override
            public void onComplete(long requestId) {
                revealMainContentAfterHwuiCommit();
            }
        });
    }

    @Override
    public void onDestroy() {
        if (getBridge() != null && startupWebViewListener != null) {
            getBridge().removeWebViewListener(startupWebViewListener);
            startupWebViewListener = null;
        }
        removeSplashOverlayImmediate();
        super.onDestroy();
    }

    @VisibleForTesting
    public boolean isWebUiReadyForTest() {
        return isWebUiReady;
    }

    @VisibleForTesting
    public boolean isSplashOverlayAttachedForTest() {
        return splashOverlay != null;
    }

    public class NativeIntentBridge {
        @JavascriptInterface
        public void notifyInitialUiReady() {
            runOnUiThread(() -> markInitialUiReadyAfterPaint());
        }

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
