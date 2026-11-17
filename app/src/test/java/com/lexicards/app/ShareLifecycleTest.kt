package com.lexicards.app

import android.content.ClipData
import android.content.Intent
import android.os.Looper
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(org.robolectric.RobolectricTestRunner::class)
@Config(sdk = [35])
@LooperMode(LooperMode.Mode.PAUSED)
class ShareLifecycleTest {
    private fun shared(value: String) = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, value)
    private fun awaitText(activity: MainActivity): JSONObject {
        val deadline = System.nanoTime() + 5_000_000_000L
        while (System.nanoTime() < deadline) {
            shadowOf(Looper.getMainLooper()).idle()
            val raw = activity.NativeBridge().peekSharedText()
            if (raw != "null") return JSONObject(raw)
            Thread.sleep(10)
        }
        throw AssertionError("The shared text did not reach the durable inbox")
    }
    private fun launch(intent: Intent): ActivityController<MainActivity> =
        Robolectric.buildActivity(MainActivity::class.java, intent).setup()

    @Test fun coldLaunchQueuesTextUntilAcknowledged() {
        val c = launch(shared("word"))
        try {
            val first = awaitText(c.get())
            assertEquals("word", first.getString("text"))
            assertEquals(first.toString(), c.get().NativeBridge().peekSharedText())
            assertFalse(c.get().NativeBridge().acknowledgeSharedText("wrong-id"))
            assertTrue(c.get().NativeBridge().acknowledgeSharedText(first.getString("id")))
            assertEquals("null", c.get().NativeBridge().peekSharedText())
        } finally { c.pause().stop().destroy() }
    }
    @Test fun warmActivityReceivesSuccessiveWordAndExampleInOrder() {
        val c = launch(Intent(Intent.ACTION_MAIN))
        try {
            c.newIntent(shared("word"))
            val word = awaitText(c.get())
            c.newIntent(shared("This is the example."))
            assertTrue(c.get().NativeBridge().acknowledgeSharedText(word.getString("id")))
            assertEquals("This is the example.", awaitText(c.get()).getString("text"))
        } finally { c.pause().stop().destroy() }
    }
    @Test fun activityRecreationDoesNotDuplicateTheOriginalShare() {
        val c = launch(shared("persisted"))
        try {
            val original = awaitText(c.get())
            c.recreate()
            assertEquals(original.toString(), awaitText(c.get()).toString())
            assertTrue(c.get().NativeBridge().acknowledgeSharedText(original.getString("id")))
            assertEquals("null", c.get().NativeBridge().peekSharedText())
        } finally { c.pause().stop().destroy() }
    }
    @Test fun clipTextIsAcceptedAndTaskHistoryDoesNotReplayOldShares() {
        val incoming = Intent(Intent.ACTION_SEND).setType("text/plain").apply { clipData = ClipData.newPlainText("selection", "selected text") }
        val c = launch(incoming)
        try {
            val selected = awaitText(c.get())
            assertEquals("selected text", selected.getString("text"))
            assertTrue(c.get().NativeBridge().acknowledgeSharedText(selected.getString("id")))
            c.newIntent(shared("old").addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY))
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals("null", c.get().NativeBridge().peekSharedText())
        } finally { c.pause().stop().destroy() }
    }
}
