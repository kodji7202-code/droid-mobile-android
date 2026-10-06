package com.droidmobile.client

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Handles the Approve button of a permission-request notification without opening the app. */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AppNotifier.ACTION_APPROVE) return
        intent.getStringExtra(EXTRA_TAG)?.let { AppNotifier.cancel(context, it) }
        val requestId = intent.getStringExtra(AppNotifier.EXTRA_REQUEST_ID) ?: return
        val sessionId = intent.getStringExtra(AppNotifier.EXTRA_SESSION_ID).orEmpty()
        AppNotificationsPlugin.notifyApprove(requestId, sessionId)
    }

    companion object {
        const val EXTRA_TAG = "com.droidmobile.client.extra.TAG"
    }
}
