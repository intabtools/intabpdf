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

    @Test
    fun `smoothly tracks gradual movement and rejects isolated single-frame outlier jumps`() {
        val stabilizer = QuadStabilizer()
        repeat(3) { i ->
            stabilizer.update(docQuad, 0.85f, goodQuality, true, (i + 1) * 50L)
        }

        // Gradual pan larger than maxLockCornerDelta (0.036f) but within maxTrackingCornerDelta (0.14f)
        val panned = NormalizedQuad(
            topLeft = NormalizedPoint(0.21f, 0.16f),
            topRight = NormalizedPoint(0.91f, 0.16f),
            bottomRight = NormalizedPoint(0.91f, 0.86f),
            bottomLeft = NormalizedPoint(0.21f, 0.86f),
        )
        val tracked = stabilizer.update(panned, 0.85f, goodQuality, true, 250L)
        assertTrue("Gradual panning should preserve overlay lock without blinking", tracked.isLocked)
        assertNotNull(tracked.overlayQuad)
        assertTrue(tracked.overlayQuad!!.topLeft.x > 0.15f && tracked.overlayQuad!!.topLeft.x < 0.21f)

        // Single-frame wild outlier jump (> 0.14f) must be ignored
        val outlier = NormalizedQuad(
            topLeft = NormalizedPoint(0.55f, 0.55f),
            topRight = NormalizedPoint(0.95f, 0.55f),
            bottomRight = NormalizedPoint(0.95f, 0.95f),
            bottomLeft = NormalizedPoint(0.55f, 0.95f),
        )
        val afterOutlier = stabilizer.update(outlier, 0.85f, goodQuality, true, 300L)
        assertTrue(afterOutlier.isLocked)
        assertFalse(afterOutlier.shouldTriggerAutoCapture)
        assertEquals(tracked.overlayQuad, afterOutlier.overlayQuad)

        // Two consistent frames at new location relocate cleanly
        val relocated1 = stabilizer.update(outlier, 0.85f, goodQuality, true, 350L)
        assertTrue(relocated1.isLocked)
        val relocated2 = stabilizer.update(outlier, 0.85f, goodQuality, true, 400L)
        assertTrue(relocated2.isLocked)
        assertEquals(outlier.topLeft.x, relocated2.overlayQuad!!.topLeft.x, 1e-4f)
    }

    @Test
    fun `completes auto-capture despite small hand jitter brief dropout and transient confidence dip`() {
        val stabilizer = QuadStabilizer(
            StabilizerConfig(
                autoCaptureHoldDurationMs = 900L,
            )
        )

        // Initial lock
        repeat(3) { i ->
            stabilizer.update(docQuad, 0.80f, goodQuality, true, (i + 1) * 60L)
        }

        // Small hand jitter across consecutive frames (<= 0.015f) must NOT reset countdown
        val jitterA = NormalizedQuad(
            topLeft = NormalizedPoint(0.158f, 0.156f),
            topRight = NormalizedPoint(0.856f, 0.154f),
            bottomRight = NormalizedPoint(0.855f, 0.857f),
            bottomLeft = NormalizedPoint(0.157f, 0.855f),
        )
        val jitterB = NormalizedQuad(
            topLeft = NormalizedPoint(0.146f, 0.148f),
            topRight = NormalizedPoint(0.847f, 0.152f),
            bottomRight = NormalizedPoint(0.848f, 0.846f),
            bottomLeft = NormalizedPoint(0.147f, 0.849f),
        )

        val f1 = stabilizer.update(jitterA, 0.78f, goodQuality, true, 240L)
        assertTrue(f1.isLocked)

        val f2 = stabilizer.update(jitterB, 0.40f, goodQuality, true, 640L)
        assertTrue("Confidence hysteresis (0.40 >= 0.34) should keep lock", f2.isLocked)
        assertTrue("Progress should advance despite small hand jitter", f2.autoCaptureProgress > 0.3f)

        // Single-frame detection dropout pauses progress without restarting hold from 0
        val dropout = stabilizer.update(null, 0f, goodQuality, true, 760L)
        assertTrue(dropout.isLocked)
        assertFalse(dropout.shouldTriggerAutoCapture)
        assertTrue("Brief dropout should preserve hold progress", dropout.autoCaptureProgress > 0.3f)

        // Resume + brief 1-frame motion blip should not discard countdown
        val blip = stabilizer.update(jitterA, 0.75f, goodQuality.copy(motionDelta = 0.08f), true, 880L)
        assertTrue(blip.isLocked)
        assertFalse(blip.shouldTriggerAutoCapture)
        assertTrue(blip.autoCaptureProgress > 0.3f)

        // Hold completes cleanly once hand settles back
        val steadyAgain = stabilizer.update(docQuad, 0.82f, goodQuality, true, 1220L)
        assertTrue("Auto-capture should complete after small hand jitter & brief dropout", steadyAgain.shouldTriggerAutoCapture)
    }

    @Test
    fun `genuine large movement and actual document loss reset auto-capture hold`() {
        val stabilizer = QuadStabilizer(StabilizerConfig(autoCaptureHoldDurationMs = 800L))
        repeat(3) { i ->
            stabilizer.update(docQuad, 0.85f, goodQuality, true, (i + 1) * 50L)
        }
        val building = stabilizer.update(docQuad, 0.85f, goodQuality, true, 550L)
        assertTrue(building.autoCaptureProgress > 0.4f)

        // Genuine large corner shift (> autoCaptureMaxFrameJump) resets countdown immediately
        val largeShift = NormalizedQuad(
            topLeft = NormalizedPoint(0.22f, 0.15f),
            topRight = NormalizedPoint(0.92f, 0.15f),
            bottomRight = NormalizedPoint(0.92f, 0.85f),
            bottomLeft = NormalizedPoint(0.22f, 0.85f),
        )
        val afterMove = stabilizer.update(largeShift, 0.85f, goodQuality, true, 650L)
        assertTrue(afterMove.isLocked)
        assertFalse(afterMove.shouldTriggerAutoCapture)
        assertEquals(0f, afterMove.autoCaptureProgress, 1e-5f)

        // Actual document loss (> maxMissFrames) clears overlay and lock
        stabilizer.update(null, 0f, goodQuality, true, 700L)
        stabilizer.update(null, 0f, goodQuality, true, 750L)
        val lost = stabilizer.update(null, 0f, goodQuality, true, 800L)
        assertFalse(lost.isLocked)
        assertNull(lost.overlayQuad)
        assertEquals(0f, lost.autoCaptureProgress, 1e-5f)
    }
}
