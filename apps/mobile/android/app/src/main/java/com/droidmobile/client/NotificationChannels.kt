package com.droidmobile.client

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

/** Channel ids and importances; the names come from the WebView in the app language. */
data class ChannelSpec(val id: String, val importance: Int)

object NotificationChannels {
    const val APPROVALS_ID = "approvals"
    const val TURNS_ID = "turns"
    const val SERVICE_ID = "service"

    /**
     * Approvals peek (high), turn results are audible but quiet (default), the persistent
     * service notification must never make a sound or peek (low).
     */
    val SPECS = listOf(
        ChannelSpec(APPROVALS_ID, NotificationManager.IMPORTANCE_HIGH),
        ChannelSpec(TURNS_ID, NotificationManager.IMPORTANCE_DEFAULT),
        ChannelSpec(SERVICE_ID, NotificationManager.IMPORTANCE_LOW),
    )

    fun importanceOf(id: String): Int? = SPECS.firstOrNull { it.id == id }?.importance

    /** Names per channel id; a missing or blank name falls back to the strings.xml value. */
    fun ensureAll(context: Context, names: Map<String, String> = emptyMap()) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        for (spec in SPECS) {
            val name = names[spec.id]?.takeIf { it.isNotBlank() } ?: defaultName(context, spec.id)
            // Re-creating an existing channel only renames it: Android keeps the importance the user may have changed.
            val channel = NotificationChannel(spec.id, name, spec.importance)
            if (spec.id == SERVICE_ID) channel.setShowBadge(false)
            manager.createNotificationChannel(channel)
        }
    }

    fun ensureService(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(SERVICE_ID) != null) return
        ensureAll(context)
    }

    private fun defaultName(context: Context, id: String): String =
        context.getString(
            when (id) {
                APPROVALS_ID -> R.string.channel_approvals_name
                TURNS_ID -> R.string.channel_turns_name
                else -> R.string.channel_service_name
            },
        )
}
