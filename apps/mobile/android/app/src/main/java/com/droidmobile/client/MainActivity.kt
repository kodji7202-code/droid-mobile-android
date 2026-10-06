package com.droidmobile.client

import android.os.Build
import android.os.Bundle
import android.view.View
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(DaemonServicePlugin::class.java)
        registerPlugin(AppNotificationsPlugin::class.java)
        super.onCreate(savedInstanceState)
        // Channels exist from the first launch, before the WebView has translated their names.
        NotificationChannels.ensureAll(this)
        excludeFromAutofill()
    }

    // The API key and the bridge secret are typed into web inputs; a platform autofill service
    // (Samsung Pass, Google) must neither offer to save them nor fill them.
    private fun excludeFromAutofill() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mode = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        window.decorView.importantForAutofill = mode
        bridge?.webView?.importantForAutofill = mode
    }
}
