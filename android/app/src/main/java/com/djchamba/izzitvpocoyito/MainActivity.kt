package com.djchamba.izzitvpocoyito

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.content.pm.PackageManager
import android.view.Gravity
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var originalSystemUi = 0
    private var isTvDevice = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(8, 11, 22)
        window.navigationBarColor = Color.rgb(8, 11, 22)
        isTvDevice = packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        if (isTvDevice) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            enterImmersiveMode()
        }
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(8, 11, 22))
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.setSupportZoom(false)
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.loadsImagesAutomatically = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            // Las señales IPTV públicas pueden usar HTTP.
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                    assetLoader.shouldInterceptRequest(request.url)
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                    if (customView != null) { callback.onCustomViewHidden(); return }
                    customView = view
                    customViewCallback = callback
                    originalSystemUi = window.decorView.systemUiVisibility
                    enterImmersiveMode()
                    (webView.parent as? FrameLayout)?.addView(view, FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                }
                override fun onHideCustomView() { exitCustomView() }
            }
        }
        setContentView(webView)
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                assetLoader.shouldInterceptRequest(request.url)
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                if (isTvDevice) view.evaluateJavascript("""
                    (function(){
                      document.body.classList.add('android-tv');
                      document.documentElement.classList.add('android-tv');
                      setTimeout(function(){ if(typeof window.openTV==='function') window.openTV(); }, 650);
                    })();
                """.trimIndent(), null)
            }
        }
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html")
        webView.requestFocus()
    }

    private fun enterImmersiveMode() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        )
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && (isTvDevice || customView != null)) enterImmersiveMode()
    }

    private fun exitCustomView() {
        (customView?.parent as? FrameLayout)?.removeView(customView)
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        if (isTvDevice) enterImmersiveMode() else window.decorView.systemUiVisibility = originalSystemUi
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // No secuestrar las teclas cuando el usuario está escribiendo: WebView/IME
        // necesita recibirlas para abrir y manejar el teclado en pantalla.
        if (event.action == KeyEvent.ACTION_DOWN) {
            var textFieldFocused = false
            webView.evaluateJavascript(
                "(function(){var e=document.activeElement;return !!e && (e.tagName==='INPUT'||e.tagName==='TEXTAREA'||e.isContentEditable);})()"
            ) { value -> textFieldFocused = value == "true" }
            if (textFieldFocused) return super.dispatchKeyEvent(event)
        }
        if (event.action == KeyEvent.ACTION_DOWN) {
            val jsKey = when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
                KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
                KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
                KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
                KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_BUTTON_A -> "Enter"
                KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP,
                KeyEvent.KEYCODE_MEDIA_NEXT -> "PageUp"
                KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN,
                KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "PageDown"
                KeyEvent.KEYCODE_GUIDE -> "g"
                KeyEvent.KEYCODE_INFO -> "i"
                KeyEvent.KEYCODE_SEARCH -> "CTRL_K"
                KeyEvent.KEYCODE_MENU -> "q"
                else -> null
            }
            if (event.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
                webView.evaluateJavascript("""
                    (function(){
                      if(document.getElementById('vodPlayer')?.classList.contains('open')) document.getElementById('vodPlayPause')?.click();
                      else if(document.getElementById('tvPage')?.classList.contains('active')) document.getElementById('play')?.click();
                    })();
                """.trimIndent(), null)
                return true
            }
            if (jsKey != null) {
                val script = if (jsKey == "CTRL_K") {
                    "document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',ctrlKey:true,bubbles:true,cancelable:true}));"
                } else {
                    "document.dispatchEvent(new KeyboardEvent('keydown',{key:'$jsKey',code:'$jsKey',bubbles:true,cancelable:true}));"
                }
                webView.evaluateJavascript(script, null)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (customView != null) { exitCustomView(); return true }
            webView.evaluateJavascript("""
                (function(){
                  const guide=document.getElementById('guideModal'), search=document.getElementById('channelSearchModal');
                  const quick=document.getElementById('quickMenu'), directory=document.getElementById('countryDirectory');
                  const world=document.getElementById('pocoyitoWorldHub');
                  if(document.fullscreenElement){document.exitFullscreen();return;}
                  if(guide?.classList.contains('open')){document.getElementById('closeGuide')?.click();return;}
                  if(search?.classList.contains('open')){if(typeof closeGlobalChannelSearch==='function')closeGlobalChannelSearch();return;}
                  if(quick?.classList.contains('open')){quick.classList.remove('open');return;}
                  if(directory?.classList.contains('open')){document.getElementById('countryDirectoryClose')?.click();return;}
                  if(world && !world.hidden && world.style.display!=='none'){world.hidden=true;world.style.display='none';return;}
                  const vp=document.getElementById('vodPlayer');
                  if(vp && vp.getAttribute('aria-hidden')!=='true' && getComputedStyle(vp).display!=='none'){document.getElementById('vodPlayerBack')?.click();return;}
                  const vod=document.getElementById('vodPage');
                  if(vod && getComputedStyle(vod).display!=='none'){document.getElementById('vodBack')?.click();return;}
                  if(document.getElementById('tvPage')?.classList.contains('active')){document.getElementById('backHome')?.click();return;}
                })();
            """.trimIndent(), null)
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }
}
