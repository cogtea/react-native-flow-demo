package com.demoflowapp.googlepay

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray

class GooglePayViewManager : SimpleViewManager<GooglePayView>() {
    override fun getName() = "RNGooglePayView"

    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> {
        return mutableMapOf(
            "onHandleSubmit" to mapOf("registrationName" to "onHandleSubmit")
        )
    }

    override fun createViewInstance(reactContext: ThemedReactContext): GooglePayView {
        // Important: use ThemedReactContext as the View context so Fabric registers
        // the correct EventEmitter for touches. Passing an Activity context can cause
        // "Cannot find EventEmitter for receivedTouches" errors.
        val appContext = reactContext.reactApplicationContext
        return GooglePayView(reactContext, appContext)
    }

    // Ensure we attempt initialization after a full props batch is applied
    override fun onAfterUpdateTransaction(view: GooglePayView) {
        super.onAfterUpdateTransaction(view)
        maybeInit(view)
    }

    @ReactProp(name = "paymentSessionID")
    fun setPaymentSessionID(view: GooglePayView, value: String?) {
        view.tag = (view.tag as? MutableMap<String, String> ?: mutableMapOf()).apply {
            put("paymentSessionID", value ?: "")
        }
    }



    @ReactProp(name = "paymentSessionSecret")
    fun setPaymentSessionSecret(view: GooglePayView, value: String?) {
        view.tag = (view.tag as? MutableMap<String, String> ?: mutableMapOf()).apply {
            put("paymentSessionSecret", value ?: "")
        }
    }

    @ReactProp(name = "publicKey")
    fun setPublicKey(view: GooglePayView, value: String?) {
        view.tag = (view.tag as? MutableMap<String, String> ?: mutableMapOf()).apply {
            put("publicKey", value ?: "")
        }
    }

    // Note: handleSubmit callback is set directly on the view via direct method call
    // React Native @ReactProp doesn't support Callback type directly

    private fun maybeInit(view: GooglePayView) {
        val tag = view.tag as? Map<String, String> ?: return
        val id = tag["paymentSessionID"] ?: return
        val secret = tag["paymentSessionSecret"] ?: return
        val key = tag["publicKey"] ?: return
        if (id.isNotEmpty() && secret.isNotEmpty() && key.isNotEmpty()) {
            view.initialize(id, secret, key)
        }
    }


}
