package com.demoflowapp.card

import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class CardModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private var reactContext: ReactApplicationContext? = null

        fun emitEvent(event: WritableMap) {
            reactContext?.let { ctx ->
                ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit("onHandleSubmit", event)
            }
        }
    }

    init {
        Companion.reactContext = reactContext
    }

    override fun getName() = "CardModule"

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
}
