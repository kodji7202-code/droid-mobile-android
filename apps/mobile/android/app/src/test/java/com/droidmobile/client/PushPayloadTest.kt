package com.droidmobile.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PushPayloadTest {
    private fun extras(vararg pairs: Pair<String, String>): (String) -> String? = mapOf(*pairs)::get

    @Test
    fun routesEachKindToItsChannel() {
        assertEquals("approvals", PushPayload.channelOf("permission_prompt"))
        assertEquals("turns", PushPayload.channelOf("idle_prompt"))
        assertEquals("turns", PushPayload.channelOf("stop"))
    }

    @Test
    fun unknownKindsHaveNoChannel() {
        assertNull(PushPayload.channelOf("auth_success"))
        assertNull(PushPayload.channelOf(""))
        assertNull(PushPayload.channelOf(null))
    }

    @Test
    fun readsTheSessionIdOfAPush() {
        val id = "8f0c2f0e-6a52-4b6e-9d0b-1f9f3c1d2a77"
        assertEquals(id, PushPayload.sessionIdOf(extras("kind" to "stop", "sessionId" to id)))
        assertEquals(id, PushPayload.sessionIdOf(extras("kind" to "permission_prompt", "sessionId" to id)))
    }

    @Test
    fun ignoresIntentsThatAreNotAPush() {
        assertNull(PushPayload.sessionIdOf(extras("sessionId" to "abc")))
        assertNull(PushPayload.sessionIdOf(extras("kind" to "unknown", "sessionId" to "abc")))
        assertNull(PushPayload.sessionIdOf(extras("kind" to "stop")))
    }

    @Test
    fun rejectsIdsThatCannotBeADaemonSessionId() {
        for (bad in listOf("", "../x", "a/b", "a b", "x".repeat(129), "id?query=1")) {
            assertNull(bad, PushPayload.sessionIdOf(extras("kind" to "stop", "sessionId" to bad)))
        }
    }

    @Test
    fun approvalsTagMatchesTheBridge() {
        assertEquals("approvals:s1", PushPayload.approvalsTag("s1"))
    }
}
