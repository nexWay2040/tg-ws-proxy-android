package com.tgproxyapp

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ProxyServiceModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    // Это имя мы будем использовать в JavaScript
    override fun getName(): String {
        return "ProxyServiceModule"
    }

    // Эта функция будет вызываться из JS при нажатии "Запустить"
    @ReactMethod
    fun startService() {
        val intent = Intent(reactApplicationContext, ProxyService::class.java)
        ContextCompat.startForegroundService(reactApplicationContext, intent)
    }

    // Эта функция будет вызываться из JS при нажатии "Остановить"
    @ReactMethod
    fun stopService() {
        val intent = Intent(reactApplicationContext, ProxyService::class.java)
        reactApplicationContext.stopService(intent)
    }
}