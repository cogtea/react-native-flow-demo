package com.demoflowapp.googlepay

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.demoflowapp.BuildConfig
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability

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

    override fun getName(): String = NAME

    fun emitHandleSubmitEvent(event: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onHandleSubmit", event)
    }

    /* ----------------------------------------------------------
     *  NEW: Simple Google Pay availability check
     *  Uses Google Play Services status instead of isReadyToPay()
     * --------------------------------------------------------- */
    @ReactMethod
    fun isGooglePayAvailable(promise: Promise) {
        try {
            val context = reactApplicationContext
            val apiAvailability = GoogleApiAvailability.getInstance()

            val result = apiAvailability.isGooglePlayServicesAvailable(context)

            val available = result == ConnectionResult.SUCCESS

            promise.resolve(available)

        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun handleSubmitResponse(requestId: String, success: Boolean, data: ReadableMap?) {
        if (BuildConfig.DEBUG) {
            android.util.Log.d("GooglePayModule", "📥 handleSubmitResponse called: requestId=$requestId, success=$success")
            android.util.Log.d("GooglePayModule", "📥 data: ${data?.toString()}")
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

    @ReactMethod
    fun submit(paymentSessionID: String, promise: Promise) {
        try {
            val submitted = GooglePayViewRegistry.submit(paymentSessionID)
            promise.resolve(submitted)
        } catch (e: Exception) {
            promise.reject("E_SUBMIT_ERROR", e.message, e)
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
        
        // Call handleSubmitResponse for all registered views
        views.values.forEach { view ->
            if (BuildConfig.DEBUG) {
                android.util.Log.d("GooglePayViewRegistry", "📞 Calling handleSubmitResponse on view")
            }
            view.handleSubmitResponse(requestId, success, data)
        }
    }

    fun submit(sessionId: String): Boolean {
        val direct = views[sessionId]
        if (direct != null) {
            return direct.submitFromJS()
        }

        return views.values.firstOrNull()?.submitFromJS() ?: false
    }
}