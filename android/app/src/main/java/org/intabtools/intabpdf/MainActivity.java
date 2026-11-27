package org.intabtools.intabpdf;

import android.content.Intent;
import android.content.res.Configuration;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.TypedValue;
import android.graphics.Rect;
import android.view.ActionMode;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import androidx.annotation.VisibleForTesting;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
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
    private static final Object EXTERNAL_LAUNCH_LOCK = new Object();
    private static volatile boolean hasPdfLaunchIntent = false;
    private static volatile String pendingPdfUri = null;
    private static volatile String pendingPdfName = null;
    private volatile boolean isWebUiReady = false;
    private volatile boolean isPdfSelectionActive = false;
    private boolean allowNextSelectAllPassThrough = false;
    private ActionMode activeWebViewActionMode = null;
    private ActionMode.Callback activeWebViewActionCallback = null;
    private ActionMode wrappedActionMode = null;
    private WebViewListener startupWebViewListener = null;
    private FrameLayout splashOverlay = null;
    private boolean isHidingSplashOverlay = false;
    private Runnable pendingFallbackRemoval = null;
    private Runnable pendingSplashBarSync = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        isWebUiReady = false;
        isPdfSelectionActive = false;
        isHidingSplashOverlay = false;

        registerPlugin(DocumentScannerPlugin.class);
        registerPlugin(DocumentSavePlugin.class);
        registerPlugin(ScreenAwakePlugin.class);
        super.onCreate(savedInstanceState);

        // Override Capacitor BridgeActivity's dark theme with the app's DayNight theme
        setTheme(org.intabtools.intabpdf.R.style.AppTheme_NoActionBar);
        handleIntent(getIntent());
        applyInitialWindowColors();
        attachSplashOverlay();

        if (!isProcessInitialized) {
            isProcessInitialized = true;
            if (!hasPdfLaunchIntent) {
                final File cacheDir = getCacheDir();
                Thread cleanupThread = new Thread(
                    () -> {
                        synchronized (EXTERNAL_LAUNCH_LOCK) {
                            cleanStaleExternalLaunchPdf(cacheDir);
                        }
                    },
                    "intab-cache-cleanup"
                );
                cleanupThread.setDaemon(true);
                cleanupThread.start();
            }
        }
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
        int iconSizePx = Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, 288f, getResources().getDisplayMetrics()
        ));
        ImageView iconView = new ImageView(this);
        iconView.setImageResource(org.intabtools.intabpdf.R.mipmap.ic_launcher_foreground);
        iconView.setScaleType(ImageView.ScaleType.FIT_CENTER);

        FrameLayout overlay = new FrameLayout(this) {
            @Override
            protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
                super.onLayout(changed, left, top, right, bottom);
                layoutSplashIconInWindowBounds(this, iconView);
            }
        };
        overlay.setBackgroundColor(splashBgColor);
        overlay.setClickable(true);
        overlay.setFocusable(true);

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
        reapplySplashSystemBarAppearanceIfActive();
        // Run after SystemBars.initSystemBars() main-thread setStyle() so bars stay on splash_background until reveal.
        pendingSplashBarSync = () -> {
            pendingSplashBarSync = null;
            reapplySplashSystemBarAppearanceIfActive();
        };
        overlay.post(pendingSplashBarSync);
    }

    private void layoutSplashIconInWindowBounds(View overlay, View iconView) {
        if (iconView.getVisibility() == View.GONE) {
            return;
        }
        View decorView = getWindow() != null ? getWindow().getDecorView() : null;
        if (decorView == null) {
            return;
        }
        int rootWidth = decorView.getWidth();
        int rootHeight = decorView.getHeight();
        if (rootWidth <= 0 || rootHeight <= 0) {
            return;
        }
        int offsetX = 0;
        int offsetY = 0;
        View current = overlay;
        while (current != null && current != decorView) {
            offsetX += current.getLeft();
            offsetY += current.getTop();
            Object parent = current.getParent();
            current = parent instanceof View ? (View) parent : null;
        }
        if (current != decorView) {
            return;
        }
        int iconW = iconView.getMeasuredWidth();
        int iconH = iconView.getMeasuredHeight();
        int targetLeft = Math.round((rootWidth - iconW) / 2f) - offsetX;
        int targetTop = Math.round((rootHeight - iconH) / 2f) - offsetY;
        iconView.layout(targetLeft, targetTop, targetLeft + iconW, targetTop + iconH);
    }

    private void reapplySplashSystemBarAppearanceIfActive() {
        if (splashOverlay == null || isHidingSplashOverlay || isFinishing() || isDestroyed()) {
            return;
        }
        int splashBgColor = ContextCompat.getColor(this, org.intabtools.intabpdf.R.color.splash_background);
        applySystemBarAppearance(splashBgColor, !isSystemNightMode());
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
            if (pendingSplashBarSync != null) {
                splashOverlay.removeCallbacks(pendingSplashBarSync);
                pendingSplashBarSync = null;
            }
            if (splashOverlay.getParent() instanceof ViewGroup parent) {
                parent.removeView(splashOverlay);
            }
            splashOverlay = null;
            int bgColor = ContextCompat.getColor(this, org.intabtools.intabpdf.R.color.app_background);
            applySystemBarAppearance(bgColor, !isSystemNightMode());
        }
        pendingSplashBarSync = null;
    }

    private boolean isSystemNightMode() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
    }

    private void applySystemBarAppearance(int barColor, boolean lightBars) {
        getWindow().getDecorView().setBackgroundColor(barColor);
        getWindow().setStatusBarColor(barColor);
        getWindow().setNavigationBarColor(barColor);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            getWindow(), getWindow().getDecorView()
        );
        if (controller != null) {
            controller.setAppearanceLightStatusBars(lightBars);
            controller.setAppearanceLightNavigationBars(lightBars);
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
        int splashBgColor = ContextCompat.getColor(this, org.intabtools.intabpdf.R.color.splash_background);
        getWindow().getDecorView().setBackgroundColor(splashBgColor);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(bgColor);
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (splashOverlay != null && !isHidingSplashOverlay) {
            reapplySplashSystemBarAppearanceIfActive();
        } else {
            int bgColor = ContextCompat.getColor(this, org.intabtools.intabpdf.R.color.app_background);
            applySystemBarAppearance(bgColor, !isSystemNightMode());
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
    public ActionMode onWindowStartingActionMode(ActionMode.Callback callback) {
        return super.onWindowStartingActionMode(wrapPdfActionModeCallback(callback));
    }

    @Override
    public ActionMode onWindowStartingActionMode(ActionMode.Callback callback, int type) {
        return super.onWindowStartingActionMode(wrapPdfActionModeCallback(callback), type);
    }

    private ActionMode.Callback wrapPdfActionModeCallback(ActionMode.Callback delegate) {
        if (delegate == null || delegate instanceof PdfAwareActionModeCallback) {
            return delegate;
        }
        return new PdfAwareActionModeCallback(delegate);
    }

    @Override
    public void onActionModeStarted(ActionMode mode) {
        super.onActionModeStarted(mode);
        activeWebViewActionMode = mode;
        attachSelectAllInterceptor(mode);
    }

    @Override
    public void onActionModeFinished(ActionMode mode) {
        super.onActionModeFinished(mode);
        if (activeWebViewActionMode == mode) {
            activeWebViewActionMode = null;
            activeWebViewActionCallback = null;
        }
        if (wrappedActionMode == mode) {
            wrappedActionMode = null;
        }
    }

    private void attachSelectAllInterceptor(ActionMode mode) {
        if (mode == null || mode.getMenu() == null || mode == wrappedActionMode) {
            return;
        }
        Menu menu = mode.getMenu();
        for (int i = 0; i < menu.size(); i++) {
            MenuItem item = menu.getItem(i);
            if (isSelectAllMenuItem(item)) {
                item.setOnMenuItemClickListener(clickedItem -> {
                    if (allowNextSelectAllPassThrough) {
                        allowNextSelectAllPassThrough = false;
                        return false;
                    }
                    return handleNativeSelectAllMenuAction(mode, clickedItem, activeWebViewActionCallback);
                });
            }
        }
    }

    private boolean handleNativeSelectAllMenuAction(
        ActionMode mode,
        MenuItem selectAllItem,
        ActionMode.Callback delegate
    ) {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            return false;
        }
        final int itemId = selectAllItem != null ? selectAllItem.getItemId() : 0;
        webView.evaluateJavascript(
            "(window.__intabHandleNativeSelectAll ? window.__intabHandleNativeSelectAll() : 'passthrough');",
            value -> {
                if ("\"handled\"".equals(value) || "\"restricted\"".equals(value)) {
                    // Selection was already scoped to the PDF text layer (or blocked by PDF permissions).
                    return;
                }
                if (isFinishing() || isDestroyed()) {
                    return;
                }
                passThroughNativeSelectAll(mode, itemId, delegate);
            }
        );
        return true;
    }

    private void passThroughNativeSelectAll(ActionMode mode, int itemId, ActionMode.Callback delegate) {
        if (mode == null) {
            return;
        }
        Menu menu = mode.getMenu();
        if (menu == null) {
            return;
        }
        MenuItem targetItem = itemId != 0 ? menu.findItem(itemId) : findSelectAllMenuItem(menu);
        allowNextSelectAllPassThrough = true;
        try {
            if (delegate != null && targetItem != null) {
                if (delegate.onActionItemClicked(mode, targetItem)) {
                    return;
                }
            }
            if (itemId != 0) {
                menu.performIdentifierAction(itemId, 0);
            }
        } finally {
            allowNextSelectAllPassThrough = false;
        }
    }

    private MenuItem findSelectAllMenuItem(Menu menu) {
        if (menu == null) return null;
        for (int i = 0; i < menu.size(); i++) {
            MenuItem candidate = menu.getItem(i);
            if (isSelectAllMenuItem(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    private final class PdfAwareActionModeCallback extends ActionMode.Callback2 {
        private final ActionMode.Callback delegate;

        PdfAwareActionModeCallback(ActionMode.Callback delegate) {
            this.delegate = delegate;
        }

        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            wrappedActionMode = mode;
            activeWebViewActionMode = mode;
            activeWebViewActionCallback = delegate;
            return delegate.onCreateActionMode(mode, menu);
        }

        @Override
        public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            wrappedActionMode = mode;
            activeWebViewActionMode = mode;
            activeWebViewActionCallback = delegate;
            return delegate.onPrepareActionMode(mode, menu);
        }

        @Override
        public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
            if (isSelectAllMenuItem(item) && !allowNextSelectAllPassThrough) {
                if (handleNativeSelectAllMenuAction(mode, item, delegate)) {
                    return true;
                }
            }
            return delegate.onActionItemClicked(mode, item);
        }

        @Override
        public void onDestroyActionMode(ActionMode mode) {
            delegate.onDestroyActionMode(mode);
            if (wrappedActionMode == mode) {
                wrappedActionMode = null;
            }
            if (activeWebViewActionCallback == delegate) {
                activeWebViewActionCallback = null;
            }
        }

        @Override
        public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
            if (delegate instanceof ActionMode.Callback2 callback2) {
                callback2.onGetContentRect(mode, view, outRect);
            } else {
                super.onGetContentRect(mode, view, outRect);
            }
        }
    }

    private boolean isSelectAllMenuItem(MenuItem item) {
        if (item == null) return false;
        if (item.getItemId() == android.R.id.selectAll) return true;
        CharSequence title = item.getTitle();
        if (title == null) return false;
        String titleText = title.toString().trim();
        String systemSelectAll = getString(android.R.string.selectAll);
        return titleText.equalsIgnoreCase(systemSelectAll) || "Select all".equalsIgnoreCase(titleText);
    }

    @Override
    public void onDestroy() {
        isPdfSelectionActive = false;
        activeWebViewActionMode = null;
        activeWebViewActionCallback = null;
        wrappedActionMode = null;
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
        public void setPdfSelectionActive(boolean active) {
            isPdfSelectionActive = active;
            if (active && activeWebViewActionMode != null) {
                runOnUiThread(() -> attachSelectAllInterceptor(activeWebViewActionMode));
            }
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
                synchronized (EXTERNAL_LAUNCH_LOCK) {
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
