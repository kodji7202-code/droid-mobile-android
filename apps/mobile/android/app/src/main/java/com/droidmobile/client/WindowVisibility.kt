package com.droidmobile.client

import android.view.View

/**
 * Chromium hides a WebView whose window is not visible and, 60 s later, freezes its page: timers stop and
 * the daemon WebSocket is closed. While the foreground service runs, the WebView therefore keeps reporting
 * a visible window so a screen-off turn still reaches the page and its notification code.
 */
object WindowVisibility {
    fun effective(real: Int, keepPageAlive: Boolean): Int =
        if (keepPageAlive && real != View.VISIBLE) View.VISIBLE else real
}
