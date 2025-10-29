package com.demoflowapp.googlepay

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.demoflowapp.BuildConfig

@ReactModule(name = GooglePayModule.NAME)
class GooglePayModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "GooglePayModule"
        private var moduleInstance: GooglePayModule? = null
        
        fun emitEvent(event: WritableMap) {
            moduleInstance?.emitHandleSubmitEvent(event)
        }
    }

    init {
        moduleInstance = this
    }

    override fun getName(): String {
        return NAME
    }

    fun emitHandleSubmitEvent(event: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onHandleSubmit", event)
    }

    @ReactMethod
    fun handleSubmitResponse(requestId: String, success: Boolean, data: ReadableMap?) {
        if (BuildConfig.DEBUG) {
            android.util.Log.d("GooglePayModule", "📥 handleSubmitResponse called: requestId=$requestId, success=$success")
            android.util.Log.d("GooglePayModule", "📥 data: ${data?.toString()}")
        }
        
        // Call registry method directly - React Native bridge should already be on correct thread
        if (BuildConfig.DEBUG) {
            android.util.Log.d("GooglePayModule", "➡️ Calling GooglePayViewRegistry.handleSubmitResponse directly")
        }
        try {
            GooglePayViewRegistry.handleSubmitResponse(requestId, success, data)
            if (BuildConfig.DEBUG) {
                android.util.Log.d("GooglePayModule", "✅ Successfully called GooglePayViewRegistry.handleSubmitResponse")
            }
        } catch (e: Exception) {
            android.util.Log.e("GooglePayModule", "❌ Error calling GooglePayViewRegistry.handleSubmitResponse", e)
        }
    }
}

// Simple registry to track GooglePayView instances
object GooglePayViewRegistry {
    private val views = mutableMapOf<String, GooglePayView>()
    
    fun registerView(id: String, view: GooglePayView) {
        views[id] = view
    }
    
    fun unregisterView(id: String) {
        views.remove(id)
    }
    
    fun handleSubmitResponse(requestId: String, success: Boolean, data: ReadableMap?) {
        if (BuildConfig.DEBUG) {
            android.util.Log.d("GooglePayViewRegistry", "🎯 handleSubmitResponse: requestId=$requestId, views count=${views.size}")
            android.util.Log.d("GooglePayViewRegistry", "🎯 Registered view IDs: ${views.keys}")
        }
        
        // Find the view that matches this request
        views.values.forEach { view ->
            if (BuildConfig.DEBUG) {
                android.util.Log.d("GooglePayViewRegistry", "📞 Calling handleSubmitResponse on view")
            }
            view.handleSubmitResponse(requestId, success, data)
        }
    }
}