package com.droidmobile.client

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.annotation.RequiresApi

/** Channel ids and importances; the names come from the WebView in the app language. */
data class ChannelSpec(val id: String, val importance: Int)

/** A channel to create or rename; a null [name] means the strings.xml fallback. */
data class ChannelWrite(val spec: ChannelSpec, val name: String?)

/** The platform surface the channel logic needs, so the SDK-level rules run in JVM tests. */
interface ChannelStore {
    fun existingIds(): Set<String>

    fun write(write: ChannelWrite)
}

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

    /**
     * An explicit name always writes (renaming an existing channel keeps the importance the
     * user may have changed). Without one, a channel that already exists is left alone: the
     * name it carries was set in the app language, and the system language must not undo it.
     */
    fun plan(existing: Set<String>, names: Map<String, String>): List<ChannelWrite> =
        SPECS.mapNotNull { spec ->
            val name = names[spec.id]?.takeIf { it.isNotBlank() }
            if (name == null && spec.id in existing) null else ChannelWrite(spec, name)
        }

    /** Channels exist from API 26; below that the notification builder's channel id is ignored. */
    fun apply(sdkInt: Int, store: ChannelStore, names: Map<String, String>) {
        if (sdkInt < Build.VERSION_CODES.O) return
        for (write in plan(store.existingIds(), names)) store.write(write)
    }

    /** Names per channel id; a missing or blank name keeps an existing channel's name, else uses strings.xml. */
    fun ensureAll(context: Context, names: Map<String, String> = emptyMap()) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        apply(Build.VERSION.SDK_INT, SystemChannelStore(context, manager), names)
    }

    fun ensureService(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(SERVICE_ID) != null) return
        ensureAll(context)
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private class SystemChannelStore(
        private val context: Context,
        private val manager: NotificationManager,
    ) : ChannelStore {
        override fun existingIds(): Set<String> =
            SPECS.map { it.id }.filter { manager.getNotificationChannel(it) != null }.toSet()

        override fun write(write: ChannelWrite) {
            val name = write.name ?: defaultName(write.spec.id)
            val channel = NotificationChannel(write.spec.id, name, write.spec.importance)
            if (write.spec.id == SERVICE_ID) channel.setShowBadge(false)
            manager.createNotificationChannel(channel)
        }

        private fun defaultName(id: String): String =
            context.getString(
                when (id) {
                    APPROVALS_ID -> R.string.channel_approvals_name
                    TURNS_ID -> R.string.channel_turns_name
                    else -> R.string.channel_service_name
                },
            )
    }
}
