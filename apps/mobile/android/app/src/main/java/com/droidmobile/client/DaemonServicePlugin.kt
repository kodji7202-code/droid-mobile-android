package com.droidmobile.client

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.lang.ref.WeakReference

/** Bridge between the WebView (which owns the daemon socket) and [DaemonService]. */
@CapacitorPlugin(name = "DaemonService")
class DaemonServicePlugin : Plugin() {
    override fun load() {
        instance = WeakReference(this)
    }

    override fun handleOnDestroy() {
        if (instance?.get() === this) instance = null
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val texts = ServiceTexts(
            title = call.getString("title").orEmpty(),
            text = call.getString("text").orEmpty(),
            stopLabel = call.getString("stopLabel").orEmpty(),
        )
        try {
            DaemonService.start(context, texts)
            call.resolve()
        } catch (error: RuntimeException) {
            // Android refuses a foreground start from the background (Android 12+); report, never crash.
            call.reject("The foreground service could not start", "START_FAILED")
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        DaemonService.stop(context)
        call.resolve()
    }

    @PluginMethod
    fun isRunning(call: PluginCall) {
        call.resolve(JSObject().put("running", DaemonService.running))
    }

    @PluginMethod
    fun consumeStopRequest(call: PluginCall) {
        call.resolve(JSObject().put("requested", StopRequestStore.from(context).consume()))
    }

    @PluginMethod
    fun getBatteryState(call: PluginCall) {
        val power = context.getSystemService(PowerManager::class.java)
        val exempt = power?.isIgnoringBatteryOptimizations(context.packageName) == true
        call.resolve(JSObject().put("exempt", exempt))
    }

    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        val candidates = listOf(
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
        )
        for (intent in candidates) {
            try {
                activity.startActivity(intent)
                call.resolve()
                return
            } catch (_: ActivityNotFoundException) {
                // Try the next target.
            }
        }
        call.reject("No settings screen available", "NO_SETTINGS")
    }

    companion object {
        private var instance: WeakReference<DaemonServicePlugin>? = null

        fun notifyStopped() {
            instance?.get()?.notifyListeners("serviceStopped", JSObject())
        }

        fun notifyTimedOut() {
            instance?.get()?.notifyListeners("serviceTimedOut", JSObject())
        }
    }
}
