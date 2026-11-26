package org.intabtools.intabpdf.platform

import android.app.Activity
import android.os.Looper
import android.view.WindowManager

/**
 * Abstraction for toggling Android's keep-screen-on window flag so lifecycle behavior can be
 * tested cleanly without Android framework dependencies.
 */
interface ScreenWakeFlagTarget {
    fun setKeepScreenOn(keepOn: Boolean)
}

/**
 * Applies or clears [WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON] on an [Activity] window.
 * Using window flags requires zero system permissions and ties wake behavior strictly to the
 * visible foreground Activity window.
 */
class ActivityScreenWakeFlagTarget(
    private val activity: Activity,
) : ScreenWakeFlagTarget {
    override fun setKeepScreenOn(keepOn: Boolean) {
        val apply = {
            if (!activity.isDestroyed && !activity.isFinishing) {
                val window = activity.window
                if (keepOn) {
                    window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                } else {
                    window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            apply()
        } else {
            activity.runOnUiThread(apply)
        }
    }
}

/**
 * Reusable foreground-scoped controller keeping the screen awake only while at least one
 * user-visible processing token is active AND the host Activity is in the started foreground
 * state. Never uses wake locks or alters system screen-timeout settings.
 */
class KeepScreenAwakeController(
    private val target: ScreenWakeFlagTarget,
    initialForeground: Boolean = false,
) {
    private val activeTokens = LinkedHashSet<String>()
    private var isForeground: Boolean = initialForeground
    private var appliedAwake: Boolean = false

    @Synchronized
    fun setActive(token: String, active: Boolean) {
        if (active) {
            activeTokens.add(token)
        } else {
            activeTokens.remove(token)
        }
        reconcileLocked()
    }

    @Synchronized
    fun onStart() {
        isForeground = true
        reconcileLocked()
    }

    @Synchronized
    fun onStop() {
        isForeground = false
        reconcileLocked()
    }

    @Synchronized
    fun onDestroy() {
        activeTokens.clear()
        isForeground = false
        if (appliedAwake) {
            appliedAwake = false
            target.setKeepScreenOn(false)
        }
    }

    @Synchronized
    fun clearAll() {
        activeTokens.clear()
        reconcileLocked()
    }

    @Synchronized
    fun isScreenAwake(): Boolean = appliedAwake

    @Synchronized
    fun hasActiveTokens(): Boolean = activeTokens.isNotEmpty()

    private fun reconcileLocked() {
        val desired = isForeground && activeTokens.isNotEmpty()
        if (desired != appliedAwake) {
            appliedAwake = desired
            target.setKeepScreenOn(desired)
        }
    }
}
