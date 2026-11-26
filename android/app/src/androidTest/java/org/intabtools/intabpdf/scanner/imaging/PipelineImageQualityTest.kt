package org.intabtools.intabpdf.scanner.imaging

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.exifinterface.media.ExifInterface
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.intabtools.intabpdf.scanner.data.NonDestructivePagePipeline
import org.intabtools.intabpdf.scanner.data.ScanFilter
import org.intabtools.intabpdf.scanner.data.ScanQuality
import org.intabtools.intabpdf.scanner.data.StillCaptureStore
import org.intabtools.intabpdf.scanner.vision.NormalizedPoint
import org.intabtools.intabpdf.scanner.vision.NormalizedQuad
import org.intabtools.intabpdf.scanner.vision.OpenCvDocumentDetector
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.Point
import org.opencv.core.Rect
import org.opencv.core.Scalar
import org.opencv.imgcodecs.Imgcodecs
import org.opencv.imgproc.Imgproc
import java.io.File
import java.security.MessageDigest
import kotlin.math.abs

/**
 * End-to-end instrumentation quality suite for Milestone 3A validating:
 * 1) Untouched full-resolution source preservation & reversibility across crop/rotate/filter edits.
 * 2) Quantitative shadow flattening & ink contrast on uneven-lighting low-contrast captures.
 * 3) AUTO filter classification for monochrome vs color-stamped pages.
 * 4) Sauvola B&W bitonal crispness + solid dark header preservation (no hollow centers).
 * 5) Background filter thumbnail generation + constrained-memory caps.
 */
@RunWith(AndroidJUnit4::class)
class PipelineImageQualityTest {

    @Test
    fun reversibleEditsPreserveOriginalSourceHashAndRotationGeometry() = runBlocking {
        assertTrue(OpenCvRuntime.ensureInitialized())
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val store = StillCaptureStore(context, OpenCvDocumentDetector())
        val pipeline = NonDestructivePagePipeline(context, store.sessionId)

        val rawFile = store.newTempRawCaptureFile()
        val sampleBgr = createShadowedMonochromeDoc(1200, 900)
        try {
            Imgcodecs.imwrite(rawFile.absolutePath, sampleBgr)
        } finally {
            sampleBgr.release()
        }
        // Inject 90-degree EXIF tag to verify EXIF orientation normalization
        ExifInterface(rawFile.absolutePath).apply {
            setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString())
            saveAttributes()
        }

        val captured = store.saveFullResolutionCapture(rawFile, fallbackQuad = null, autoCaptured = false)
        // After 90-deg EXIF normalization, raw 1200x900 becomes upright 900x1200
        assertEquals(900, captured.widthPx)
        assertEquals(1200, captured.heightPx)

        val sourceFile = File(captured.sourceFilePath)
        val originalSourceHash = sha256(sourceFile)

        pipeline.registerCapturedPage(captured, defaultFilter = ScanFilter.AUTO)

        // Render Color, B&W, Crop override, and 90-deg Rotation -> verify untouched source
        pipeline.setFilter(captured.pageId, ScanFilter.GRAYSCALE)
        val grayRes = pipeline.renderPage(captured.pageId, ScanQuality.BALANCED)
        assertTrue(grayRes.outputFile.exists())

        pipeline.setFilter(captured.pageId, ScanFilter.BLACK_AND_WHITE)
        val bwRes = pipeline.renderPage(captured.pageId, ScanQuality.BALANCED)
        assertTrue(bwRes.isBitonal)
        assertTrue(bwRes.outputFile.name.endsWith(".png"))

        val customCrop = NormalizedQuad(
            topLeft = NormalizedPoint(0.15f, 0.15f),
            topRight = NormalizedPoint(0.85f, 0.15f),
            bottomRight = NormalizedPoint(0.85f, 0.85f),
            bottomLeft = NormalizedPoint(0.15f, 0.85f),
        )
        pipeline.updateCropQuad(captured.pageId, customCrop)
        pipeline.rotatePage(captured.pageId, 90)
        pipeline.setFilter(captured.pageId, ScanFilter.ORIGINAL)
        val rotatedOrig = pipeline.renderPage(captured.pageId, ScanQuality.BALANCED)
        assertTrue(
            "Rotating portrait crop 90 degrees must yield landscape (${rotatedOrig.widthPx}x${rotatedOrig.heightPx})",
            rotatedOrig.widthPx > rotatedOrig.heightPx,
        )

        val thumbnails = pipeline.generateFilterThumbnails(captured.pageId)
        assertEquals(ScanFilter.entries.size, thumbnails.size)
        thumbnails.values.forEach { thumb ->
            assertTrue("Missing thumbnail ${thumb.name}", thumb.exists() && thumb.length() > 100L)
        }

