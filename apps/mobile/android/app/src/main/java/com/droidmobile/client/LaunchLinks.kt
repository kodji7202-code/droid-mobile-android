package com.droidmobile.client

import android.content.Intent

object LaunchLinks {
    // Android relaunches a task from Recents with the intent that first started it, so a
    // droidmobile://pair link the user already handled would be delivered a second time.
    // Launchers do not always add FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY (the API 36 emulator
    // does not), but a relaunch after process death always has saved instance state, and a
    // link sent to a restored task arrives through onNewIntent instead.
    fun isReplay(flags: Int, restoredState: Boolean): Boolean =
        restoredState || flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0

    fun dropDataIfReplay(flags: Int, restoredState: Boolean, clearData: () -> Unit): Boolean {
        if (!isReplay(flags, restoredState)) return false
        clearData()
        return true
    }

    fun dropDataIfReplay(intent: Intent?, restoredState: Boolean): Boolean {
        if (intent == null) return false
        return dropDataIfReplay(intent.flags, restoredState) { intent.data = null }
    }

    // The activity keeps its original intent for re-reads; a handled link must not outlive delivery.
    fun withoutData(intent: Intent): Intent = Intent(intent).setData(null)
}
