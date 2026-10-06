package com.droidmobile.client

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** What the WebView asks to show: one notification per [tag], replaced when posted again. */
data class AppNotification(
    val tag: String,
    val channel: String,
    val title: String,
    val text: String,
    val sessionId: String,
    val approveRequestId: String?,
    val approveLabel: String?,
)

/** Posts and cancels the approval and turn notifications; every call is best effort and never throws. */
object AppNotifier {
    const val EXTRA_SESSION_ID = "com.droidmobile.client.extra.SESSION_ID"
    const val EXTRA_REQUEST_ID = "com.droidmobile.client.extra.REQUEST_ID"
    const val ACTION_APPROVE = "com.droidmobile.client.action.APPROVE_REQUEST"
    private const val NOTIFICATION_ID = 4102

    fun canPost(context: Context): Boolean {
        val permitted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        return permitted && NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /** Returns false when the user's switches or the system permission forbid the notification. */
    fun post(context: Context, notification: AppNotification): Boolean {
        if (!NotificationPrefs.from(context).allows(notification.channel) || !canPost(context)) return false
        NotificationChannels.ensureAll(context)
        val immutable = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        // PendingIntents ignore extras when matching, so every tag needs its own request code.
        val requestCode = notification.tag.hashCode()
        val open = PendingIntent.getActivity(
            context,
            requestCode,
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(EXTRA_SESSION_ID, notification.sessionId),
            immutable,
        )
        val approvals = notification.channel == NotificationChannels.APPROVALS_ID
        val builder = NotificationCompat.Builder(context, notification.channel)
            .setSmallIcon(R.drawable.ic_stat_service)
            .setContentTitle(notification.title)
            .setContentText(notification.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(notification.text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(if (approvals) NotificationCompat.CATEGORY_MESSAGE else NotificationCompat.CATEGORY_STATUS)
            .setPriority(if (approvals) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
        val approveId = notification.approveRequestId
        if (approveId != null && !notification.approveLabel.isNullOrBlank()) {
            val approve = PendingIntent.getBroadcast(
                context,
                requestCode,
                Intent(context, NotificationActionReceiver::class.java)
                    .setAction(ACTION_APPROVE)
                    .putExtra(EXTRA_REQUEST_ID, approveId)
                    .putExtra(EXTRA_SESSION_ID, notification.sessionId)
                    .putExtra(NotificationActionReceiver.EXTRA_TAG, notification.tag),
                immutable,
            )
            builder.addAction(0, notification.approveLabel, approve)
        }
        return try {
            NotificationManagerCompat.from(context).notify(notification.tag, NOTIFICATION_ID, builder.build())
            true
        } catch (_: SecurityException) {
            false
        }
    }

    fun cancel(context: Context, tag: String) {
        NotificationManagerCompat.from(context).cancel(tag, NOTIFICATION_ID)
    }
}
