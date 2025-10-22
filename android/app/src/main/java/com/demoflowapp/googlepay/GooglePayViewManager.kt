package com.demoflowapp.googlepay

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.ViewManager

class GooglePayViewManager : SimpleViewManager<GooglePayView>() {
    override fun getName() = "RNGooglePayView"

    override fun createViewInstance(reactContext: ThemedReactContext): GooglePayView {
        val activity = reactContext.currentActivity
        return if (activity != null) {
            GooglePayView(activity)
        } else {
            GooglePayView(reactContext)
        }
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

    @ReactProp(name = "paymentSessionToken")
    fun setPaymentSessionToken(view: GooglePayView, value: String?) {
        view.tag = (view.tag as? MutableMap<String, String> ?: mutableMapOf()).apply {
            put("paymentSessionToken", value ?: "")
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

    private fun maybeInit(view: GooglePayView) {
        val tag = view.tag as? Map<String, String> ?: return
        val id = tag["paymentSessionID"] ?: return
        val token = tag["paymentSessionToken"] ?: return
        val secret = tag["paymentSessionSecret"] ?: return
        val key = tag["publicKey"] ?: return
        if (id.isNotEmpty() && token.isNotEmpty() && secret.isNotEmpty() && key.isNotEmpty()) {
            view.initialize(id, token, secret, key)
        }
    }
}
