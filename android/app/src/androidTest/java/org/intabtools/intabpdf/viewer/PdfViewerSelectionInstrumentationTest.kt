package org.intabtools.intabpdf.viewer

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import android.webkit.WebView
import androidx.core.content.FileProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.intabtools.intabpdf.MainActivity
import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class PdfViewerSelectionInstrumentationTest {

    private fun createSamplePdf(context: Context): File {
        val dir = File(context.cacheDir, "viewer_test").apply { mkdirs() }
        val file = File(dir, "sample_selection.pdf")
        val doc = PdfDocument()

        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = 24f
        }

        val p1 = doc.startPage(PdfDocument.PageInfo.Builder(595, 842, 1).create())
        p1.canvas.drawColor(Color.WHITE)
        p1.canvas.drawText("Alpha ordinary sentence one", 60f, 140f, paint)
        p1.canvas.drawText("Café naïve résumé €100 αβγ", 60f, 195f, paint)
        p1.canvas.drawText("SearchTarget phrase ends here", 60f, 250f, paint)
        doc.finishPage(p1)

        val p2 = doc.startPage(PdfDocument.PageInfo.Builder(595, 842, 2).create())
        p2.canvas.drawColor(Color.WHITE)
        p2.canvas.drawText("SecondPage unique content SearchTarget", 60f, 140f, paint)
        doc.finishPage(p2)

        val p3 = doc.startPage(PdfDocument.PageInfo.Builder(595, 842, 3).create())
        p3.canvas.drawColor(Color.WHITE)
        p3.canvas.drawText("ThirdPage trailing text", 60f, 140f, paint)
        doc.finishPage(p3)

        val p4 = doc.startPage(PdfDocument.PageInfo.Builder(595, 842, 4).create())
        p4.canvas.drawColor(Color.WHITE)
        p4.canvas.drawText("FourthPage scrolled content line", 60f, 140f, paint)
        doc.finishPage(p4)

        val p5 = doc.startPage(PdfDocument.PageInfo.Builder(595, 842, 5).create())
        p5.canvas.drawColor(Color.WHITE)
        p5.canvas.drawText("FifthPage scrolled content line", 60f, 140f, paint)
        doc.finishPage(p5)

        val p6 = doc.startPage(PdfDocument.PageInfo.Builder(595, 842, 6).create())
        p6.canvas.drawColor(Color.WHITE)
        p6.canvas.drawText("SixthPage offscreen placeholder target €42", 60f, 140f, paint)
        doc.finishPage(p6)

        FileOutputStream(file).use { out -> doc.writeTo(out) }
        doc.close()
        return file
    }

    private fun evalJsSync(webView: WebView, script: String): String {
        val latch = CountDownLatch(1)
        val resultRef = AtomicReference<String>("")
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            webView.evaluateJavascript(script) { value ->
                resultRef.set(value ?: "null")
                latch.countDown()
            }
        }
        assertTrue("Timed out awaiting JS evaluation", latch.await(5, TimeUnit.SECONDS))
        return unquoteJsJsonString(resultRef.get())
    }

    private fun unquoteJsJsonString(raw: String): String {
        if (raw == "null" || raw == "undefined") return ""
        return try {
            JSONObject("{\"v\":$raw}").getString("v")
        } catch (_: Throwable) {
            raw.trim('"')
        }
    }

    private fun findAccessibilityNodeByText(root: AccessibilityNodeInfo?, vararg labels: String): AccessibilityNodeInfo? {
        if (root == null) return null
        val text = root.text?.toString()
        val desc = root.contentDescription?.toString()
        for (label in labels) {
            if (text.equals(label, ignoreCase = true) || desc.equals(label, ignoreCase = true)) {
                return root
            }
        }
        for (i in 0 until root.childCount) {
            val found = findAccessibilityNodeByText(root.getChild(i), *labels)
            if (found != null) return found
        }
        return null
    }

    private fun clickFloatingMenuAction(vararg labels: String): Boolean {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        automation.serviceInfo = automation.serviceInfo.apply {
            flags = flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
        val deadline = SystemClock.uptimeMillis() + 5_000L
        var overflowClicked = false
        while (SystemClock.uptimeMillis() < deadline) {
            for (window in automation.windows) {
                val root = window.root ?: continue
                val node = findAccessibilityNodeByText(root, *labels)
                if (node != null) {
                    var target: AccessibilityNodeInfo? = node
                    while (target != null && !target.isClickable) {
                        target = target.parent
                    }
                    if (target != null && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                        return true
                    }
                }
            }
            if (!overflowClicked) {
                for (window in automation.windows) {
                    val root = window.root ?: continue
                    val more = findAccessibilityNodeByText(root, "More options")
                    if (more != null) {
                        var target: AccessibilityNodeInfo? = more
                        while (target != null && !target.isClickable) {
                            target = target.parent
                        }
                        if (target != null && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                            overflowClicked = true
                            break
                        }
                    }
                }
            }
            SystemClock.sleep(100L)
        }
        val windowDump = automation.windows.joinToString(" | ") { w ->
            val texts = mutableListOf<String>()
            fun collect(n: AccessibilityNodeInfo?) {
                if (n == null) return
                n.text?.let { texts += it.toString() }
                n.contentDescription?.let { texts += "cd:$it" }
                for (i in 0 until n.childCount) collect(n.getChild(i))
            }
            collect(w.root)
            "w(type=${w.type},texts=${texts.take(15)})"
        }
        android.util.Log.i("PdfSelectionTest", "clickFloatingMenuAction(${labels.joinToString()}) failed; windows=$windowDump")
        return false
    }

    private fun longPressWebViewCssPoint(webView: WebView, cssX: Float, cssY: Float) {
        val density = webView.resources.displayMetrics.density
        val loc = IntArray(2)
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            webView.getLocationOnScreen(loc)
        }
        // WebView CSS coordinates -> View pixel coordinates via View scale
        val viewX = cssX * density
        val viewY = cssY * density
        val screenX = loc[0] + viewX
        val screenY = loc[1] + viewY

        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val downTime = SystemClock.uptimeMillis()
        val down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, screenX, screenY, 0)
        automation.injectInputEvent(down, true)
        down.recycle()

        SystemClock.sleep(750L)

        val up = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, screenX, screenY, 0)
        automation.injectInputEvent(up, true)
        up.recycle()
    }

    private fun dragWebViewCssSpan(
        webView: WebView,
        startCssX: Float,
        startCssY: Float,
        endCssX: Float,
        endCssY: Float,
    ) {
        val density = webView.resources.displayMetrics.density
        val loc = IntArray(2)
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            webView.getLocationOnScreen(loc)
        }
        val x1 = loc[0] + startCssX * density
        val y1 = loc[1] + startCssY * density
        val x2 = loc[0] + endCssX * density
        val y2 = loc[1] + endCssY * density

        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val downTime = SystemClock.uptimeMillis()
        val down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x1, y1, 0)
        automation.injectInputEvent(down, true)
        down.recycle()

        val steps = 6
        for (step in 1..steps) {
            SystemClock.sleep(25L)
            val t = step.toFloat() / steps
            val move = MotionEvent.obtain(
                downTime,
                SystemClock.uptimeMillis(),
                MotionEvent.ACTION_MOVE,
                x1 + (x2 - x1) * t,
                y1 + (y2 - y1) * t,
                0,
            )
            automation.injectInputEvent(move, true)
            move.recycle()
        }

        SystemClock.sleep(40L)
        val up = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x2, y2, 0)
        automation.injectInputEvent(up, true)
        up.recycle()
    }

    private fun readClipboardText(context: Context): String {
        var clipText = ""
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipText = cm.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty()
        }
        return clipText
    }

    private fun assertNoHeaderOrChromeText(label: String, text: String) {
        assertFalse("$label must NOT contain 'InTabPDF', got: $text", text.contains("InTabPDF"))
        assertFalse("$label must NOT contain header 'InTab', got: $text", text.contains("InTab"))
        assertFalse("$label must NOT contain header 'PDF', got: $text", text.contains("PDF"))
        assertFalse("$label must NOT contain 'Search tools' UI text, got: $text", text.contains("Search tools"))
    }

    private fun launchPdfAndWaitForTextLayer(context: Context): Pair<ActivityScenario<MainActivity>, WebView> {
        val pdfFile = createSamplePdf(context)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", pdfFile)
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            setDataAndType(uri, "application/pdf")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        val scenario = ActivityScenario.launch<MainActivity>(intent)
        val webViewRef = AtomicReference<WebView?>(null)
        val readyDeadline = SystemClock.uptimeMillis() + 15_000L
        while (SystemClock.uptimeMillis() < readyDeadline) {
            var uiReady = false
            scenario.onActivity { activity ->
                if (activity.isWebUiReadyForTest() && !activity.isSplashOverlayAttachedForTest()) {
                    webViewRef.compareAndSet(null, activity.bridge?.webView)
                    uiReady = true
                }
            }
            if (uiReady && webViewRef.get() != null) break
            SystemClock.sleep(100L)
        }
        assertNotNull("Timed out waiting for WebView to become ready", webViewRef.get())
        SystemClock.sleep(800L)

        val deadline = SystemClock.uptimeMillis() + 20_000L
        var readyText = ""
        val wv = webViewRef.get()!!
        while (SystemClock.uptimeMillis() < deadline) {
            val res = evalJsSync(
                wv,
                """
                (function() {
                  var spans = document.querySelectorAll('.pg-item[data-page="1"] .textLayer span');
                  if (!spans || spans.length === 0) return '';
                  return Array.from(spans).map(function(s){ return s.textContent || ''; }).join(' ');
                })()
                """.trimIndent()
            )
            if (res.contains("Alpha") && res.contains("Café")) {
                readyText = res
                break
            }
            SystemClock.sleep(250L)
        }
        assertTrue("Timed out waiting for PDF textLayer; got='$readyText'", readyText.contains("Alpha"))
        return scenario to wv
    }

    @Test
    fun nativeAndroidSelectAllAndCopyExcludesInTabPdfLogoAndChromeAndPreservesUnicode() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val (scenario, webView) = launchPdfAndWaitForTextLayer(context)
        try {
            // Confirm header logo exists in the viewer DOM
            val headerLogo = evalJsSync(webView, "document.querySelector('.hdr .hb')?.textContent || ''")
            assertTrue("Expected header brand to exist in viewer DOM, got '$headerLogo'", headerLogo.contains("InTab"))

            // Locate the first word in page 1 textLayer
            val coordsJson = evalJsSync(
                webView,
                """
                (function() {
                  var spans = document.querySelectorAll('.pg-item[data-page="1"] .textLayer span');
                  for (var i = 0; i < spans.length; i++) {
                    if ((spans[i].textContent || '').indexOf('Alpha') !== -1) {
                      var r = spans[i].getBoundingClientRect();
                      return JSON.stringify({ x: r.left + Math.min(20, r.width * 0.25), y: r.top + r.height * 0.5 });
                    }
                  }
                  return '';
                })()
                """.trimIndent()
            )
            assertTrue("Expected coordinates for Alpha span, got '$coordsJson'", coordsJson.isNotEmpty())
            val pt = JSONObject(coordsJson)

            longPressWebViewCssPoint(webView, pt.getDouble("x").toFloat(), pt.getDouble("y").toFloat())
            SystemClock.sleep(500L)

            // Word selection should work and React duplicate toolbar must NOT exist
            val reactMenuCount = evalJsSync(webView, "String(document.querySelectorAll('.viewer-selection-menu').length)")
            assertTrue("Duplicate React menu must not be rendered, count=$reactMenuCount", reactMenuCount == "0")

            val initialSel = evalJsSync(webView, "window.getSelection()?.toString() || ''")
            assertTrue("Expected long-press to select a word, got '$initialSel'", initialSel.isNotBlank())

            // Tap native Android floating ActionMode "Select all"
            val clickedSelectAll = clickFloatingMenuAction("Select all", "Select All")
            assertTrue("Expected native Android Select all ActionMode button", clickedSelectAll)
            SystemClock.sleep(400L)

            val afterSelectAll = evalJsSync(webView, "window.getSelection()?.toString() || ''")
            assertNoHeaderOrChromeText("Selection after Select All", afterSelectAll)
            assertFalse("Selection after Select All must NOT include offscreen placeholder text like 'Page 6', got: $afterSelectAll", afterSelectAll.contains("Page 6"))
            assertFalse("Page-scoped Select All must stay on Page 1 rather than pulling Page 2, got: $afterSelectAll", afterSelectAll.contains("SecondPage"))
            assertTrue("Expected ordinary PDF text in Select All, got: $afterSelectAll", afterSelectAll.contains("Alpha ordinary sentence one"))
            assertTrue("Expected Unicode PDF text preserved in Select All, got: $afterSelectAll", afterSelectAll.contains("Café") && afterSelectAll.contains("€100") && afterSelectAll.contains("αβγ"))
            val alphaIdx = afterSelectAll.indexOf("Alpha")
            val cafeIdx = afterSelectAll.indexOf("Café")
            val searchIdx = afterSelectAll.indexOf("SearchTarget")
            assertTrue("Expected correct reading order in Select All: alpha=$alphaIdx, cafe=$cafeIdx, search=$searchIdx", alphaIdx in 0 until cafeIdx && cafeIdx < searchIdx)

            // Confirm selection bounds and endpoints stay strictly inside .vwr .textLayer below header branding
            val boundsCheck = evalJsSync(
                webView,
                """
                (function() {
                  var sel = window.getSelection();
                  if (!sel || sel.rangeCount === 0) return 'none';
                  var r = sel.getRangeAt(0);
                  var hdrRect = document.querySelector('.hdr')?.getBoundingClientRect();
                  var selRect = r.getBoundingClientRect();
                  var anchorEl = sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
                  var focusEl = sel.focusNode ? (sel.focusNode.nodeType === 1 ? sel.focusNode : sel.focusNode.parentElement) : null;
                  var startEl = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
                  var endEl = r.endContainer.nodeType === 1 ? r.endContainer : r.endContainer.parentElement;
                  var aOk = !!(anchorEl && anchorEl.closest('.pg-item[data-page="1"] .textLayer'));
                  var fOk = !!(focusEl && focusEl.closest('.pg-item[data-page="1"] .textLayer'));
                  var sOk = !!(startEl && startEl.closest('.pg-item[data-page="1"] .textLayer') && startEl.tagName !== 'BR' && !startEl.closest('.endOfContent'));
                  var eOk = !!(endEl && endEl.closest('.pg-item[data-page="1"] .textLayer') && endEl.tagName !== 'BR' && !endEl.closest('.endOfContent'));
                  var belowHdr = !hdrRect || selRect.top >= hdrRect.bottom - 1;
                  return aOk + ':' + fOk + ':' + sOk + ':' + eOk + ':' + belowHdr;
                })()
                """.trimIndent()
            )
            assertTrue("Selection must stay strictly inside page 1 .textLayer below header, got $boundsCheck", boundsCheck == "true:true:true:true:true")

            // Verify CSS suppresses left-edge <br>::selection artifacts
            val brSelectionBg = evalJsSync(
                webView,
                """
                (function() {
                  var br = document.querySelector('.pg-item[data-page="1"] .textLayer br');
                  if (!br) return 'transparent-none';
                  return getComputedStyle(br, '::selection').backgroundColor || '';
                })()
                """.trimIndent()
            )
            assertTrue("Expected transparent <br>::selection background, got '$brSelectionBg'", brSelectionBg == "transparent-none" || brSelectionBg.contains("0, 0, 0, 0") || brSelectionBg == "transparent")

            // Tap native Copy and verify ClipboardManager contains ONLY PDF text
            val clickedCopy = clickFloatingMenuAction("Copy")
            assertTrue("Expected native Android Copy ActionMode button", clickedCopy)
            SystemClock.sleep(300L)

            val clipText = readClipboardText(context)
            assertNotNull(clipText)
            assertNoHeaderOrChromeText("Copied clipboard text", clipText)
            assertFalse("Copied clipboard text must NOT contain placeholder text, got: $clipText", clipText.contains("Page 6"))
            assertTrue("Copied clipboard text must contain PDF ordinary & Unicode text in reading order, got: $clipText", clipText.contains("Alpha ordinary sentence one") && clipText.contains("Café") && clipText.contains("€100") && clipText.contains("αβγ"))
            val clipAlpha = clipText.indexOf("Alpha")
            val clipCafe = clipText.indexOf("Café")
            val clipSearch = clipText.indexOf("SearchTarget")
            assertTrue("Expected clipboard reading order: alpha=$clipAlpha, cafe=$clipCafe, search=$clipSearch", clipAlpha in 0 until clipCafe && clipCafe < clipSearch)
        } finally {
            scenario.close()
        }
    }

    @Test
    fun offscreenPlaceholderScrollThenNativeSelectAllAndCopyExcludesBrandingAndPlaceholders() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val (scenario, webView) = launchPdfAndWaitForTextLayer(context)
        try {
            // Scroll to Page 6 so Page 1 unmounts to an offscreen .pg-placeholder
            evalJsSync(webView, "document.querySelector('.pg-item[data-page=\"6\"]')?.scrollIntoView(); 'ok'")
            var p6Ready = false
            val waitDeadline = SystemClock.uptimeMillis() + 12_000L
            while (SystemClock.uptimeMillis() < waitDeadline) {
                val status = evalJsSync(
                    webView,
                    """
                    (function() {
                      var p1HasPlaceholder = !!document.querySelector('.pg-item[data-page="1"] .pg-placeholder');
                      var p1HasTextLayer = !!document.querySelector('.pg-item[data-page="1"] .textLayer');
                      var p6Text = Array.from(document.querySelectorAll('.pg-item[data-page="6"] .textLayer span')).map(function(s){ return s.textContent || ''; }).join(' ');
                      return JSON.stringify({ p1HasPlaceholder: p1HasPlaceholder, p1HasTextLayer: p1HasTextLayer, p6Text: p6Text });
                    })()
                    """.trimIndent()
                )
                if (status.isNotEmpty()) {
                    val obj = JSONObject(status)
                    if (obj.optBoolean("p1HasPlaceholder") && !obj.optBoolean("p1HasTextLayer") && obj.optString("p6Text").contains("SixthPage")) {
                        p6Ready = true
                        break
                    }
                }
                SystemClock.sleep(200L)
            }
            assertTrue("Expected Page 1 placeholder and rendered Page 6 textLayer", p6Ready)

            val p6Coords = evalJsSync(
                webView,
                """
                (function() {
                  var spans = document.querySelectorAll('.pg-item[data-page="6"] .textLayer span');
                  for (var i = 0; i < spans.length; i++) {
                    if ((spans[i].textContent || '').indexOf('SixthPage') !== -1) {
                      var r = spans[i].getBoundingClientRect();
                      return JSON.stringify({ x: r.left + Math.min(20, r.width * 0.25), y: r.top + r.height * 0.5 });
                    }
                  }
                  return '';
                })()
                """.trimIndent()
            )
            assertTrue("Expected coordinates for SixthPage span, got '$p6Coords'", p6Coords.isNotEmpty())
            val pt = JSONObject(p6Coords)

            longPressWebViewCssPoint(webView, pt.getDouble("x").toFloat(), pt.getDouble("y").toFloat())
            SystemClock.sleep(500L)

            val clickedSelectAll = clickFloatingMenuAction("Select all", "Select All")
            assertTrue("Expected native Android Select all on Page 6", clickedSelectAll)
            SystemClock.sleep(400L)

            val selectedP6 = evalJsSync(webView, "window.getSelection()?.toString() || ''")
            assertNoHeaderOrChromeText("Page 6 Select All", selectedP6)
            assertFalse("Page 6 Select All must NOT include Page 1 placeholder text, got: $selectedP6", selectedP6.contains("Page 1"))
            assertTrue("Expected Page 6 text selected, got: $selectedP6", selectedP6.contains("SixthPage offscreen placeholder target €42"))

            val clickedCopy = clickFloatingMenuAction("Copy")
            assertTrue("Expected native Copy after Page 6 Select All", clickedCopy)
            SystemClock.sleep(300L)

            val clipText = readClipboardText(context)
            assertNoHeaderOrChromeText("Page 6 Clipboard", clipText)
            assertFalse("Page 6 Clipboard must NOT contain Page 1 placeholder, got: $clipText", clipText.contains("Page 1"))
            assertTrue("Page 6 Clipboard must contain Page 6 text, got: $clipText", clipText.contains("SixthPage offscreen placeholder target €42"))
        } finally {
            scenario.close()
        }
    }

    @Test
    fun wordMultiLineAndSearchWithSelectionExcludeLogoAndWorkTogether() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val (scenario, webView) = launchPdfAndWaitForTextLayer(context)
        try {
            // 1. Verify individual word and multi-line selection within page 1 spans
            val singleWordSelected = evalJsSync(
                webView,
                """
                (function() {
                  var span = Array.from(document.querySelectorAll('.pg-item[data-page="1"] .textLayer span'))
                    .find(function(s){ return (s.textContent || '').indexOf('Alpha') !== -1; });
                  if (!span || !span.firstChild) return '';
                  var sel = window.getSelection();
                  sel.setBaseAndExtent(span.firstChild, 0, span.firstChild, 5);
                  return sel.toString();
                })()
                """.trimIndent()
            )
            assertTrue("Expected single-word selection 'Alpha', got '$singleWordSelected'", singleWordSelected == "Alpha")

            val multiLineSelected = evalJsSync(
                webView,
                """
                (function() {
                  var spans = Array.from(document.querySelectorAll('.pg-item[data-page="1"] .textLayer span'));
                  var first = spans.find(function(s){ return (s.textContent || '').indexOf('Alpha') !== -1; });
                  var second = spans.find(function(s){ return (s.textContent || '').indexOf('Café') !== -1; });
                  if (!first || !second || !first.firstChild || !second.firstChild) return '';
                  var sel = window.getSelection();
                  sel.setBaseAndExtent(first.firstChild, 0, second.firstChild, Math.min(4, second.firstChild.textContent.length));
                  return sel.toString();
                })()
                """.trimIndent()
            )
            assertTrue("Expected multi-line selection across Alpha & Café, got '$multiLineSelected'", multiLineSelected.contains("Alpha") && multiLineSelected.contains("Caf"))
            assertNoHeaderOrChromeText("Multi-line selection", multiLineSelected)

            // 2. Open PDF Search, enter SearchTarget, verify highlights and result navigation
            val searchCountText = evalJsSync(
                webView,
                """
                (function() {
                  var btn = document.querySelector('button[aria-label*="Find text in document"]');
                  if (!btn) return 'no-btn';
                  btn.click();
                  return 'clicked';
                })()
                """.trimIndent()
            )
            assertTrue("Expected Find button, got $searchCountText", searchCountText == "clicked")
            SystemClock.sleep(250L)

            val queryApplied = evalJsSync(
                webView,
                """
                (function() {
                  var input = document.querySelector('.viewer-search-bar input');
                  if (!input) return 'no-input';
                  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                  setter.call(input, 'SearchTarget');
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  return 'typed';
                })()
                """.trimIndent()
            )
            assertTrue("Expected search input, got $queryApplied", queryApplied == "typed")

            var matchesFound = ""
            val searchDeadline = SystemClock.uptimeMillis() + 6_000L
            while (SystemClock.uptimeMillis() < searchDeadline) {
                matchesFound = evalJsSync(webView, "document.querySelector('.viewer-search-bar .search-count')?.textContent || ''")
                if (matchesFound.contains("1 of 2")) break
                SystemClock.sleep(150L)
            }
            assertTrue("Expected 2 search matches ('1 of 2'), got '$matchesFound'", matchesFound.contains("1 of 2"))

            // Navigate to next match on page 2 and verify mark highlight + native Select All / Copy exclusion
            evalJsSync(webView, "document.querySelector('.viewer-search-bar button[aria-label=\"Next match\"]')?.click(); 'ok'")
            SystemClock.sleep(500L)
            val matchCountAfterNext = evalJsSync(webView, "document.querySelector('.viewer-search-bar .search-count')?.textContent || ''")
            assertTrue("Expected match navigation to advance to '2 of 2', got '$matchCountAfterNext'", matchCountAfterNext.contains("2 of 2"))

            val p2Coords = evalJsSync(
                webView,
                """
                (function() {
                  var span = document.querySelector('.pg-item[data-page="2"] .textLayer span');
                  if (!span) return '';
                  var r = span.getBoundingClientRect();
                  return JSON.stringify({ x: r.left + Math.min(20, r.width * 0.25), y: r.top + r.height * 0.5 });
                })()
                """.trimIndent()
            )
            assertTrue("Expected Page 2 span coordinates, got '$p2Coords'", p2Coords.isNotEmpty())
            val p2Pt = JSONObject(p2Coords)
            longPressWebViewCssPoint(webView, p2Pt.getDouble("x").toFloat(), p2Pt.getDouble("y").toFloat())
            SystemClock.sleep(500L)

            // Drag selection horizontally first to force ActionMode onPrepareActionMode rebuild, then tap Select all -> Copy
            dragWebViewCssSpan(
                webView,
                p2Pt.getDouble("x").toFloat(),
                p2Pt.getDouble("y").toFloat(),
                (p2Pt.getDouble("x") + 40.0).toFloat(),
                p2Pt.getDouble("y").toFloat(),
            )
            SystemClock.sleep(350L)
            longPressWebViewCssPoint(webView, p2Pt.getDouble("x").toFloat(), p2Pt.getDouble("y").toFloat())
            SystemClock.sleep(450L)

            val clickedSelectAll = clickFloatingMenuAction("Select all", "Select All")
            assertTrue("Expected native Select all on Page 2 during active search", clickedSelectAll)
            SystemClock.sleep(400L)

            val p2SelectText = evalJsSync(webView, "window.getSelection()?.toString() || ''")
            assertTrue("Expected Page 2 text including SearchTarget <mark>, got '$p2SelectText'", p2SelectText.contains("SecondPage") && p2SelectText.contains("SearchTarget"))
            assertNoHeaderOrChromeText("Page 2 Selection with active search", p2SelectText)
            assertFalse("Selection with active search must NOT contain search UI count '2 of 2', got '$p2SelectText'", p2SelectText.contains("2 of 2"))

            val clickedCopy = clickFloatingMenuAction("Copy")
            assertTrue("Expected native Copy on Page 2 during active search", clickedCopy)
            SystemClock.sleep(300L)

            val p2Clip = readClipboardText(context)
            assertTrue("Expected copied Page 2 text with SearchTarget, got '$p2Clip'", p2Clip.contains("SecondPage") && p2Clip.contains("SearchTarget"))
            assertNoHeaderOrChromeText("Page 2 Clipboard with active search", p2Clip)
            assertFalse("Page 2 Clipboard must NOT contain '2 of 2', got '$p2Clip'", p2Clip.contains("2 of 2"))
        } finally {
            scenario.close()
        }
    }
}
