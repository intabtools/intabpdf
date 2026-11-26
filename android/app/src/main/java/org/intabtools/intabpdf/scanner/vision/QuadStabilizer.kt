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
    val maxLockCornerDelta: Float = 0.032f,
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
 * Requires sustained 4-corner detection confidence, corner steadiness, camera steadiness,
 * adequate illumination/sharpness, post-capture cooldown, and duplicate-scene protection.
 */
class QuadStabilizer(
    private val config: StabilizerConfig = StabilizerConfig(),
) {
    private var lastValidQuad: NormalizedQuad? = null
    private var lockStreakCount = 0
    private var missStreakCount = 0

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
        val validQuad = detectedQuad?.takeIf { confidence >= config.minConfidence && it.isValidConvex() }

        if (validQuad == null) {
            missStreakCount++
            steadyAnchorQuad = null
            steadyStartMs = null

            val lastCapturedAt = lastAutoCaptureMs
            if (lastCapturedAt != null && missStreakCount >= config.maxMissFrames) {
                // Removing the page clearly breaks duplicate protection
                seenShiftOrExitSinceCapture = true
            }

            if (missStreakCount <= config.maxMissFrames && lockStreakCount >= config.minLockFrames && lastValidQuad != null) {
                return StabilizerState(
                    overlayQuad = lastValidQuad,
                    isLocked = true,
                    autoCaptureProgress = 0f,
                    shouldTriggerAutoCapture = false,
                    userHint = determineHint(hasQuad = true, quality = quality, inCooldown = isInCooldown(nowMs)),
                    lastConfidence = confidence,
                )
            }

            if (missStreakCount > config.maxMissFrames) {
                lastValidQuad = null
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

        // Valid detection present
        missStreakCount = 0
        val prev = lastValidQuad
        if (prev != null && prev.maxCornerDistance(validQuad) <= config.maxLockCornerDelta) {
            lockStreakCount++
        } else {
            lockStreakCount = 1
        }
        lastValidQuad = validQuad
        val isLocked = lockStreakCount >= config.minLockFrames

        // Track scene change for duplicate protection after a previous capture
        val capturedRef = lastCapturedQuad
        if (capturedRef != null && !seenShiftOrExitSinceCapture) {
            if (capturedRef.maxCornerDistance(validQuad) >= config.duplicateShiftThreshold) {
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
                overlayQuad = if (isLocked) validQuad else null,
                isLocked = isLocked,
                autoCaptureProgress = 0f,
                shouldTriggerAutoCapture = false,
                userHint = hint,
                lastConfidence = confidence,
            )
        }

        // Check camera steadiness, focus sharpness, and lighting
        val lightingOk = quality.meanLuminance >= config.minLuminance
        val sharpnessOk = quality.sharpnessVariance >= config.minSharpnessVariance
        val motionOk = quality.motionDelta <= config.maxMotionDelta

        if (!lightingOk || !sharpnessOk || !motionOk) {
            steadyAnchorQuad = null
            steadyStartMs = null
            return StabilizerState(
                overlayQuad = validQuad,
                isLocked = true,
                autoCaptureProgress = 0f,
                shouldTriggerAutoCapture = false,
                userHint = if (!lightingOk) CameraUserHint.LOW_LIGHT else CameraUserHint.BLURRY_OR_MOVING,
                lastConfidence = confidence,
            )
        }

        // Verify corner steadiness across hold window
        val anchor = steadyAnchorQuad
        val start = steadyStartMs
        if (anchor != null && start != null && anchor.maxCornerDistance(validQuad) <= config.autoCaptureMaxCornerDelta) {
            val heldMs = (nowMs - start).coerceAtLeast(0L)
            val progress = (heldMs.toFloat() / config.autoCaptureHoldDurationMs.toFloat()).coerceIn(0f, 1f)
            val readyToFire = heldMs >= config.autoCaptureHoldDurationMs
            return StabilizerState(
                overlayQuad = validQuad,
                isLocked = true,
                autoCaptureProgress = progress,
                shouldTriggerAutoCapture = readyToFire,
                userHint = CameraUserHint.HOLD_STEADY,
                lastConfidence = confidence,
            )
        } else {
            steadyAnchorQuad = validQuad
            steadyStartMs = nowMs
            return StabilizerState(
                overlayQuad = validQuad,
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
        lockStreakCount = 0
        missStreakCount = 0
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
