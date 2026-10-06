package com.droidmobile.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationPrefsTest {
    private class MemoryStorage : DefaultingFlagStorage {
        val values = mutableMapOf<String, Boolean>()

        override fun getBoolean(key: String, default: Boolean) = values[key] ?: default

        override fun putBoolean(key: String, value: Boolean) {
            values[key] = value
        }
    }

    @Test
    fun allowsBothChannelsBeforeTheWebViewConfiguredAnything() {
        val prefs = NotificationPrefs(MemoryStorage())
        assertTrue(prefs.allows(NotificationChannels.APPROVALS_ID))
        assertTrue(prefs.allows(NotificationChannels.TURNS_ID))
    }

    @Test
    fun masterSwitchOffBlocksEveryChannel() {
        val prefs = NotificationPrefs(MemoryStorage())
        prefs.set(master = false, approvals = true, turns = true)
        assertFalse(prefs.allows(NotificationChannels.APPROVALS_ID))
        assertFalse(prefs.allows(NotificationChannels.TURNS_ID))
    }

    @Test
    fun disabledChannelIsBlockedWhileTheOtherStaysAllowed() {
        val prefs = NotificationPrefs(MemoryStorage())
        prefs.set(master = true, approvals = true, turns = false)
        assertTrue(prefs.allows(NotificationChannels.APPROVALS_ID))
        assertFalse(prefs.allows(NotificationChannels.TURNS_ID))
    }

    @Test
    fun theServiceChannelIsNotPostedThroughThePreferences() {
        assertFalse(NotificationPrefs(MemoryStorage()).allows(NotificationChannels.SERVICE_ID))
    }

    @Test
    fun channelsHaveTheSpecifiedImportance() {
        assertEquals(android.app.NotificationManager.IMPORTANCE_HIGH, NotificationChannels.importanceOf("approvals"))
        assertEquals(android.app.NotificationManager.IMPORTANCE_DEFAULT, NotificationChannels.importanceOf("turns"))
        assertEquals(android.app.NotificationManager.IMPORTANCE_LOW, NotificationChannels.importanceOf("service"))
        assertEquals(listOf("approvals", "turns", "service"), NotificationChannels.SPECS.map { it.id })
    }
}
