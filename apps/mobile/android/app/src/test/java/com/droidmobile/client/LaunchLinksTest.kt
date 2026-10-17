package com.droidmobile.client

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LaunchLinksTest {
    private val history = Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY
    private val newTask = Intent.FLAG_ACTIVITY_NEW_TASK

    @Test
    fun relaunchFromRecentsIsAReplay() {
        assertTrue(LaunchLinks.isReplay(history, restoredState = false))
        assertTrue(LaunchLinks.isReplay(newTask or history, restoredState = false))
    }

    @Test
    fun restoredStateIsAReplayEvenWithoutTheHistoryFlag() {
        assertTrue(LaunchLinks.isReplay(newTask, restoredState = true))
    }

    @Test
    fun freshLaunchesAreNotReplays() {
        assertFalse(LaunchLinks.isReplay(0, restoredState = false))
        assertFalse(LaunchLinks.isReplay(newTask, restoredState = false))
    }

    @Test
    fun replayedLaunchDataIsCleared() {
        var cleared = 0
        assertTrue(LaunchLinks.dropDataIfReplay(history, restoredState = false) { cleared++ })
        assertTrue(LaunchLinks.dropDataIfReplay(newTask, restoredState = true) { cleared++ })
        assertEquals(2, cleared)
    }

    @Test
    fun freshLaunchKeepsItsData() {
        var cleared = 0
        assertFalse(LaunchLinks.dropDataIfReplay(newTask, restoredState = false) { cleared++ })
        assertEquals(0, cleared)
    }

    @Test
    fun missingIntentIsIgnored() {
        assertFalse(LaunchLinks.dropDataIfReplay(null, restoredState = true))
    }
}
