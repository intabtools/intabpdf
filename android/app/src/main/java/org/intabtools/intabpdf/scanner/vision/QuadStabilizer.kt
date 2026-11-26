package org.intabtools.intabpdf.scanner.vision

enum class CameraUserHint {
    ALIGN_DOCUMENT,
    LOW_LIGHT,
    BLURRY_OR_MOVING,
    HOLD_STEADY,
    LOCKED_READY,
    CAPTURING_NEXT_COOLDOWN,
}

data class StabilizerConfig(
    val minConfidence: Float = 0.45f,
    val maxLockCornerDelta: Float = 0.036f,
    val maxTrackingCornerDelta: Float = 0.14f,
    val minLockFrames: Int = 3,
    val maxMissFrames: Int = 2,
    val autoCaptureMaxCornerDelta: Float = 0.016f,
    val autoCaptureHoldDurationMs: Long = 900L,
    val minLuminance: Float = 35f,
    val minSharpnessVariance: Float = 16f,
    val maxMotionDelta: Float = 0.055f,
    val cooldownMs: Long = 2200L,
    val duplicateShiftThreshold: Float = 0.06f,
)

data class StabilizerState(
    val overlayQuad: NormalizedQuad? = null,
    val isLocked: Boolean = false,
    val autoCaptureProgress: Float = 0f,
    val shouldTriggerAutoCapture: Boolean = false,
    val userHint: CameraUserHint = CameraUserHint.ALIGN_DOCUMENT,
    val lastConfidence: Float = 0f,
)

/**
 * Pure Kotlin temporal stabilizer for document boundary overlay and Auto-Capture eligibility.
 * Aligns corner ordering across frames, smoothly tracks gradual movement without dropping lock,
 * rejects single-frame outlier jumps, tolerates brief detection dropouts, and enforces strict
 * steadiness/quality/cooldown/duplicate checks before Auto-Capture triggers.
 */
