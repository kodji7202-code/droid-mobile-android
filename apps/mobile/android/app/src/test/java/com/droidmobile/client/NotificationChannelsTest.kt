package com.droidmobile.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationChannelsTest {
    private class FakeStore(private val existing: Set<String> = emptySet()) : ChannelStore {
        var existingReads = 0
        val writes = mutableListOf<ChannelWrite>()

        override fun existingIds(): Set<String> {
            existingReads++
            return existing
        }

        override fun write(write: ChannelWrite) {
            writes += write
        }
    }

    private val romanian = mapOf("approvals" to "Cereri", "turns" to "Ture", "service" to "Conexiune")

    @Test
    fun touchesNoChannelApiBelowApi26() {
        for (sdk in listOf(24, 25)) {
            val store = FakeStore()
            NotificationChannels.apply(sdk, store, romanian)
            assertEquals(0, store.existingReads)
            assertTrue(store.writes.isEmpty())
        }
    }

    @Test
    fun createsAllThreeChannelsFromApi26() {
        val store = FakeStore()
        NotificationChannels.apply(26, store, romanian)
        assertEquals(listOf("approvals", "turns", "service"), store.writes.map { it.spec.id })
        assertEquals(listOf("Cereri", "Ture", "Conexiune"), store.writes.map { it.name })
    }

    @Test
    fun anEnsureOnlyCallKeepsTheNamesOfExistingChannels() {
        val store = FakeStore(existing = setOf("approvals", "turns", "service"))
        NotificationChannels.apply(34, store, emptyMap())
        assertTrue(store.writes.isEmpty())
    }

    @Test
    fun anEnsureOnlyCallCreatesJustTheMissingChannelsWithTheFallbackName() {
        val store = FakeStore(existing = setOf("approvals"))
        NotificationChannels.apply(34, store, mapOf("approvals" to " ", "turns" to ""))
        assertEquals(listOf("turns", "service"), store.writes.map { it.spec.id })
        assertTrue(store.writes.all { it.name == null })
    }

    @Test
    fun anExplicitNameRenamesAnExistingChannel() {
        val store = FakeStore(existing = setOf("approvals", "turns", "service"))
        NotificationChannels.apply(34, store, romanian)
        assertEquals(listOf("Cereri", "Ture", "Conexiune"), store.writes.map { it.name })
    }
}
