package com.droidmobile.client

import org.junit.Assert.assertEquals
import org.junit.Test

class ServiceTextsTest {
    private val defaults = ServiceTexts("Default title", "Default text", "Stop")

    @Test
    fun usesProvidedTexts() {
        val texts = ServiceTexts.resolve("Titlu", "Text", "Opre?te", defaults)
        assertEquals(ServiceTexts("Titlu", "Text", "Opre?te"), texts)
    }

    @Test
    fun blankOrMissingValuesFallBackToDefaults() {
        val texts = ServiceTexts.resolve("  ", null, "", defaults)
        assertEquals(defaults, texts)
    }

    @Test
    fun mixesProvidedAndDefaultValues() {
        val texts = ServiceTexts.resolve("Titlu", null, "Opre?te", defaults)
        assertEquals(ServiceTexts("Titlu", "Default text", "Opre?te"), texts)
    }
}
