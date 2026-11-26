package org.intabtools.intabpdf.platform

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "ScreenAwake")
class ScreenAwakePlugin : Plugin() {

    private var controller: KeepScreenAwakeController? = null

    override fun load() {
        super.load()
        val host = activity ?: return
        val started = (host as? LifecycleOwner)
            ?.lifecycle
            ?.currentState
            ?.isAtLeast(Lifecycle.State.STARTED) == true
        controller = KeepScreenAwakeController(
            target = ActivityScreenWakeFlagTarget(host),
            initialForeground = started,
        )
    }

    @PluginMethod
    fun setKeepScreenAwake(call: PluginCall) {
        val active = call.getBoolean("active", false) ?: false
        val token = call.getString("token")?.takeIf { it.isNotBlank() } ?: DEFAULT_WEB_TOKEN
        val ctrl = controller
        if (ctrl != null) {
            ctrl.setActive(token, active)
        }
        call.resolve()
    }

    override fun handleOnStart() {
        super.handleOnStart()
        controller?.onStart()
    }

    override fun handleOnResume() {
        super.handleOnResume()
        controller?.onStart()
    }

    override fun handleOnStop() {
        controller?.onStop()
        super.handleOnStop()
    }

    override fun handleOnDestroy() {
        controller?.onDestroy()
        controller = null
        super.handleOnDestroy()
    }

    internal fun isScreenAwakeForTest(): Boolean = controller?.isScreenAwake() == true

    private companion object {
        const val DEFAULT_WEB_TOKEN = "web_processing"
    }
}
