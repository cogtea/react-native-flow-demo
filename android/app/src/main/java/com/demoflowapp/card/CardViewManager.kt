package com.demoflowapp.card

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray

class CardViewManager : SimpleViewManager<CardView>() {
    override fun getName() = "RNCardView"

    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> {
        return mutableMapOf(
            "onHandleSubmit" to mapOf("registrationName" to "onHandleSubmit")
        )
    }

    override fun createViewInstance(reactContext: ThemedReactContext): CardView {
        // Important: use ThemedReactContext as the View context so Fabric registers
        // the correct EventEmitter for touches. Passing an Activity context can cause
        // "Cannot find EventEmitter for receivedTouches" errors.
        val appContext = reactContext.reactApplicationContext
        android.util.Log.d("CardViewManager", "🎬 createViewInstance called")
        return CardView(reactContext, appContext)
    }

    // Ensure we attempt initialization after a full props batch is applied
    override fun onAfterUpdateTransaction(view: CardView) {
        super.onAfterUpdateTransaction(view)
        android.util.Log.d("CardViewManager", "🔄 onAfterUpdateTransaction called")
        maybeInit(view)
    }

    @ReactProp(name = "paymentSessionID")
    fun setPaymentSessionID(view: CardView, value: String?) {
        android.util.Log.d("CardViewManager", "📝 setPaymentSessionID: $value")
        view.tag = (view.tag as? MutableMap<String, String> ?: mutableMapOf()).apply {
            put("paymentSessionID", value ?: "")
        }
    }



    @ReactProp(name = "paymentSessionSecret")
    fun setPaymentSessionSecret(view: CardView, value: String?) {
        view.tag = (view.tag as? MutableMap<String, String> ?: mutableMapOf()).apply {
            put("paymentSessionSecret", value ?: "")
        }
    }

    @ReactProp(name = "publicKey")
    fun setPublicKey(view: CardView, value: String?) {
        view.tag = (view.tag as? MutableMap<String, String> ?: mutableMapOf()).apply {
            put("publicKey", value ?: "")
        }
    }

    @ReactProp(name = "environment")
    fun setEnvironment(view: CardView, value: String?) {
        val env = when (value?.lowercase()) {
            "production", "prod", "live" -> com.checkout.components.interfaces.Environment.PRODUCTION
            else -> com.checkout.components.interfaces.Environment.SANDBOX
        }
        view.environment = env
    }

    @ReactProp(name = "hasHandleSubmitListener")
    fun setHasHandleSubmitListener(view: CardView, value: Boolean) {
        android.util.Log.d("CardViewManager", "📝 setHasHandleSubmitListener: $value")
        view.hasHandleSubmitListener = value
    }

    // Note: handleSubmit callback is set directly on the view via direct method call
    // React Native @ReactProp doesn't support Callback type directly

    private fun maybeInit(view: CardView) {
        val tag = view.tag as? Map<String, String> ?: return
        val id = tag["paymentSessionID"] ?: return
        val secret = tag["paymentSessionSecret"] ?: return
        val key = tag["publicKey"] ?: return
        android.util.Log.d("CardViewManager", "🔍 maybeInit: id=$id, secret=${secret.take(10)}..., key=${key.take(10)}...")
        if (id.isNotEmpty() && secret.isNotEmpty() && key.isNotEmpty()) {
            android.util.Log.d("CardViewManager", "✅ All props set, calling initialize()")
            view.initialize(id, secret, key)
        } else {
            android.util.Log.d("CardViewManager", "⏳ Waiting for props: id=$id, secret=$secret, key=$key")
        }
    }


}
