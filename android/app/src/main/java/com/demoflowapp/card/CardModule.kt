package com.demoflowapp.card

import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.UiThreadUtil

class CardModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private var reactContext: ReactApplicationContext? = null

        fun emitEvent(event: WritableMap) {
            reactContext?.let { ctx ->
                ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit("onCardHandleSubmit", event)
            }
        }
    }

    init {
        Companion.reactContext = reactContext
    }

    override fun getName() = "CardModule"

    @ReactMethod
    fun addListener(eventName: String) {
    }

    @ReactMethod
    fun removeListeners(count: Int) {
    }

    @ReactMethod
    fun handleSubmitResponse(requestId: String, success: Boolean, data: ReadableMap?) {
        Log.d("CardModule", "📞 handleSubmitResponse called: requestId=$requestId, success=$success")
        try {
            // Find the CardView instance by requestId (which is the session ID)
            val cardView = CardViewRegistry.getView(requestId)
            if (cardView != null) {
                cardView.handleSubmitResponse(requestId, success, data)
                Log.d("CardModule", "✅ Successfully called CardViewRegistry.handleSubmitResponse")
            } else {
                Log.e("CardModule", "❌ CardView not found for requestId: $requestId")
            }
        } catch (e: Exception) {
            Log.e("CardModule", "❌ Error in handleSubmitResponse", e)
        }
    }

    @ReactMethod
    fun submit(paymentSessionID: String, promise: Promise) {
        try {
            val cardView = CardViewRegistry.getView(paymentSessionID)
            if (cardView == null) {
                promise.reject("E_CARD_VIEW_NOT_FOUND", "CardView not found for sessionId=$paymentSessionID")
                return
            }
            UiThreadUtil.runOnUiThread {
                try {
                    cardView.submitFromJs()
                    promise.resolve(true)
                } catch (e: Exception) {
                    Log.e("CardModule", "❌ Error in submit on UI thread", e)
                    promise.reject("E_CARD_SUBMIT", e)
                }
            }
        } catch (e: Exception) {
            Log.e("CardModule", "❌ Error in submit", e)
            promise.reject("E_CARD_SUBMIT", e)
        }
    }
}
