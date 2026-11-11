package com.lexicards.app

import org.junit.Assert.*
import org.junit.Test

class SharedTextIntakeTest {
    @Test fun acceptsWordsAndMultilineExamplesAsPlainText() {
        assertEquals("abandon", SharedTextIntake.parse("android.intent.action.SEND", "text/plain", " abandon ", null))
        assertEquals("Line one\nLine two", SharedTextIntake.parse("android.intent.action.SEND", "text/plain; charset=UTF-8", "Line one\nLine two", null))
    }
    @Test fun usesClipTextWhenTheExtraIsMissingOrBlank() {
        assertEquals("example", SharedTextIntake.parse("android.intent.action.SEND", "text/plain", null, "example"))
        assertEquals("example", SharedTextIntake.parse("android.intent.action.SEND", "text/plain", "  ", "example"))
    }
    @Test fun rejectsOtherActionsMediaAndEmptyShares() {
        assertNull(SharedTextIntake.parse("android.intent.action.MAIN", "text/plain", "word", null))
        assertNull(SharedTextIntake.parse("android.intent.action.SEND", "image/png", "word", null))
        assertNull(SharedTextIntake.parse("android.intent.action.SEND", null, "word", null))
        assertNull(SharedTextIntake.parse("android.intent.action.SEND", "text/plain", " \n ", null))
    }
    @Test fun preservesMarkupQuotesAndNonLatinCharactersLiterally() {
        val value = "<script>\"привет\" & 你好 🌍</script>"
        assertEquals(value, SharedTextIntake.parse("android.intent.action.SEND", "text/html", value, null))
    }
    @Test fun acceptsTheExactLimit() {
        val value = "x".repeat(20_000)
        assertEquals(value, SharedTextIntake.parse("android.intent.action.SEND", "text/plain", value, null))
    }
    @Test(expected = IllegalArgumentException::class) fun rejectsOversizedTextWithoutTruncating() {
        SharedTextIntake.parse("android.intent.action.SEND", "text/plain", "x".repeat(20_001), null)
    }
}
