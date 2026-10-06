package com.droidmobile.client

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

object NotificationChannels {
    const val SERVICE_ID = "service"

    /** Low importance: the persistent service notification must never make a sound or peek. */
    fun ensureService(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(SERVICE_ID) != null) return
        val channel = NotificationChannel(
            SERVICE_ID,
            context.getString(R.string.channel_service_name),
            NotificationManager.IMPORTANCE_LOW,
        )
        channel.setShowBadge(false)
        manager.createNotificationChannel(channel)
    }
}
