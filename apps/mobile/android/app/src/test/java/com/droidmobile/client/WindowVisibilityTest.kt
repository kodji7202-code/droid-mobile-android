package com.droidmobile.client

import android.view.View
import org.junit.Assert.assertEquals
import org.junit.Test

class WindowVisibilityTest {
    @Test
    fun hiddenWindowStaysVisibleToThePageWhileTheServiceRuns() {
        assertEquals(View.VISIBLE, WindowVisibility.effective(View.GONE, keepPageAlive = true))
        assertEquals(View.VISIBLE, WindowVisibility.effective(View.INVISIBLE, keepPageAlive = true))
    }

    @Test
    fun visibleWindowIsUnchangedWhileTheServiceRuns() {
        assertEquals(View.VISIBLE, WindowVisibility.effective(View.VISIBLE, keepPageAlive = true))
    }

    @Test
    fun realVisibilityPassesThroughWithoutTheService() {
        assertEquals(View.GONE, WindowVisibility.effective(View.GONE, keepPageAlive = false))
        assertEquals(View.INVISIBLE, WindowVisibility.effective(View.INVISIBLE, keepPageAlive = false))
        assertEquals(View.VISIBLE, WindowVisibility.effective(View.VISIBLE, keepPageAlive = false))
    }
}
