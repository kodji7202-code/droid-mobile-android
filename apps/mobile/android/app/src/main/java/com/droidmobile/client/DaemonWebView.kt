package com.droidmobile.client

import android.content.Context
import android.util.AttributeSet
import com.getcapacitor.CapacitorWebView
import java.lang.ref.WeakReference

/** Capacitor's WebView, kept out of Chromium's background freezing while [DaemonService] runs. */
class DaemonWebView(context: Context, attrs: AttributeSet) : CapacitorWebView(context, attrs) {
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        current = WeakReference(this)
    }

    override fun onDetachedFromWindow() {
        if (current?.get() === this) current = null
        super.onDetachedFromWindow()
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(WindowVisibility.effective(visibility, DaemonService.running))
    }

    private fun applyWindowVisibility() = onWindowVisibilityChanged(windowVisibility)

    companion object {
        private var current: WeakReference<DaemonWebView>? = null

        /** The service started or stopped while the window may already be hidden: re-evaluate what the page sees. */
        fun onServiceStateChanged() {
            val view = current?.get() ?: return
            view.post { view.applyWindowVisibility() }
        }
    }
}
