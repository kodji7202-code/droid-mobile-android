package com.droidmobile.client

import android.content.Context

/** Minimal key-value surface so the stop-request logic runs in JVM tests. */
interface FlagStorage {
    fun getBoolean(key: String): Boolean
    fun putBoolean(key: String, value: Boolean)
}

/**
 * Remembers that the user pressed Stop in the notification. The WebView owns the
 * "stay connected" setting, so it reads and clears this flag to switch the setting
 * off, even if it was not running at the moment of the tap.
 */
class StopRequestStore(private val storage: FlagStorage) {
    fun markRequested() = storage.putBoolean(KEY, true)

    /** Returns whether a stop was requested since the last call and clears the flag. */
    fun consume(): Boolean {
        val requested = storage.getBoolean(KEY)
        if (requested) storage.putBoolean(KEY, false)
        return requested
    }

    companion object {
        private const val KEY = "stopRequested"

        fun from(context: Context): StopRequestStore {
            val prefs = context.applicationContext.getSharedPreferences("daemon_service", Context.MODE_PRIVATE)
            return StopRequestStore(
                object : FlagStorage {
                    override fun getBoolean(key: String) = prefs.getBoolean(key, false)

                    override fun putBoolean(key: String, value: Boolean) {
                        prefs.edit().putBoolean(key, value).apply()
                    }
                },
            )
        }
    }
}