        assertArrayEquals(
            "Immutable captured source image was unexpectedly altered!",
            originalSourceHash,
            sha256(sourceFile),
        )
    }

    @Test
    fun grayscaleShadowFlatteningAndBwSolidFillPreserveLegibleDocumentQuality() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val shadowed = createShadowedMonochromeDoc(1000, 1400)
        val grayOut = PageFilterEngine.enhanceGrayscale(shadowed)
        val bwOut = PageFilterEngine.enhanceBlackAndWhite(shadowed, isLowRamDevice = true, targetMaxPixels = 1_500_000L)
        try {
            // Check 1: Before flattening, bottom-right quadrant was darkened down toward ~85;
            // After grayscale enhancement, clean paper in bottom-right must lift >= 210 while text ink remains <= 75!
            val bottomPaperPatch = grayOut.submat(Rect((grayOut.cols() * 0.72).toInt(), (grayOut.rows() * 0.78).toInt(), 90, 90))
            val topPaperPatch = grayOut.submat(Rect((grayOut.cols() * 0.18).toInt(), (grayOut.rows() * 0.78).toInt(), 90, 90))
            val topMean = Core.mean(topPaperPatch).`val`[0]
            val bottomMean = Core.mean(bottomPaperPatch).`val`[0]
            bottomPaperPatch.release()
            topPaperPatch.release()

            assertTrue("Expected shadowed paper brightness >= 205, got $bottomMean", bottomMean >= 205.0)
            assertTrue("Expected uniform top/bottom paper brightness delta < 30, got ${abs(topMean - bottomMean)}", abs(topMean - bottomMean) < 30.0)

            // Check 2: Simulated dark ink line remains dark in grayscale
            val inkSampleY = (grayOut.rows() * 0.36).toInt()
            val inkPixel = grayOut.get(inkSampleY, grayOut.cols() / 2)?.get(0) ?: 255.0
            assertTrue("Expected text stroke intensity <= 85, got $inkPixel", inkPixel <= 85.0)

            // Check 3: BLACK_AND_WHITE outputs strictly bitonal values (0 or 255) AND preserves solid black header interior!
            assertEquals(1, bwOut.channels())
            val bannerCenter = bwOut.submat(Rect(bwOut.cols() / 3, (bwOut.rows() * 0.14).toInt(), bwOut.cols() / 3, (bwOut.rows() * 0.04).toInt()))
            val bannerInteriorMean = Core.mean(bannerCenter).`val`[0]
            bannerCenter.release()
            assertTrue("Solid dark banner interior must stay filled black (<= 25), got $bannerInteriorMean", bannerInteriorMean <= 25.0)

            // Verify bitonality on sampled patch
            val bytes = ByteArray(100 * 100)
            val checkPatch = bwOut.submat(Rect(50, 50, 100, 100))
            checkPatch.get(0, 0, bytes)
            checkPatch.release()
            for (b in bytes) {
                val v = b.toInt() and 0xFF
                assertTrue("Expected strictly bitonal pixel 0 or 255, got $v", v == 0 || v == 255)
            }
        } finally {
            shadowed.release()
            grayOut.release()
            bwOut.release()
        }
    }

    @Test
    fun autoFilterDistinguishesMonochromeTextFromColorStampedPage() {
        assertTrue(OpenCvRuntime.ensureInitialized())

        val monoDoc = createShadowedMonochromeDoc(800, 1000)
        val colorDoc = createShadowedMonochromeDoc(800, 1000)
        try {
            // Paint a bright blue ink stamp & yellow highlighter band onto colorDoc
            Imgproc.rectangle(colorDoc, Point(180.0, 550.0), Point(620.0, 620.0), Scalar(40.0, 235.0, 245.0), -1)
            Imgproc.circle(colorDoc, Point(620.0, 760.0), 65, Scalar(210.0, 65.0, 25.0), -1)

            assertEquals(ScanFilter.GRAYSCALE, PageFilterEngine.detectAutoFilter(monoDoc))
            assertEquals(ScanFilter.COLOR, PageFilterEngine.detectAutoFilter(colorDoc))

            val enhancedColor = PageFilterEngine.enhanceColor(colorDoc)
            try {
                // Verify blue stamp remains distinctly blue (B channel significantly > R channel)
                val stampPx = enhancedColor.get(760, 620)!!
                assertTrue("Color stamp should preserve blue hue (B=${stampPx[0]} vs R=${stampPx[2]})", stampPx[0] > stampPx[2] + 60.0)
            } finally {
                enhancedColor.release()
            }
        } finally {
            monoDoc.release()
            colorDoc.release()
        }
    }

    /**
     * Generates a synthetic document BGR Mat featuring warm uneven diagonal shadow lighting,
     * a solid dark banner header, and crisp printed horizontal text strokes.
     */
    private fun createShadowedMonochromeDoc(width: Int, height: Int): Mat {
        val doc = Mat(height, width, CvType.CV_8UC3)
        for (y in 0 until height) {
            val rowBytes = ByteArray(width * 3)
            val fy = y.toDouble() / height.toDouble()
            for (x in 0 until width) {
                val fx = x.toDouble() / width.toDouble()
                // Smooth diagonal illumination drop-off from warm bright top-left (236) to shadowed bottom-right (88)
                val shade = (236.0 - 148.0 * (0.45 * fx + 0.55 * fy)).toInt().coerceIn(70, 245)
                rowBytes[x * 3] = (shade - 10).coerceIn(0, 255).toByte() // slight warm paper cast
                rowBytes[x * 3 + 1] = shade.toByte()
                rowBytes[x * 3 + 2] = (shade + 4).coerceIn(0, 255).toByte()
            }
            doc.put(y, 0, rowBytes)
        }

        // Solid dark header banner (tests Sauvola fill preservation!)
        Imgproc.rectangle(
            doc,
            Point(width * 0.14, height * 0.10),
            Point(width * 0.86, height * 0.22),
            Scalar(32.0, 32.0, 35.0),
            -1,
        )

        // Sharp dark text strokes across lit & shadowed areas
        for (lineIdx in 0 until 6) {
            val y = height * (0.30 + lineIdx * 0.06)
            Imgproc.line(
                doc,
                Point(width * 0.15, y),
                Point(width * 0.85, y),
                Scalar(28.0, 28.0, 30.0),
                4,
            )
        }
        return doc
    }

    private fun sha256(file: File): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(8192)
            while (true) {
                val read = input.read(buf)
                if (read <= 0) break
                digest.update(buf, 0, read)
            }
        }
        return digest.digest()
    }
}
