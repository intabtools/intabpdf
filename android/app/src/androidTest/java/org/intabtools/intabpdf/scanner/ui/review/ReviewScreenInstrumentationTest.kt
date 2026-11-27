package org.intabtools.intabpdf.scanner.ui.review

import android.Manifest
import android.content.Context
import android.content.Intent
import android.graphics.Rect
import android.net.Uri
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.intabtools.intabpdf.scanner.data.ScanFilter
import org.intabtools.intabpdf.scanner.data.ScannerLaunchOptions
import org.intabtools.intabpdf.scanner.data.ScannerRoute
import org.intabtools.intabpdf.scanner.imaging.OpenCvRuntime
import org.intabtools.intabpdf.scanner.ui.ScannerActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.Scalar
import org.opencv.imgcodecs.Imgcodecs
import java.io.File

@RunWith(AndroidJUnit4::class)
class ReviewScreenInstrumentationTest {

    @Test
    fun reviewHierarchyTopBarOverflowAddTileThumbnailsAndDeleteConfirmation() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<Context>()
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
            context.packageName,
            Manifest.permission.CAMERA,
        )

        val img1 = writeSamplePageImage(context, "rev_p1.jpg", Scalar(245.0, 240.0, 235.0))
        val img2 = writeSamplePageImage(context, "rev_p2.jpg", Scalar(230.0, 242.0, 248.0))
        val img3 = writeSamplePageImage(context, "rev_p3.jpg", Scalar(240.0, 245.0, 230.0))

        try {
            val intent = ScannerLaunchOptions(autoCaptureDefault = false)
                .applyToIntent(Intent(context, ScannerActivity::class.java))

            ActivityScenario.launch<ScannerActivity>(intent).use { scenario ->
                scenario.onActivity { activity ->
                    activity.sessionControllerForTest().importGalleryUris(
                        listOf(Uri.fromFile(img1), Uri.fromFile(img2))
                    )
                }

                waitUntilSession(scenario) {
                    !it.isImportingGallery &&
                        it.route is ScannerRoute.Review &&
                        it.pages.size == 2
                }

                // Top bar: Close, Page 1 of 2, Save PDF, More options; Open in Viewer must remain removed
                val closeNode = waitForNodeByTextOrDesc("Close")
                val pageCounterNode = waitForNodeByTextOrDesc("Page 1 of 2")
                val savePdfNode = waitForNodeByContentDesc("Save PDF")
                val moreOptionsNode = waitForNodeByContentDesc("More options")
                assertNotNull("Close action should be visible", closeNode)
                assertNotNull("Page counter should be visible", pageCounterNode)
                assertNotNull("Save PDF primary action should be visible", savePdfNode)
                assertNotNull("Top bar overflow menu should be visible", moreOptionsNode)
                assertNull("Open in Viewer must remain removed", findNodeByTextOrDesc("Open in Viewer"))
                assertNull("Share must not appear in bottom area when overflow menu is closed", findNodeByTextOrDesc("Share"))

                val screenWidth = context.resources.displayMetrics.widthPixels
                val screenHeight = context.resources.displayMetrics.heightPixels
                val saveRect = Rect().also { savePdfNode!!.getBoundsInScreen(it) }
                val moreRect = Rect().also { moreOptionsNode!!.getBoundsInScreen(it) }
                assertTrue("Save PDF and overflow menu must not overlap", saveRect.right <= moreRect.left + 4)
                assertTrue("Overflow menu must remain within screen width", moreRect.right <= screenWidth)

                // Intended vertical hierarchy:
                // Top bar -> Large page preview -> Filter selector & scope -> Thumbnails + Add tile -> Editing toolbar
                val previewNode = waitForNodeByContentDescPrefix("Scanned page preview")
                val filterNode = waitForNodeByContentDesc("Filter: Auto")
                val scopeNode = waitForNodeByTextOrDesc("Apply to: This page")
                val thumb1 = waitForNodeByContentDesc("Page 1")
                val thumb2 = waitForNodeByContentDesc("Page 2")
                val addTile = waitForNodeByContentDesc("Add Page")
                val cropBtn = waitForNodeByContentDesc("Crop")
                val rotateBtn = waitForNodeByContentDesc("Rotate")
                val retakeBtn = waitForNodeByContentDesc("Retake")
                val deleteBtn = waitForNodeByContentDesc("Delete")

                assertNotNull(previewNode)
                assertNotNull(filterNode)
                assertNotNull("Filter scope label should be simplified to Apply to: This page", scopeNode)
                assertNotNull(thumb1)
                assertNotNull(thumb2)
                assertNotNull("+ Add Page tile should be present in thumbnail strip", addTile)
                assertNotNull(cropBtn)
                assertNotNull("Rotate action should be labeled Rotate", rotateBtn)
                assertNull("Old Rotate 90° label should be replaced by Rotate", findNodeByTextOrDesc("Rotate 90°"))
                assertNotNull(retakeBtn)
                assertNotNull(deleteBtn)

                val previewRect = Rect().also { previewNode!!.getBoundsInScreen(it) }
                val filterRect = Rect().also { filterNode!!.getBoundsInScreen(it) }
                val thumb1Rect = Rect().also { thumb1!!.getBoundsInScreen(it) }
                val cropRect = Rect().also { cropBtn!!.getBoundsInScreen(it) }
                val deleteRect = Rect().also { deleteBtn!!.getBoundsInScreen(it) }

                val density = context.resources.displayMetrics.density
                assertTrue("Thumbnails should be enlarged (>= 58dp tall)", thumb1Rect.height() >= (58f * density).toInt())
                assertTrue("Main preview must remain large (> 40% of screen height)", previewRect.height() > screenHeight * 0.40f)
                assertTrue("Top bar above main preview", saveRect.bottom <= previewRect.top + 24)
                assertTrue("Main preview above filter selector", previewRect.bottom <= filterRect.top + 24)
                assertTrue("Filter selector above thumbnail strip", filterRect.bottom <= thumb1Rect.top + 24)
                assertTrue("Thumbnail strip above editing toolbar", thumb1Rect.bottom <= cropRect.top + 24)
                assertTrue("Editing toolbar must not clip below screen", deleteRect.bottom <= screenHeight)

                for (filterLabel in listOf("Auto", "Original", "Color", "Gray", "B&W")) {
                    val fNode = waitForNodeByContentDesc("Filter: $filterLabel")
                    assertNotNull("Expected plain-text filter '$filterLabel'", fNode)
                    val fRect = Rect().also { fNode!!.getBoundsInScreen(it) }
                    assertTrue("Filter '$filterLabel' should fit horizontally on screen", fRect.left >= 0 && fRect.right <= screenWidth)
                }

                // Top-bar overflow menu exposes Share
                clickNode(moreOptionsNode!!)
                val shareMenuItem = waitForNodeByTextOrDesc("Share")
                assertNotNull("Share should appear inside top-bar overflow menu", shareMenuItem)
                InstrumentationRegistry.getInstrumentation().uiAutomation.performGlobalAction(
                    android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK,
                )
                waitUntil { findNodeByTextOrDesc("Share") == null }

                // Add Page tile opens Camera & Import Photos choices
                clickNodeByContentDesc("Add Page")
                assertNotNull("Camera choice should open in Add page dialog", waitForNodeByTextOrDesc("Camera"))
                assertNotNull("Import Photos choice should open in Add page dialog", waitForNodeByTextOrDesc("Import Photos"))
                clickNode(waitForNodeByTextOrDesc("Cancel")!!)
                waitUntil { findNodeByTextOrDesc("Camera") == null }

                // Tap Page 2 thumbnail -> updates selected page & counter
                clickNodeByContentDesc("Page 2")
                waitUntilSession(scenario) { it.selectedPageIndex == 1 }
                assertNotNull(waitForNodeByTextOrDesc("Page 2 of 2"))

                // Select Gray filter -> updates Page 2 and main preview without changing Page 1
                clickNodeByContentDesc("Filter: Gray")
                waitUntilSession(scenario) {
                    it.pages[1].selectedFilter == ScanFilter.GRAYSCALE &&
                        it.renderedFiles[it.pages[1].pageId]?.effectiveFilter == ScanFilter.GRAYSCALE
                }
                assertNotNull(
                    "Main preview should reflect Gray filter immediately",
                    waitForNodeByContentDesc("Scanned page preview (Gray)"),
                )

                var page0Filter: ScanFilter? = null
                scenario.onActivity { activity ->
                    page0Filter = activity.currentSessionStateForTest().pages[0].selectedFilter
                }
                assertEquals(ScanFilter.AUTO, page0Filter)

                // Importing 3rd page renders Page 3 thumbnail file & updates strip even while Page 1 is selected
                clickNodeByContentDesc("Page 1")
                waitUntilSession(scenario) { it.selectedPageIndex == 0 }
                scenario.onActivity { activity ->
                    activity.sessionControllerForTest().importGalleryUris(listOf(Uri.fromFile(img3)))
                }
                waitUntilSession(scenario) {
                    !it.isImportingGallery &&
                        it.pages.size == 3 &&
                        it.renderedFiles[it.pages[2].pageId]?.outputFile?.exists() == true
                }
                val thumb3 = waitForNodeByContentDesc("Page 3")
                assertNotNull("Thumbnail for newly imported Page 3 must appear", thumb3)
                clickNode(thumb3!!)
                waitUntilSession(scenario) { it.selectedPageIndex == 2 }
                assertNotNull(waitForNodeByTextOrDesc("Page 3 of 3"))

                // Delete requires confirmation before removing page
                clickNodeByContentDesc("Delete")
                assertNotNull("Delete confirmation dialog should appear", waitForNodeByTextOrDesc("Delete page 3?"))
                var countBeforeConfirm = 0
                scenario.onActivity { countBeforeConfirm = it.currentSessionStateForTest().pages.size }
                assertEquals("Page must not be deleted before confirmation", 3, countBeforeConfirm)

                clickNode(waitForNodeByTextOrDesc("Cancel")!!)
                waitUntil { findNodeByTextOrDesc("Delete page 3?") == null }

                clickNodeByContentDesc("Delete")
                val dialogTitle = waitForNodeByTextOrDesc("Delete page 3?")
                assertNotNull(dialogTitle)
                val confirmDelete = findNodeInWindowContaining("Delete page 3?") {
                    it.text?.toString() == "Delete"
                }
                assertNotNull("Confirmation Delete button should be present", confirmDelete)
                clickNode(confirmDelete!!)
                waitUntilSession(scenario) { it.pages.size == 2 }

                // Cancellation feedback renders unobtrusively above bottom controls and auto-dismisses
                scenario.onActivity { activity ->
                    activity.sessionControllerForTest().setStatusMessage("Save cancelled")
                }
                val statusNode = waitForNodeByTextOrDesc("Save cancelled")
                assertNotNull("Cancellation status banner should appear", statusNode)
                val statusRect = Rect().also { statusNode!!.getBoundsInScreen(it) }
                assertTrue(
                    "Status message should sit below top bar and above filter controls",
                    statusRect.top >= saveRect.bottom && statusRect.bottom <= filterRect.top + 32,
                )
                waitUntilSession(scenario, timeoutMs = 6_000L) { it.statusMessage == null }
                assertNull("Open in Viewer must remain removed", findNodeByTextOrDesc("Open in Viewer"))

                // Verify WindowManager FLAG_KEEP_SCREEN_ON is OFF while idle
                var awakeIdle = true
                scenario.onActivity { awakeIdle = it.hasKeepScreenOnFlagForTest() }
                assertFalse("Screen must not stay awake when scanner Review is idle", awakeIdle)
            }
        } finally {
            img1.delete()
            img2.delete()
            img3.delete()
        }
    }

    @Test
    fun screenAwakeActiveDuringScannerProcessingAndClearedOnCancelAndStop() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<Context>()
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
            context.packageName,
            Manifest.permission.CAMERA,
        )

        val images = (1..12).map { idx ->
            writeSamplePageImage(
                context = context,
                name = "awake_p$idx.jpg",
                color = Scalar(240.0, 238.0, 234.0),
                width = 1600,
                height = 1200,
            )
        }

        try {
            val intent = ScannerLaunchOptions(autoCaptureDefault = false)
                .applyToIntent(Intent(context, ScannerActivity::class.java))

            ActivityScenario.launch<ScannerActivity>(intent).use { scenario ->
                scenario.onActivity { activity ->
                    assertFalse("Idle activity must not hold keep-screen-on flag", activity.hasKeepScreenOnFlagForTest())
                    activity.sessionControllerForTest().importGalleryUris(images.map { Uri.fromFile(it) })
                }

                // Wait for import completion -> returns to idle (flag must be cleared)
                waitUntilSession(scenario, timeoutMs = 20_000L) {
                    !it.isImportingGallery && it.route is ScannerRoute.Review && it.pages.size == 12
                }
                waitUntilActivity(scenario) { !it.hasKeepScreenOnFlagForTest() }

                // Trigger PDF generation/export, assert keep-screen-on activates during active export, then cancel
                scenario.onActivity { activity ->
                    activity.sessionControllerForTest().exportPdf()
                }
                waitUntilActivity(scenario, timeoutMs = 8_000L) {
                    it.currentSessionStateForTest().isExportingPdf && it.hasKeepScreenOnFlagForTest()
                }
                scenario.onActivity { activity ->
                    activity.sessionControllerForTest().cancelPdfExport()
                }
                waitUntilActivity(scenario, timeoutMs = 6_000L) {
                    !it.currentSessionStateForTest().isExportingPdf && !it.hasKeepScreenOnFlagForTest()
                }

                // Leaving the screen (onStop) must ensure screen-awake controller is inactive and flag stays off
                scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED)
                var activeAfterStop = true
                scenario.onActivity { activeAfterStop = it.isScreenAwakeControllerActiveForTest() }
                assertFalse("Leaving screen must deactivate keep-screen-on controller", activeAfterStop)
            }
        } finally {
            images.forEach { it.delete() }
        }
    }

    @Test
    fun swipeAndThumbnailSelectionStaySynchronizedAcrossEdits() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<Context>()
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
            context.packageName,
            Manifest.permission.CAMERA,
        )

        val images = (1..3).map { idx ->
            writeSamplePageImage(
                context = context,
                name = "sync_p$idx.jpg",
                color = Scalar(235.0, 238.0 + idx, 242.0),
            )
        }

        try {
            val intent = ScannerLaunchOptions(autoCaptureDefault = false)
                .applyToIntent(Intent(context, ScannerActivity::class.java))

            ActivityScenario.launch<ScannerActivity>(intent).use { scenario ->
                scenario.onActivity { activity ->
                    activity.sessionControllerForTest().importGalleryUris(images.map { Uri.fromFile(it) })
                }
                waitUntilSession(scenario) {
                    !it.isImportingGallery &&
                        it.route is ScannerRoute.Review &&
                        it.pages.size == 3
                }

                val previewNode = waitForNodeByContentDescPrefix("Scanned page preview")!!
                val previewRect = Rect().also { previewNode.getBoundsInScreen(it) }

                fun assertSyncedSelection(expectedIndex: Int, expectedTotal: Int) {
                    waitUntilSession(scenario) {
                        it.selectedPageIndex == expectedIndex && it.pages.size == expectedTotal
                    }
                    assertNotNull(
                        "Header must show Page ${expectedIndex + 1} of $expectedTotal",
                        waitForNodeByTextOrDesc("Page ${expectedIndex + 1} of $expectedTotal"),
                    )
                    var lastStates = ""
                    val deadline = SystemClock.uptimeMillis() + 5_000L
                    var synced = false
                    while (SystemClock.uptimeMillis() < deadline && !synced) {
                        val parts = mutableListOf<String>()
                        synced = true
                        for (i in 0 until expectedTotal) {
                            val thumb = findNode { it.contentDescription?.toString() == "Page ${i + 1}" }
                            val parent = thumb?.parent?.also { it.refresh() }
                            val isThumbSelected = thumb != null && (
                                thumb.isChecked ||
                                    parent?.isChecked == true ||
                                    thumb.isSelected ||
                                    parent?.isSelected == true ||
                                    thumb.stateDescription?.toString() == "Selected" ||
                                    parent?.stateDescription?.toString() == "Selected"
                                )
                            parts += "p${i + 1}=$isThumbSelected(sd=${parent?.stateDescription ?: thumb?.stateDescription})"
                            if (thumb == null || isThumbSelected != (i == expectedIndex)) {
                                synced = false
                            }
                        }
                        lastStates = parts.joinToString()
                        if (!synced) {
                            Thread.sleep(100L)
                        }
                    }
                    assertTrue("Thumbnail sync failed for expectedIndex=$expectedIndex: $lastStates", synced)
                }

                assertSyncedSelection(expectedIndex = 0, expectedTotal = 3)

                // Swipe left (0 -> 1)
                swipeHorizontal(previewRect, leftToRight = false)
                assertSyncedSelection(expectedIndex = 1, expectedTotal = 3)

                // Apply Gray filter to page 2 -> must remain on index 1
                clickNodeByContentDesc("Filter: Gray")
                waitUntilSession(scenario) { it.pages[1].selectedFilter == ScanFilter.GRAYSCALE }
                assertSyncedSelection(expectedIndex = 1, expectedTotal = 3)

                // Swipe left again (1 -> 2)
                swipeHorizontal(previewRect, leftToRight = false)
                assertSyncedSelection(expectedIndex = 2, expectedTotal = 3)

                // Rotate page 3 -> must stay on page 3 (index 2)
                clickNodeByContentDesc("Rotate")
                waitUntilSession(scenario) { it.pages[2].rotationDegrees == 90 }
                assertSyncedSelection(expectedIndex = 2, expectedTotal = 3)

                // Rapid swipes right (2 -> 1 -> 0)
                swipeHorizontal(previewRect, leftToRight = true)
                swipeHorizontal(previewRect, leftToRight = true)
                assertSyncedSelection(expectedIndex = 0, expectedTotal = 3)

                // Tap thumbnail 2 -> preview & highlight move to index 1
                clickNodeByContentDesc("Page 2")
                assertSyncedSelection(expectedIndex = 1, expectedTotal = 3)

                // Delete non-selected Page 1 while Page 2 is selected -> remains on original Page 2 (now index 0)
                var page0Id = ""
                var page1Id = ""
                scenario.onActivity {
                    page0Id = it.currentSessionStateForTest().pages[0].pageId
                    page1Id = it.currentSessionStateForTest().pages[1].pageId
                    it.sessionControllerForTest().deletePage(page0Id)
                }
                waitUntilSession(scenario) {
                    it.pages.size == 2 && it.selectedPage?.pageId == page1Id
                }
                assertSyncedSelection(expectedIndex = 0, expectedTotal = 2)

                // Reorder selected Page 1 right -> selected index moves to 1
                clickNodeByContentDesc("Move page right")
                waitUntilSession(scenario) {
                    it.selectedPageIndex == 1 && it.selectedPage?.pageId == page1Id
                }
                assertSyncedSelection(expectedIndex = 1, expectedTotal = 2)

                // Reorder selected Page 2 left -> selected index moves back to 0
                clickNodeByContentDesc("Move page left")
                waitUntilSession(scenario) {
                    it.selectedPageIndex == 0 && it.selectedPage?.pageId == page1Id
                }
                assertSyncedSelection(expectedIndex = 0, expectedTotal = 2)

                // Add a new page while on page 1 -> newly added page becomes selected (index 2 of 3)
                scenario.onActivity {
                    it.sessionControllerForTest().importGalleryUris(listOf(Uri.fromFile(images[0])))
                }
                waitUntilSession(scenario) { !it.isImportingGallery && it.pages.size == 3 && it.selectedPageIndex == 2 }
                assertSyncedSelection(expectedIndex = 2, expectedTotal = 3)

                // Delete selected last page -> clamps cleanly to index 1
                var lastPageId = ""
                scenario.onActivity {
                    lastPageId = it.currentSessionStateForTest().pages[2].pageId
                    it.sessionControllerForTest().deletePage(lastPageId)
                }
                waitUntilSession(scenario) { it.pages.size == 2 && it.selectedPageIndex == 1 }
                assertSyncedSelection(expectedIndex = 1, expectedTotal = 2)
            }
        } finally {
            images.forEach { it.delete() }
        }
    }

    @Test
    fun manyPagesLazyThumbnailStripScrollsAndStaysSynchronized() {
        assertTrue("OpenCV failed to initialize", OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<Context>()
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
            context.packageName,
            Manifest.permission.CAMERA,
        )

        val images = (1..10).map { idx ->
            writeSamplePageImage(
                context = context,
                name = "many_p$idx.jpg",
                color = Scalar(228.0, 232.0 + idx, 240.0),
            )
        }

        try {
            val intent = ScannerLaunchOptions(autoCaptureDefault = false)
                .applyToIntent(Intent(context, ScannerActivity::class.java))

            ActivityScenario.launch<ScannerActivity>(intent).use { scenario ->
                scenario.onActivity { activity ->
                    activity.sessionControllerForTest().importGalleryUris(images.map { Uri.fromFile(it) })
                }
                waitUntilSession(scenario, timeoutMs = 20_000L) {
                    !it.isImportingGallery &&
                        it.route is ScannerRoute.Review &&
                        it.pages.size == 10
                }

                val screenWidth = context.resources.displayMetrics.widthPixels
                val previewNode = waitForNodeByContentDescPrefix("Scanned page preview")!!
                val previewRect = Rect().also { previewNode.getBoundsInScreen(it) }

                fun assertLazyStripSynced(expectedIndex: Int, expectedTotal: Int) {
                    waitUntilSession(scenario) {
                        it.selectedPageIndex == expectedIndex && it.pages.size == expectedTotal
                    }
                    assertNotNull(
                        "Header must show Page ${expectedIndex + 1} of $expectedTotal",
                        waitForNodeByTextOrDesc("Page ${expectedIndex + 1} of $expectedTotal"),
                    )
                    var lastSummary = ""
                    val deadline = SystemClock.uptimeMillis() + 5_000L
                    var synced = false
                    while (SystemClock.uptimeMillis() < deadline && !synced) {
                        val selectedThumb = findNode { it.contentDescription?.toString() == "Page ${expectedIndex + 1}" }
                        val selectedParent = selectedThumb?.parent?.also { it.refresh() }
                        val selectedBounds = selectedThumb?.let { Rect().also { r -> it.getBoundsInScreen(r) } }
                        val isTargetSelected = selectedThumb != null && (
                            selectedThumb.isChecked ||
                                selectedParent?.isChecked == true ||
                                selectedThumb.isSelected ||
                                selectedParent?.isSelected == true ||
                                selectedThumb.stateDescription?.toString() == "Selected" ||
                                selectedParent?.stateDescription?.toString() == "Selected"
                            )
                        val isTargetVisible = selectedBounds != null &&
                            selectedBounds.width() > 0 &&
                            selectedBounds.left >= 0 &&
                            selectedBounds.right <= screenWidth

                        var staleVisibleSelected = -1
                        for (i in 0 until expectedTotal) {
                            if (i == expectedIndex) continue
                            val other = findNode { it.contentDescription?.toString() == "Page ${i + 1}" } ?: continue
                            val otherParent = other.parent?.also { it.refresh() }
                            val otherSelected = other.isChecked ||
                                otherParent?.isChecked == true ||
                                other.isSelected ||
                                otherParent?.isSelected == true ||
                                other.stateDescription?.toString() == "Selected" ||
                                otherParent?.stateDescription?.toString() == "Selected"
                            if (otherSelected) {
                                staleVisibleSelected = i
                            }
                        }

                        synced = isTargetSelected && isTargetVisible && staleVisibleSelected == -1
                        lastSummary = "selected=$isTargetSelected visible=$isTargetVisible bounds=$selectedBounds staleOther=$staleVisibleSelected"
                        if (!synced) {
                            Thread.sleep(100L)
                        }
                    }
                    assertTrue("LazyRow sync/scroll failed for expectedIndex=$expectedIndex: $lastSummary", synced)
                }

                // Initially page 1 is selected while page 10 is offscreen
                assertLazyStripSynced(expectedIndex = 0, expectedTotal = 10)
                assertNull("Page 10 thumbnail should start lazily uncomposed offscreen", findNode { it.contentDescription?.toString() == "Page 10" })

                // Swipe quickly across multiple pages (0 -> 4)
                repeat(4) {
                    swipeHorizontal(previewRect, leftToRight = false)
                }
                assertLazyStripSynced(expectedIndex = 4, expectedTotal = 10)

                // Jump near the end -> LazyRow scrolls Page 9 into centered visible viewport and marks it selected
                scenario.onActivity { it.sessionControllerForTest().selectPage(8) }
                assertLazyStripSynced(expectedIndex = 8, expectedTotal = 10)

                // Swipe left to Page 10 (index 9) -> LazyRow reveals and selects Page 10
                swipeHorizontal(previewRect, leftToRight = false)
                assertLazyStripSynced(expectedIndex = 9, expectedTotal = 10)

                // Swipe right back to Page 9 (index 8), apply B&W filter, then tap Page 8 thumbnail
                swipeHorizontal(previewRect, leftToRight = true)
                assertLazyStripSynced(expectedIndex = 8, expectedTotal = 10)
                clickNodeByContentDesc("Filter: B&W")
                waitUntilSession(scenario) { it.pages[8].selectedFilter == ScanFilter.BLACK_AND_WHITE }
                assertLazyStripSynced(expectedIndex = 8, expectedTotal = 10)

                clickNodeByContentDesc("Page 8")
                assertLazyStripSynced(expectedIndex = 7, expectedTotal = 10)

                // Jump back to Page 1 -> LazyRow scrolls back to the start cleanly
                scenario.onActivity { it.sessionControllerForTest().selectPage(0) }
                assertLazyStripSynced(expectedIndex = 0, expectedTotal = 10)
            }
        } finally {
            images.forEach { it.delete() }
        }
    }

    private fun swipeHorizontal(bounds: Rect, leftToRight: Boolean) {
        val uiAuto = InstrumentationRegistry.getInstrumentation().uiAutomation
        val y = bounds.exactCenterY()
        val width = bounds.width().toFloat()
        val startX = if (leftToRight) bounds.left + width * 0.2f else bounds.right - width * 0.2f
        val endX = if (leftToRight) bounds.right - width * 0.2f else bounds.left + width * 0.2f
        val downTime = SystemClock.uptimeMillis()
        val down = android.view.MotionEvent.obtain(
            downTime,
            downTime,
            android.view.MotionEvent.ACTION_DOWN,
            startX,
            y,
            0,
        )
        uiAuto.injectInputEvent(down, true)
        down.recycle()

        val steps = 8
        for (i in 1..steps) {
            val t = downTime + (i * 18L)
            val fraction = i.toFloat() / steps
            val x = startX + (endX - startX) * fraction
            val move = android.view.MotionEvent.obtain(
                downTime,
                t,
                android.view.MotionEvent.ACTION_MOVE,
                x,
                y,
                0,
            )
            uiAuto.injectInputEvent(move, true)
            move.recycle()
            Thread.sleep(16L)
        }

        val up = android.view.MotionEvent.obtain(
            downTime,
            downTime + (steps + 1) * 18L,
            android.view.MotionEvent.ACTION_UP,
            endX,
            y,
            0,
        )
        uiAuto.injectInputEvent(up, true)
        up.recycle()
        Thread.sleep(350L)
    }

    private fun waitUntilActivity(
        scenario: ActivityScenario<ScannerActivity>,
        timeoutMs: Long = 5_000L,
        predicate: (ScannerActivity) -> Boolean,
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        var matched = false
        while (SystemClock.uptimeMillis() < deadline) {
            scenario.onActivity { matched = predicate(it) }
            if (matched) return
            Thread.sleep(40L)
        }
        assertTrue("Activity condition timed out", matched)
    }

    private fun waitUntil(timeoutMs: Long = 5_000L, predicate: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            if (predicate()) return
            Thread.sleep(100L)
        }
        assertTrue("UI condition timed out", predicate())
    }

    private fun waitUntilSession(
        scenario: ActivityScenario<ScannerActivity>,
        timeoutMs: Long = 10_000L,
        predicate: (org.intabtools.intabpdf.scanner.data.ScannerSessionUiState) -> Boolean,
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        var latest: org.intabtools.intabpdf.scanner.data.ScannerSessionUiState? = null
        while (SystemClock.uptimeMillis() < deadline) {
            scenario.onActivity { latest = it.currentSessionStateForTest() }
            if (latest != null && predicate(latest!!)) return
            Thread.sleep(100L)
        }
        assertTrue("Condition timed out; latest=$latest", latest != null && predicate(latest!!))
    }

    private fun clickNodeByContentDesc(desc: String) {
        val node = waitForNodeByContentDesc(desc)
        assertNotNull("Expected node with contentDescription='$desc'", node)
        clickNode(node!!)
    }

    private fun clickNode(node: AccessibilityNodeInfo) {
        if (!node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            val rect = Rect().also { node.getBoundsInScreen(it) }
            val downTime = SystemClock.uptimeMillis()
            val down = android.view.MotionEvent.obtain(
                downTime,
                downTime,
                android.view.MotionEvent.ACTION_DOWN,
                rect.exactCenterX(),
                rect.exactCenterY(),
                0,
            )
            val up = android.view.MotionEvent.obtain(
                downTime,
                downTime + 40L,
                android.view.MotionEvent.ACTION_UP,
                rect.exactCenterX(),
                rect.exactCenterY(),
                0,
            )
            val uiAuto = InstrumentationRegistry.getInstrumentation().uiAutomation
            uiAuto.injectInputEvent(down, true)
            uiAuto.injectInputEvent(up, true)
            down.recycle()
            up.recycle()
        }
    }

    private fun waitForNodeByContentDesc(desc: String, timeoutMs: Long = 6_000L): AccessibilityNodeInfo? {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            val found = findNode { it.contentDescription?.toString() == desc }
            if (found != null) return found
            Thread.sleep(100L)
        }
        return null
    }

    private fun waitForNodeByTextOrDesc(text: String, timeoutMs: Long = 6_000L): AccessibilityNodeInfo? {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            val found = findNodeByTextOrDesc(text)
            if (found != null) return found
            Thread.sleep(100L)
        }
        return null
    }

    private fun waitForNodeByContentDescPrefix(prefix: String, timeoutMs: Long = 6_000L): AccessibilityNodeInfo? {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            val found = findNode { it.contentDescription?.toString()?.startsWith(prefix) == true }
            if (found != null) return found
            Thread.sleep(100L)
        }
        return null
    }

    private fun findNodeByTextOrDesc(text: String): AccessibilityNodeInfo? =
        findNode {
            it.text?.toString() == text || it.contentDescription?.toString() == text
        }

    private fun findNodeInWindowContaining(
        anchorText: String,
        predicate: (AccessibilityNodeInfo) -> Boolean,
    ): AccessibilityNodeInfo? {
        val roots = activeWindowRoots()
        for (root in roots) {
            if (findInSubtree(root) { it.text?.toString() == anchorText } != null) {
                findInSubtree(root, predicate)?.let { return it }
            }
        }
        return null
    }

    private fun findNode(predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
        for (root in activeWindowRoots()) {
            findInSubtree(root, predicate)?.let { return it }
        }
        return null
    }

    private fun activeWindowRoots(): List<AccessibilityNodeInfo> {
        val uiAuto = InstrumentationRegistry.getInstrumentation().uiAutomation
        val roots = uiAuto.windows.mapNotNull { it.root }.toMutableList()
        if (roots.isEmpty()) {
            uiAuto.rootInActiveWindow?.let { roots.add(it) }
        }
        return roots
    }

    private fun findInSubtree(
        root: AccessibilityNodeInfo,
        predicate: (AccessibilityNodeInfo) -> Boolean,
    ): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        root.refresh()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            node.refresh()
            if (predicate(node)) return node
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { queue.add(it) }
            }
        }
        return null
    }

    private fun writeSamplePageImage(
        context: Context,
        name: String,
        color: Scalar,
        width: Int = 450,
        height: Int = 600,
    ): File {
        val file = File(context.cacheDir, name)
        val mat = Mat(height, width, CvType.CV_8UC3, color)
        try {
            Imgcodecs.imwrite(file.absolutePath, mat)
        } finally {
            mat.release()
        }
        return file
    }
}
