package com.lexicards.app

/** Accept only text explicitly shared by the user; never read the clipboard or a URI. */
object SharedTextIntake {
    const val MAX_TEXT_LENGTH = 20_000

    fun parse(action: String?, mimeType: String?, extraText: CharSequence?, clipText: CharSequence?): String? {
        if (action != "android.intent.action.SEND") return null
        val mime = mimeType?.substringBefore(';')?.trim()?.lowercase(java.util.Locale.ROOT)
        if (mime == null || !mime.startsWith("text/")) return null
        val value = (extraText?.takeIf { it.isNotBlank() } ?: clipText)?.toString()?.trim()
        if (value.isNullOrEmpty()) return null
        require(value.length <= MAX_TEXT_LENGTH) { "Выдели текст короче 20 000 символов." }
        return value
    }
}
