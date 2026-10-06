package com.droidmobile.client

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(DaemonServicePlugin::class.java)
        registerPlugin(AppNotificationsPlugin::class.java)
        super.onCreate(savedInstanceState)
        // Channels exist from the first launch, before the WebView has translated their names.
        NotificationChannels.ensureAll(this)
    }
}