class QuadStabilizer(
    private val config: StabilizerConfig = StabilizerConfig(),
) {
    private var lastValidQuad: NormalizedQuad? = null
    private var trackedQuad: NormalizedQuad? = null
    private var lockStreakCount = 0
    private var missStreakCount = 0

    private var candidateJumpQuad: NormalizedQuad? = null
    private var jumpConfirmCount = 0

    private var steadyAnchorQuad: NormalizedQuad? = null
    private var steadyStartMs: Long? = null

    private var lastAutoCaptureMs: Long? = null
    private var lastCapturedQuad: NormalizedQuad? = null
    private var seenShiftOrExitSinceCapture = true

    fun update(
        detectedQuad: NormalizedQuad?,
        confidence: Float,
        quality: FrameQualityMetrics,
        autoCaptureEnabled: Boolean,
        nowMs: Long,
    ): StabilizerState {
        val rawValid = detectedQuad?.takeIf { confidence >= config.minConfidence && it.isValidConvex() }

        if (rawValid == null) {
            missStreakCount++
            steadyAnchorQuad = null
            steadyStartMs = null
            candidateJumpQuad = null
            jumpConfirmCount = 0

            val lastCapturedAt = lastAutoCaptureMs
            if (lastCapturedAt != null && missStreakCount >= config.maxMissFrames) {
                // Removing the page clearly breaks duplicate protection
                seenShiftOrExitSinceCapture = true
            }

            val heldOverlay = trackedQuad ?: lastValidQuad
            if (missStreakCount <= config.maxMissFrames && lockStreakCount >= config.minLockFrames && heldOverlay != null) {
                return StabilizerState(
                    overlayQuad = heldOverlay,
                    isLocked = true,
                    autoCaptureProgress = 0f,
                    shouldTriggerAutoCapture = false,
                    userHint = determineHint(hasQuad = true, quality = quality, inCooldown = isInCooldown(nowMs)),
                    lastConfidence = confidence,
                )
            }

            if (missStreakCount > config.maxMissFrames) {
                lastValidQuad = null
                trackedQuad = null
                lockStreakCount = 0
            }

            return StabilizerState(
                overlayQuad = null,
                isLocked = false,
                autoCaptureProgress = 0f,
                shouldTriggerAutoCapture = false,
                userHint = if (quality.meanLuminance < config.minLuminance) CameraUserHint.LOW_LIGHT else CameraUserHint.ALIGN_DOCUMENT,
                lastConfidence = confidence,
            )
        }

        // Valid detection present: align corner indices against active reference to avoid ~45-deg swaps
        missStreakCount = 0
        val wasLocked = lockStreakCount >= config.minLockFrames && trackedQuad != null
        val referenceQuad = trackedQuad ?: lastValidQuad
        val alignedQuad = if (referenceQuad != null) rawValid.alignCornersTo(referenceQuad) else rawValid

        val activeQuad: NormalizedQuad
        val isLocked: Boolean
        val rawDeltaFromPrev: Float

        if (wasLocked && trackedQuad != null) {
            val prevTracked = trackedQuad!!
            val deltaFromTracked = prevTracked.maxCornerDistance(alignedQuad)

            if (deltaFromTracked <= config.maxTrackingCornerDelta) {
                // Smooth tracking & panning: keep lock alive and filter jitter with velocity-adaptive EMA
                candidateJumpQuad = null
                jumpConfirmCount = 0
                rawDeltaFromPrev = lastValidQuad?.let { it.maxCornerDistance(alignedQuad) } ?: deltaFromTracked
                val alpha = when {
                    deltaFromTracked <= 0.012f -> 0.24f
                    deltaFromTracked <= 0.045f -> 0.44f
                    else -> 0.68f
                }
                val smoothed = prevTracked.lerpTo(alignedQuad, alpha)
                trackedQuad = smoothed
                lastValidQuad = alignedQuad
                lockStreakCount++
                activeQuad = smoothed
                isLocked = true
            } else {
                // Large jump: reject single-frame outlier spikes; require 2 consistent frames to accept relocation
                val pendingJump = candidateJumpQuad
                if (pendingJump != null && pendingJump.alignCornersTo(alignedQuad).maxCornerDistance(alignedQuad) <= config.maxLockCornerDelta * 1.5f) {
                    jumpConfirmCount++
                } else {
                    candidateJumpQuad = alignedQuad
                    jumpConfirmCount = 1
                }

                if (jumpConfirmCount >= 2) {
                    candidateJumpQuad = null
                    jumpConfirmCount = 0
                    trackedQuad = alignedQuad
                    lastValidQuad = alignedQuad
                    steadyAnchorQuad = null
                    steadyStartMs = null
                    rawDeltaFromPrev = config.maxTrackingCornerDelta
                    activeQuad = alignedQuad
                    isLocked = true
                } else {
                    // Hold existing smooth overlay for 1 outlier frame without triggering auto-capture
                    steadyAnchorQuad = null
                    steadyStartMs = null
                    return StabilizerState(
                        overlayQuad = prevTracked,
                        isLocked = true,
                        autoCaptureProgress = 0f,
                        shouldTriggerAutoCapture = false,
                        userHint = determineHint(hasQuad = true, quality = quality, inCooldown = isInCooldown(nowMs)),
                        lastConfidence = confidence,
                    )
                }
            }
        } else {
            // Acquiring lock: require minLockFrames consistent frames
            val prev = lastValidQuad
            rawDeltaFromPrev = if (prev != null) prev.maxCornerDistance(alignedQuad) else 0f
            if (prev != null && rawDeltaFromPrev <= config.maxLockCornerDelta) {
                lockStreakCount++
            } else {
                lockStreakCount = 1
            }
            lastValidQuad = alignedQuad
            isLocked = lockStreakCount >= config.minLockFrames
            if (isLocked) {
                trackedQuad = alignedQuad
            }
            activeQuad = trackedQuad ?: alignedQuad
        }

        // Track scene change for duplicate protection after a previous capture
        val capturedRef = lastCapturedQuad
        if (capturedRef != null && !seenShiftOrExitSinceCapture) {
            val alignedToCaptured = alignedQuad.alignCornersTo(capturedRef)
            if (capturedRef.maxCornerDistance(alignedToCaptured) >= config.duplicateShiftThreshold) {
                seenShiftOrExitSinceCapture = true
            }
        }

        val inCooldown = isInCooldown(nowMs)
        val duplicateBlocked = capturedRef != null && !seenShiftOrExitSinceCapture

        if (!autoCaptureEnabled || !isLocked || inCooldown || duplicateBlocked) {
            steadyAnchorQuad = null
            steadyStartMs = null
            val hint = when {
                inCooldown || duplicateBlocked -> CameraUserHint.CAPTURING_NEXT_COOLDOWN
                !isLocked -> CameraUserHint.HOLD_STEADY
                quality.meanLuminance < config.minLuminance -> CameraUserHint.LOW_LIGHT
                else -> CameraUserHint.LOCKED_READY
            }
            return StabilizerState(
                overlayQuad = if (isLocked) activeQuad else null,
                isLocked = isLocked,
                autoCaptureProgress = 0f,
                shouldTriggerAutoCapture = false,
                userHint = hint,
                lastConfidence = confidence,
            )
        }

        // Check camera steadiness, focus sharpness, lighting, and raw frame-to-frame stability
        val lightingOk = quality.meanLuminance >= config.minLuminance
        val sharpnessOk = quality.sharpnessVariance >= config.minSharpnessVariance
        val motionOk = quality.motionDelta <= config.maxMotionDelta
        val frameSteady = rawDeltaFromPrev <= config.autoCaptureMaxCornerDelta

        if (!lightingOk || !sharpnessOk || !motionOk || !frameSteady) {
            steadyAnchorQuad = null
            steadyStartMs = null
            return StabilizerState(
                overlayQuad = activeQuad,
                isLocked = true,
                autoCaptureProgress = 0f,
                shouldTriggerAutoCapture = false,
                userHint = if (!lightingOk) CameraUserHint.LOW_LIGHT else CameraUserHint.BLURRY_OR_MOVING,
                lastConfidence = confidence,
            )
        }

        // Verify corner steadiness across hold window using raw aligned quad (never capture a drifting quad)
        val anchor = steadyAnchorQuad
        val start = steadyStartMs
        if (anchor != null && start != null && anchor.maxCornerDistance(alignedQuad) <= config.autoCaptureMaxCornerDelta) {
            val heldMs = (nowMs - start).coerceAtLeast(0L)
            val progress = (heldMs.toFloat() / config.autoCaptureHoldDurationMs.toFloat()).coerceIn(0f, 1f)
            val readyToFire = heldMs >= config.autoCaptureHoldDurationMs
            return StabilizerState(
                overlayQuad = activeQuad,
                isLocked = true,
                autoCaptureProgress = progress,
                shouldTriggerAutoCapture = readyToFire,
                userHint = CameraUserHint.HOLD_STEADY,
                lastConfidence = confidence,
            )
        } else {
            steadyAnchorQuad = alignedQuad
            steadyStartMs = nowMs
            return StabilizerState(
                overlayQuad = activeQuad,
                isLocked = true,
                autoCaptureProgress = 0f,
                shouldTriggerAutoCapture = false,
                userHint = CameraUserHint.HOLD_STEADY,
                lastConfidence = confidence,
            )
        }
    }

    /**
     * Must be invoked whenever a capture (manual or automatic) occurs so cooldown
     * and duplicate-capture protection engage cleanly.
     */
    fun notifyCaptureTriggered(nowMs: Long, capturedQuad: NormalizedQuad?) {
        lastAutoCaptureMs = nowMs
        lastCapturedQuad = capturedQuad
        seenShiftOrExitSinceCapture = capturedQuad == null
        steadyAnchorQuad = null
        steadyStartMs = null
    }

    fun reset() {
        lastValidQuad = null
        trackedQuad = null
        lockStreakCount = 0
        missStreakCount = 0
        candidateJumpQuad = null
        jumpConfirmCount = 0
        steadyAnchorQuad = null
        steadyStartMs = null
        lastAutoCaptureMs = null
        lastCapturedQuad = null
        seenShiftOrExitSinceCapture = true
    }

    private fun isInCooldown(nowMs: Long): Boolean {
        val last = lastAutoCaptureMs ?: return false
        return (nowMs - last) < config.cooldownMs
    }

    private fun determineHint(hasQuad: Boolean, quality: FrameQualityMetrics, inCooldown: Boolean): CameraUserHint {
        return when {
            inCooldown -> CameraUserHint.CAPTURING_NEXT_COOLDOWN
            quality.meanLuminance < config.minLuminance -> CameraUserHint.LOW_LIGHT
            hasQuad && (quality.motionDelta > config.maxMotionDelta || quality.sharpnessVariance < config.minSharpnessVariance) ->
                CameraUserHint.BLURRY_OR_MOVING
            hasQuad -> CameraUserHint.LOCKED_READY
            else -> CameraUserHint.ALIGN_DOCUMENT
        }
    }
}
