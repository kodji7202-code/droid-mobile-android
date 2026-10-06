package com.droidmobile.client

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(DaemonServicePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
