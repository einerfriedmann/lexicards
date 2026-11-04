package com.lexicards.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.AtomicFile
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.Toast
import android.widget.FrameLayout
import androidx.core.view.WindowCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : ComponentActivity() {
    companion object {
        private const val MAX_BYTES = 25 * 1024 * 1024
        private const val APP_HOST = "appassets.androidplatform.net"
        private const val HOME = "https://$APP_HOST/assets/index.html"
        private val SHARE_LOCK = Any()
    }
    private lateinit var webView: WebView
    private val io = Executors.newSingleThreadExecutor()
    private val exportBusy = AtomicBoolean(false)
    private val folderBusy = AtomicBoolean(false)
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var tts: TextToSpeech? = null
    private var ttsState = 0 // 0 starting, 1 ready, -1 unavailable
    private var pendingSpeech: Pair<String, Locale>? = null
    private var speechPaused = false
    private var refreshTts = false
    @Volatile private var csvPayload: String? = null
    private val sharePreferences by lazy { getSharedPreferences("share-inbox", MODE_PRIVATE) }
    private val exportFile get() = File(cacheDir, "pending-export.bin")
    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    private fun notice(message: String) = runOnUiThread {
        if (!isFinishing && !isDestroyed) Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uris = mutableListOf<Uri>()
        if (result.resultCode == RESULT_OK) {
            result.data?.data?.let(uris::add)
            result.data?.clipData?.let { clip ->
                for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
            }
        }
        fileChooserCallback?.onReceiveValue(uris.distinct().takeIf { it.isNotEmpty() }?.toTypedArray())
        fileChooserCallback = null
    }

    private val folderPicker = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { treeUri ->
        if (treeUri == null) { folderBusy.set(false); return@registerForActivityResult }
        io.execute {
            val files = JSONArray()
            val errors = JSONArray()
            try {
                // No long-lived permission is needed: the selected folder is read once.
                val root = DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri))
                val budget = intArrayOf(0, 0)
                walkFolder(treeUri, root, files, errors, budget, 0, mutableSetOf())
            } catch (e: Exception) { errors.put("Папка: ${e.message}") }
            csvPayload = JSONObject().put("files", files).put("errors", errors).toString()
            runOnUiThread {
                folderBusy.set(false)
                if (!isDestroyed) webView.evaluateJavascript("window.receiveNativeCsv && window.receiveNativeCsv()", null)
            }
        }
    }

    private val savePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = result.data?.data
        if (result.resultCode != RESULT_OK || uri == null) {
            exportFile.delete(); exportBusy.set(false)
        } else {
            io.execute {
                try {
                    if (!exportFile.isFile) throw IllegalStateException("Временный файл утрачен. Повтори экспорт.")
                    val output = contentResolver.openOutputStream(uri, "wt")
                        ?: throw IllegalStateException("Папка недоступна для записи")
                    output.use { target -> exportFile.inputStream().use { it.copyTo(target) }; target.flush() }
                    notice("Файл сохранён")
                } catch (e: Exception) { notice("Не удалось сохранить файл: ${e.message}") }
                finally { exportFile.delete(); exportBusy.set(false) }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        exportBusy.set(savedInstanceState?.getBoolean("exportPending") == true && exportFile.isFile)
        webView = WebView(this)
        webView.setBackgroundColor(Color.rgb(13, 20, 34))
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true // SAF-selected imports
            mediaPlaybackRequiresUserGesture = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        android.webkit.CookieManager.getInstance().apply {
            setAcceptCookie(false)
            setAcceptThirdPartyCookies(webView, false)
        }
        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                return assetLoader.shouldInterceptRequest(request.url)
                    ?: WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Keep the native bridge attached only to bundled, trusted assets.
                if (request.url.toString() == HOME) return false
                if (request.isForMainFrame) openYouGlish(request.url.toString())
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = callback
                try {
                    filePicker.launch(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    })
                } catch (e: Exception) {
                    fileChooserCallback = null
                    callback.onReceiveValue(null)
                    notice("Не удалось открыть выбор файла: ${e.message}")
                }
                return true
            }
        }
        webView.addJavascriptInterface(NativeBridge(), "AndroidBridge")
        val container = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(13, 20, 34))
            addView(webView, FrameLayout.LayoutParams(-1, -1))
        }
        setContentView(container)
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(container)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("typeof handleAndroidBack === 'function' && handleAndroidBack()") { handled ->
                    if (handled != "true") finish()
                }
            }
        })
        initializeTts()
        webView.loadUrl(HOME)
        if (savedInstanceState == null) receiveSharedIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        receiveSharedIntent(intent)
    }

    private fun receiveSharedIntent(incoming: Intent?) {
        if (incoming?.action != Intent.ACTION_SEND) return
        if (incoming.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        val shared = try {
            SharedTextIntake.parse(
                incoming.action, incoming.type, incoming.getCharSequenceExtra(Intent.EXTRA_TEXT),
                incoming.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text
            )
        } catch (e: Exception) { notice("Не удалось принять текст: ${e.message}"); return }
        if (shared == null) { notice("Выдели текст и отправь его в LexiCards через «Поделиться»."); return }
        io.execute {
            try {
                synchronized(SHARE_LOCK) {
                    val inbox = JSONArray(sharePreferences.getString("pending", "[]"))
                    check(inbox.length() < 20) { "Сначала обработай тексты, уже отправленные в LexiCards." }
                    inbox.put(JSONObject().put("id", UUID.randomUUID().toString()).put("text", shared))
                    check(sharePreferences.edit().putString("pending", inbox.toString()).commit()) {
                        "Не хватает места для сохранения текста."
                    }
                }
                runOnUiThread {
                    if (!isDestroyed) webView.evaluateJavascript(
                        "window.receiveSharedTextFromNative && window.receiveSharedTextFromNative()", null
                    )
                }
            } catch (e: Exception) { notice("Не удалось сохранить полученный текст: ${e.message}") }
        }
    }

    private fun initializeTts() {
        ttsState = 0
        tts = TextToSpeech(this) { status ->
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                ttsState = if (status == TextToSpeech.SUCCESS) 1 else -1
                if (ttsState == 1) {
                    tts?.setSpeechRate(0.92f)
                    tts?.setPitch(1f)
                    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(utteranceId: String?) {}
                        override fun onDone(utteranceId: String?) {}
                        @Deprecated("Android callback")
                        override fun onError(utteranceId: String?) { notice("Голос не воспроизведён. Проверь движок и загруженные английские голоса в разделе «Данные».") }
                        override fun onError(utteranceId: String?, errorCode: Int) { onError(utteranceId) }
                    })
                    val pending = pendingSpeech
                    pendingSpeech = null
                    if (!speechPaused) pending?.let { speakWithEngine(it.first, it.second) }
                } else {
                    pendingSpeech = null
                    notice("Синтез речи недоступен. Установи или включи движок TTS в настройках Android.")
                }
            }
        }
    }

    private fun openYouGlish(url: String) {
        try {
            val parsed = Uri.parse(url)
            if (parsed.scheme != "https" || parsed.host != "youglish.com" || parsed.userInfo != null || (parsed.port != -1 && parsed.port != 443)) {
                notice("Разрешены только HTTPS-ссылки YouGlish"); return
            }
            startActivity(Intent(Intent.ACTION_VIEW, parsed))
        } catch (_: Exception) { notice("Не удалось открыть YouGlish. Установи браузер и проверь подключение к интернету.") }
    }

    inner class NativeBridge {
        // Peek + acknowledge: remove a request only after the editor durably saved it.
        @JavascriptInterface fun peekSharedText(): String = synchronized(SHARE_LOCK) {
            try { JSONArray(sharePreferences.getString("pending", "[]")).optJSONObject(0)?.toString() ?: "null" }
            catch (_: Exception) { "null" }
        }
        @JavascriptInterface fun acknowledgeSharedText(id: String): Boolean = synchronized(SHARE_LOCK) {
            try {
                val inbox = JSONArray(sharePreferences.getString("pending", "[]"))
                if (inbox.optJSONObject(0)?.optString("id") != id) return@synchronized false
                inbox.remove(0)
                sharePreferences.edit().putString("pending", inbox.toString()).commit()
            } catch (_: Exception) { false }
        }
        @JavascriptInterface fun chooseCsvFolder() = runOnUiThread {
            if (!folderBusy.compareAndSet(false, true)) return@runOnUiThread
            try { folderPicker.launch(null) }
            catch (e: Exception) { folderBusy.set(false); notice("Не удалось выбрать папку: ${e.message}") }
        }
        @JavascriptInterface fun takeCsvFiles(): String {
            val payload = csvPayload ?: "{\"files\":[],\"errors\":[]}"
            csvPayload = null
            return payload
        }
        @JavascriptInterface fun openExternalUrl(url: String) = runOnUiThread { openYouGlish(url) }
        @JavascriptInterface fun openTtsSettings() = runOnUiThread {
            refreshTts = true
            try { startActivity(Intent("com.android.settings.TTS_SETTINGS")) }
            catch (_: Exception) {
                try { startActivity(Intent(android.provider.Settings.ACTION_SETTINGS)) }
                catch (_: Exception) { notice("Открой настройки Android → Язык и ввод → Синтез речи.") }
            }
        }
        @JavascriptInterface fun speakText(text: String, languageTag: String) {
            val clean = text.trim().take(TextToSpeech.getMaxSpeechInputLength())
            if (clean.isEmpty()) return
            val locale = if (languageTag.lowercase(Locale.ROOT) in listOf("uk", "en-uk", "en-gb")) Locale.UK else Locale.US
            runOnUiThread {
                if (speechPaused) return@runOnUiThread
                when (ttsState) {
                    0 -> { pendingSpeech = clean to locale; notice("Подготавливаю голос Android…") }
                    1 -> speakWithEngine(clean, locale)
                    else -> notice("Движок TTS недоступен. Открой «Данные» → «Настройки голоса Android».")
                }
            }
        }
        @JavascriptInterface fun stopSpeech() = runOnUiThread { pendingSpeech = null; tts?.stop() }
        @JavascriptInterface fun saveFile(filename: String, mimeType: String, base64: String) {
            if (!exportBusy.compareAndSet(false, true)) { notice("Заверши текущий экспорт перед следующим."); return }
            try {
                if (base64.length > ((MAX_BYTES + 2L) / 3L * 4L)) throw IllegalArgumentException("Файл больше 25 МБ")
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                if (bytes.size > MAX_BYTES) throw IllegalArgumentException("Файл больше 25 МБ")
                val atomic = AtomicFile(exportFile)
                val stream = atomic.startWrite()
                try { stream.write(bytes); atomic.finishWrite(stream) }
                catch (e: Exception) { atomic.failWrite(stream); throw e }
                runOnUiThread {
                    try {
                        savePicker.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = if (mimeType == "text/csv") "text/csv" else "application/vnd.sqlite3"
                            putExtra(Intent.EXTRA_TITLE, filename.substringAfterLast('/').take(120))
                        })
                    } catch (e: Exception) { exportFile.delete(); exportBusy.set(false); notice("Не удалось открыть сохранение: ${e.message}") }
                }
            } catch (e: Exception) { exportFile.delete(); exportBusy.set(false); notice("Не удалось подготовить экспорт: ${e.message}") }
        }
    }

    private fun speakWithEngine(text: String, requested: Locale) {
        val engine = tts ?: return
        try {
            val voices = engine.voices.orEmpty().filter { it.locale.language == "en" }
            val voice = voices.filter { !it.isNetworkConnectionRequired }.sortedWith(
                compareByDescending<android.speech.tts.Voice> { it.locale.country == requested.country }.thenByDescending { it.quality }.thenBy { it.name }
            ).firstOrNull() ?: voices.sortedWith(
                compareByDescending<android.speech.tts.Voice> { it.locale.country == requested.country }.thenBy { it.name }
            ).firstOrNull()
            val locale = voice?.locale ?: requested
            if (engine.setLanguage(locale) < TextToSpeech.LANG_AVAILABLE) {
                notice("Английский голос не установлен. В «Данные» открой настройки голоса и загрузи English (UK/US)."); return
            }
            if (voice != null) engine.voice = voice
            if (voice != null && voice.locale.country != requested.country) notice("Этот акцент не установлен. Используется доступный английский голос.")
            if (voice?.isNetworkConnectionRequired == true) notice("Установлен сетевой голос. Для работы офлайн загрузи английский голос в настройках Android.")
            if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "lexicards-${System.nanoTime()}") == TextToSpeech.ERROR) {
                notice("Не удалось озвучить текст. Проверь системный движок TTS.")
            }
        } catch (e: Exception) { notice("Ошибка озвучивания: ${e.message}") }
    }

    private fun readLimited(input: InputStream, remaining: Int): ByteArray {
        input.use {
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val n = it.read(buffer)
                if (n < 0) break
                if (output.size() + n > remaining) throw IllegalArgumentException("Общий размер CSV превышает 25 МБ")
                output.write(buffer, 0, n)
            }
            return output.toByteArray()
        }
    }

    private fun walkFolder(tree: Uri, directory: Uri, files: JSONArray, errors: JSONArray, budget: IntArray, depth: Int, seen: MutableSet<String>) {
        if (depth > 16) throw IllegalArgumentException("Папка вложена слишком глубоко")
        val id = DocumentsContract.getDocumentId(directory)
        if (!seen.add(id)) return
        if (seen.size > 2000) throw IllegalArgumentException("Выбери папку поменьше: больше 2000 вложенных папок")
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id)
        val projection = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE)
        val cursor = contentResolver.query(children, projection, null, null, null)
            ?: throw IllegalStateException("Не удалось прочитать список файлов")
        cursor.use {
            while (it.moveToNext()) {
                val childId = it.getString(0)
                val name = it.getString(1) ?: "file"
                val child = DocumentsContract.buildDocumentUriUsingTree(tree, childId)
                if (it.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR) {
                    try { walkFolder(tree, child, files, errors, budget, depth + 1, seen) }
                    catch (e: Exception) { errors.put("$name: ${e.message}") }
                } else if (name.endsWith(".csv", ignoreCase = true)) {
                    budget[1]++
                    if (budget[1] > 500) throw IllegalArgumentException("За один раз можно импортировать до 500 CSV-файлов")
                    try {
                        val input = contentResolver.openInputStream(child) ?: throw IllegalStateException("Нет доступа к файлу")
                        val bytes = readLimited(input, MAX_BYTES - budget[0]); budget[0] += bytes.size
                        files.put(JSONObject().put("name", name).put("content", bytes.toString(Charsets.UTF_8)))
                    } catch (e: Exception) { errors.put("$name: ${e.message}") }
                }
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("exportPending", exportBusy.get())
        super.onSaveInstanceState(outState)
    }
    override fun onResume() {
        super.onResume(); speechPaused = false
        if (refreshTts || ttsState == -1) {
            refreshTts = false; tts?.shutdown(); tts = null; initializeTts()
        }
    }
    override fun onStop() {
        speechPaused = true; pendingSpeech = null; tts?.stop()
        super.onStop()
    }
    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null); fileChooserCallback = null
        if (::webView.isInitialized) { webView.removeJavascriptInterface("AndroidBridge"); webView.destroy() }
        tts?.stop(); tts?.shutdown(); tts = null
        io.shutdown()
        super.onDestroy()
    }
}
