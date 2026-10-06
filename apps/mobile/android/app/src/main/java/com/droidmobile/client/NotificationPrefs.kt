package com.droidmobile.client

import android.content.Context

/** Key-value surface with a default, so the preference logic runs in JVM tests. */
interface DefaultingFlagStorage {
    fun getBoolean(key: String, default: Boolean): Boolean
    fun putBoolean(key: String, value: Boolean)
}

/**
 * The user's in-app notification choices (master switch and per-channel switches).
 * Android cannot lower the importance of an existing channel from code, so a disabled
 * channel is honoured by not posting to it; the WebView owns the values and pushes them here.
 */
class NotificationPrefs(private val storage: DefaultingFlagStorage) {
    fun set(master: Boolean, approvals: Boolean, turns: Boolean) {
        storage.putBoolean(MASTER, master)
        storage.putBoolean(NotificationChannels.APPROVALS_ID, approvals)
        storage.putBoolean(NotificationChannels.TURNS_ID, turns)
    }

    /** Only the channels the app posts to have a switch; anything else is not allowed. */
    fun allows(channelId: String): Boolean {
        if (!storage.getBoolean(MASTER, true)) return false
        return when (channelId) {
            NotificationChannels.APPROVALS_ID, NotificationChannels.TURNS_ID -> storage.getBoolean(channelId, true)
            else -> false
        }
    }

    companion object {
        private const val MASTER = "master"

        fun from(context: Context): NotificationPrefs {
            val prefs = context.applicationContext.getSharedPreferences("app_notifications", Context.MODE_PRIVATE)
            return NotificationPrefs(
                object : DefaultingFlagStorage {
                    override fun getBoolean(key: String, default: Boolean) = prefs.getBoolean(key, default)

                    override fun putBoolean(key: String, value: Boolean) {
                        prefs.edit().putBoolean(key, value).apply()
                    }
                },
            )
        }
    }
}
