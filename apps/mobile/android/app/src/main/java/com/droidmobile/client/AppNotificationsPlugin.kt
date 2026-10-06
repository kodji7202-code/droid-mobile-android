package com.droidmobile.client

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.lang.ref.WeakReference

/**
 * Local notifications for permission requests and finished turns, the Android 13+
 * notification permission flow and the channel setup. The WebView decides what to show and
 * when (it owns the daemon socket); this plugin only posts, cancels and reports taps.
 */
@CapacitorPlugin(
    name = "AppNotifications",
    permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")],
)
class AppNotificationsPlugin : Plugin() {
    override fun load() {
        instance = WeakReference(this)
        // A cold start from a notification tap: the listener is added later, so keep the event.
        deliverTap(activity?.intent)
    }

    override fun handleOnDestroy() {
        if (instance?.get() === this) instance = null
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        deliverTap(intent)
    }

    private fun deliverTap(intent: Intent?) {
        val sessionId = intent?.getStringExtra(AppNotifier.EXTRA_SESSION_ID)?.takeIf { it.isNotBlank() } ?: return
        // Consumed: a recreated activity must not navigate again.
        intent.removeExtra(AppNotifier.EXTRA_SESSION_ID)
        notifyListeners("notificationTapped", JSObject().put("sessionId", sessionId), true)
    }

    @PluginMethod
    fun checkPermission(call: PluginCall) = resolveGranted(call)

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        val needsPrompt = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            getPermissionState("notifications") != PermissionState.GRANTED
        if (needsPrompt) requestPermissionForAlias("notifications", call, "permissionResult") else resolveGranted(call)
    }

    @PermissionCallback
    fun permissionResult(call: PluginCall) = resolveGranted(call)

    private fun resolveGranted(call: PluginCall) {
        call.resolve(JSObject().put("granted", AppNotifier.canPost(context)))
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val candidates = listOf(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
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

    @PluginMethod
    fun configure(call: PluginCall) {
        val names = call.getObject("channelNames") ?: JSObject()
        NotificationChannels.ensureAll(
            context,
            NotificationChannels.SPECS.associate { it.id to names.optString(it.id, "") },
        )
        NotificationPrefs.from(context).set(
            master = call.getBoolean("enabled", true) ?: true,
            approvals = call.getBoolean("approvals", true) ?: true,
            turns = call.getBoolean("turns", true) ?: true,
        )
        call.resolve()
    }

    @PluginMethod
    fun post(call: PluginCall) {
        val tag = call.getString("tag")
        val channel = call.getString("channel")
        if (tag.isNullOrBlank() || channel.isNullOrBlank()) {
            call.reject("tag and channel are required", "INVALID_ARGUMENT")
            return
        }
        val posted = AppNotifier.post(
            context,
            AppNotification(
                tag = tag,
                channel = channel,
                title = call.getString("title").orEmpty(),
                text = call.getString("text").orEmpty(),
                sessionId = call.getString("sessionId").orEmpty(),
                approveRequestId = call.getString("approveRequestId"),
                approveLabel = call.getString("approveLabel"),
            ),
        )
        call.resolve(JSObject().put("posted", posted))
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        call.getString("tag")?.let { AppNotifier.cancel(context, it) }
        call.resolve()
    }

    companion object {
        private var instance: WeakReference<AppNotificationsPlugin>? = null

        fun notifyApprove(requestId: String, sessionId: String) {
            instance?.get()?.notifyListeners(
                "notificationApproved",
                JSObject().put("requestId", requestId).put("sessionId", sessionId),
            )
        }
    }
}
