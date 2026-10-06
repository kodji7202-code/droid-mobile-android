package com.droidmobile.client

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StopRequestStoreTest {
    private class MemoryStorage : FlagStorage {
        private val values = mutableMapOf<String, Boolean>()

        override fun getBoolean(key: String) = values[key] ?: false

        override fun putBoolean(key: String, value: Boolean) {
            values[key] = value
        }
    }

    @Test
    fun noRequestByDefault() {
        assertFalse(StopRequestStore(MemoryStorage()).consume())
    }

    @Test
    fun requestIsReportedOnceAndThenCleared() {
        val store = StopRequestStore(MemoryStorage())
        store.markRequested()
        assertTrue(store.consume())
        assertFalse(store.consume())
    }
}
