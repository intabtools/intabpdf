package org.intabtools.intabpdf.scanner.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuadStabilizerTest {

    private val docQuad = NormalizedQuad(
        topLeft = NormalizedPoint(0.15f, 0.15f),
        topRight = NormalizedPoint(0.85f, 0.15f),
        bottomRight = NormalizedPoint(0.85f, 0.85f),
        bottomLeft = NormalizedPoint(0.15f, 0.85f),
    )

    private val goodQuality = FrameQualityMetrics(
        meanLuminance = 120f,
        sharpnessVariance = 60f,
        motionDelta = 0.01f,
    )

    @Test
    fun `rejects detections below confidence threshold and requires 3 consistent frames to lock`() {
        val stabilizer = QuadStabilizer()

        // Below confidence threshold
        val lowConf = stabilizer.update(docQuad, confidence = 0.30f, quality = goodQuality, autoCaptureEnabled = true, nowMs = 100L)
        assertFalse(lowConf.isLocked)
        assertNull(lowConf.overlayQuad)

        // Frame 1 & 2 valid -> not locked yet
        assertFalse(stabilizer.update(docQuad, 0.8f, goodQuality, true, 200L).isLocked)
        assertFalse(stabilizer.update(docQuad, 0.8f, goodQuality, true, 300L).isLocked)

        // Frame 3 locks overlay
        val locked = stabilizer.update(docQuad, 0.8f, goodQuality, true, 400L)
        assertTrue(locked.isLocked)
        assertNotNull(locked.overlayQuad)
    }

    @Test
    fun `tolerates brief 2-frame detection dropout without flickering`() {
        val stabilizer = QuadStabilizer()
        repeat(3) { i ->
            stabilizer.update(docQuad, 0.85f, goodQuality, false, (i + 1) * 50L)
        }

        val miss1 = stabilizer.update(null, 0f, goodQuality, false, 200L)
        assertTrue(miss1.isLocked)
        assertNotNull(miss1.overlayQuad)

        val miss2 = stabilizer.update(null, 0f, goodQuality, false, 250L)
        assertTrue(miss2.isLocked)

        val miss3 = stabilizer.update(null, 0f, goodQuality, false, 300L)
        assertFalse(miss3.isLocked)
        assertNull(miss3.overlayQuad)
    }

    @Test
    fun `triggers auto-capture after sustained hold window and blocks duplicates until scene changes and cooldown elapses`() {
        val stabilizer = QuadStabilizer(
            StabilizerConfig(
                autoCaptureHoldDurationMs = 800L,
                cooldownMs = 2000L,
                duplicateShiftThreshold = 0.06f,
            )
        )

        // Lock over 3 frames
        stabilizer.update(docQuad, 0.85f, goodQuality, true, 100L)
        stabilizer.update(docQuad, 0.85f, goodQuality, true, 150L)
        val anchorFrame = stabilizer.update(docQuad, 0.85f, goodQuality, true, 200L)
        assertFalse(anchorFrame.shouldTriggerAutoCapture)

        // Mid-way hold builds progress without triggering yet
        val holding = stabilizer.update(docQuad, 0.85f, goodQuality, true, 600L)
        assertEquals(0.5f, holding.autoCaptureProgress, 0.02f)
        assertFalse(holding.shouldTriggerAutoCapture)

        // Reach hold duration -> triggers once
        val triggered = stabilizer.update(docQuad, 0.85f, goodQuality, true, 1000L)
        assertTrue(triggered.shouldTriggerAutoCapture)
        assertEquals(1.0f, triggered.autoCaptureProgress, 1e-4f)

        stabilizer.notifyCaptureTriggered(1000L, docQuad)

        // During cooldown -> stays blocked
        val duringCooldown = stabilizer.update(docQuad, 0.85f, goodQuality, true, 2200L)
        assertFalse(duringCooldown.shouldTriggerAutoCapture)
        assertEquals(CameraUserHint.CAPTURING_NEXT_COOLDOWN, duringCooldown.userHint)

        // Past cooldown (3500ms), SAME stationary page -> still duplicate-blocked!
        val samePagePastCooldown = stabilizer.update(docQuad, 0.85f, goodQuality, true, 4000L)
        assertFalse(samePagePastCooldown.shouldTriggerAutoCapture)
        assertEquals(CameraUserHint.CAPTURING_NEXT_COOLDOWN, samePagePastCooldown.userHint)

        // New page / shifted quad (>= 0.06 shift) breaks duplicate lock and starts fresh hold
        val shiftedQuad = NormalizedQuad(
            topLeft = NormalizedPoint(0.23f, 0.15f),
            topRight = NormalizedPoint(0.85f, 0.15f),
            bottomRight = NormalizedPoint(0.85f, 0.85f),
            bottomLeft = NormalizedPoint(0.23f, 0.85f),
        )
        stabilizer.update(shiftedQuad, 0.85f, goodQuality, true, 4100L)
        stabilizer.update(shiftedQuad, 0.85f, goodQuality, true, 4150L)
        val anchorNext = stabilizer.update(shiftedQuad, 0.85f, goodQuality, true, 4200L)
        assertFalse(anchorNext.shouldTriggerAutoCapture)

        val nextTrigger = stabilizer.update(shiftedQuad, 0.85f, goodQuality, true, 5050L)
        assertTrue(nextTrigger.shouldTriggerAutoCapture)
    }

    @Test
    fun `blocks auto-capture under low light camera motion or when auto-capture is disabled`() {
        val stabilizer = QuadStabilizer(StabilizerConfig(autoCaptureHoldDurationMs = 500L))
        repeat(3) { i ->
            stabilizer.update(docQuad, 0.85f, goodQuality, true, (i + 1) * 50L)
        }

        // Low light
        val dark = stabilizer.update(docQuad, 0.85f, goodQuality.copy(meanLuminance = 15f), true, 1000L)
        assertFalse(dark.shouldTriggerAutoCapture)
        assertEquals(CameraUserHint.LOW_LIGHT, dark.userHint)

        // Excessive camera motion
        val moving = stabilizer.update(docQuad, 0.85f, goodQuality.copy(motionDelta = 0.25f), true, 1200L)
        assertFalse(moving.shouldTriggerAutoCapture)
        assertEquals(CameraUserHint.BLURRY_OR_MOVING, moving.userHint)

        // Auto-capture disabled manually -> overlay remains locked without triggering capture
        val manualOnly = stabilizer.update(docQuad, 0.85f, goodQuality, false, 2000L)
        assertTrue(manualOnly.isLocked)
        assertFalse(manualOnly.shouldTriggerAutoCapture)
        assertEquals(0f, manualOnly.autoCaptureProgress, 1e-5f)
    }
}
