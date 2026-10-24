package com.hosung.muse

import android.graphics.Color
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

class MainActivity : TauriActivity() {
  companion object {
    @Volatile var current: MainActivity? = null
  }

  private var web: WebView? = null

  /** System bar / cutout insets in CSS px, handed to the page as safe-area padding. */
  @Volatile private var insets = JSONObject().put("top", 0).put("bottom", 0).put("left", 0).put("right", 0)

  // Back is routed to the app's own navigation (see onCreate)
  override val handleBackNavigation: Boolean = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
    current = this
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val w = web
        if (w == null) {
          moveTaskToBack(true)
          return
        }
        // Let the page close sheets / go back; at the root, leave the app running (music keeps playing)
        w.evaluateJavascript("window.__museBack ? window.__museBack() : false") { handled ->
          if (handled != "true") moveTaskToBack(true)
        }
      }
    })
  }

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    if (BuildConfig.DEBUG && intent.getBooleanExtra("muse_auto_selftest", false)) AutoSelfTest.run(this)
  }

  override fun onWebViewCreate(webView: WebView) {
    web = webView
    webView.setBackgroundColor(Color.rgb(10, 9, 13))
    webView.addJavascriptInterface(Bridge(), "MuseAndroid")
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, windowInsets ->
      val bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val d = resources.displayMetrics.density
      insets = JSONObject()
        .put("top", bars.top / d)
        .put("bottom", bars.bottom / d)
        .put("left", bars.left / d)
        .put("right", bars.right / d)
      runJs("window.__museInsets && window.__museInsets($insets)")
      windowInsets
    }
  }

  fun runJs(js: String) {
    runOnUiThread { web?.evaluateJavascript(js, null) }
  }

  override fun onDestroy() {
    if (current === this) current = null
    super.onDestroy()
  }

  /** Called from the page as `window.MuseAndroid.*`. */
  inner class Bridge {
    @JavascriptInterface
    fun insets(): String = insets.toString()

    @JavascriptInterface
    fun mediaUpdate(json: String) = MediaService.update(applicationContext, JSONObject(json))

    @JavascriptInterface
    fun mediaStop() = MediaService.stop(applicationContext)

    /** The page is ready; returns a control that arrived before it was (e.g. a song picked in the car). */
    @JavascriptInterface
    fun ready(): String = MediaService.takePending() ?: ""

    @JavascriptInterface
    fun libraryChanged() = MediaService.libraryChanged()
  }
}
