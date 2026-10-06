package com.droidmobile.client

/** Texts of the persistent service notification; the WebView passes them in the app language. */
data class ServiceTexts(val title: String, val text: String, val stopLabel: String) {
    companion object {
        /** Blank or missing values fall back to the bundled (system language) defaults. */
        fun resolve(
            title: String?,
            text: String?,
            stopLabel: String?,
            defaults: ServiceTexts,
        ): ServiceTexts =
            ServiceTexts(
                title = title?.takeIf { it.isNotBlank() } ?: defaults.title,
                text = text?.takeIf { it.isNotBlank() } ?: defaults.text,
                stopLabel = stopLabel?.takeIf { it.isNotBlank() } ?: defaults.stopLabel,
            )
    }
}
