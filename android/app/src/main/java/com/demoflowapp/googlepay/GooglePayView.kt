package com.demoflowapp.googlepay

import android.content.Context
import android.util.Log
import android.widget.FrameLayout
import com.demoflowapp.BuildConfig
import androidx.activity.ComponentActivity
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.checkout.components.core.CheckoutComponentsFactory
import com.checkout.components.interfaces.Environment
import com.checkout.components.interfaces.api.CheckoutComponents
import com.checkout.components.interfaces.component.CheckoutComponentConfiguration
import com.checkout.components.interfaces.component.ComponentCallback
import com.checkout.components.interfaces.error.CheckoutError
import com.checkout.components.interfaces.model.PaymentMethodName
import com.checkout.components.interfaces.model.PaymentSessionResponse
import com.checkout.components.interfaces.model.ApiCallResult
import com.checkout.components.interfaces.model.paymentsession.PaymentSessionSubmissionResult
import com.checkout.components.interfaces.model.paymentsession.PaymentAction
import org.json.JSONObject
import kotlinx.coroutines.runBlocking
import com.checkout.components.wallet.wrapper.GooglePayFlowCoordinator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

// Create our own data classes that match the expected signature from Checkout.com docs
data class SessionData(
    val id: String,
    val secret: String,
    val sessionData: String? = null // Raw session data from SDK
)

data class CustomApiCallResult(
    val success: Boolean,
    val data: Map<String, Any>? = null,
    val error: String? = null
)

class GooglePayView(context: Context, private val reactApplicationContext: ReactApplicationContext) : FrameLayout(context) {
    private var checkoutComponents: CheckoutComponents? = null
    private var googlePayCoordinator: GooglePayFlowCoordinator? = null
    private var hasInitialized = false
    private var currentSessionData: SessionData? = null
    private var pendingContinuations = mutableMapOf<String, kotlin.coroutines.Continuation<CustomApiCallResult>>()
    var environment: Environment = Environment.SANDBOX

    // --- START: ADDED FIX ---
    /**
     * This runnable is the key to fixing the layout issue. When `requestLayout()` is called (e.g.,
     * after `addView()`), we post this runnable. It manually forces a re-measure and re-layout of
     * this view, which correctly notifies React Native's layout system that the view's dimensions
     * have changed.
     */
    private val mLayoutRunnable = Runnable {
        measure(
                MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
        )
        layout(left, top, right, bottom)
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
    }
    /** Override `requestLayout()` to intercept layout requests. */
    override fun requestLayout() {
        super.requestLayout()
        // Post the layout runnable to force a re-layout in RN's context
        post(mLayoutRunnable)
    }
    // --- END: ADDED FIX ---
    
    /**
     * Called from JavaScript with the API response after payment submission
     */
    fun handleSubmitResponse(requestId: String, success: Boolean, data: ReadableMap?) {
        val continuation = pendingContinuations.remove(requestId)
        if (continuation != null) {
            val result = if (success && data != null) {
                CustomApiCallResult(
                    success = true,
                    data = data.toHashMap() as Map<String, Any>?
                )
            } else {
                CustomApiCallResult(
                    success = false,
                    error = data?.getString("error") ?: "Unknown error"
                )
            }
            continuation.resume(result)
        }
    }

    /**
     * The handleSubmit function that will be called when payment needs to be submitted
     * This emits an event to JavaScript and waits for response
     */
    private suspend fun handleSubmit(sessionData: SessionData): CustomApiCallResult {
        return suspendCancellableCoroutine { continuation ->
            val requestId = sessionData.id // Use session ID as unique request ID
            pendingContinuations[requestId] = continuation
            
            // Emit event to JavaScript
            val eventData = Arguments.createMap().apply {
                putString("requestId", requestId)
                putString("id", sessionData.id)
                putString("secret", sessionData.secret)
                sessionData.sessionData?.let { putString("sessionData", it) }
            }
            
            val event = Arguments.createMap().apply {
                putMap("sessionData", eventData)
            }
            
            GooglePayModule.emitEvent(event)
        }
    }

    fun initialize(
            paymentSessionID: String,
            paymentSessionSecret: String,
            publicKey: String
    ) {
        if (hasInitialized) return
        hasInitialized = true
        
        // Store session data for handleSubmit functionality
        currentSessionData = SessionData(paymentSessionID, paymentSessionSecret)
        
        // Register this view with the registry
        GooglePayViewRegistry.registerView(paymentSessionID, this)

        // Obtain a ComponentActivity for GooglePayFlowCoordinator
        val activityForCoordinator: ComponentActivity? =
            (reactApplicationContext.currentActivity as? ComponentActivity)
                ?: (context as? ComponentActivity)
        if (activityForCoordinator == null) {
            Log.e(
                "GooglePayView",
                "Host Activity not available or not a ComponentActivity; cannot initialize Google Pay"
            )
            // Give up early to avoid crash; RN will keep the view rendered without GP initialized.
            // Caller can re-render later when Activity is ready.
            hasInitialized = false
            return
        }

        googlePayCoordinator =
            GooglePayFlowCoordinator(
                context = activityForCoordinator,
                handleActivityResult = { resultCode, data ->
                    checkoutComponents?.handleActivityResult(resultCode, data)
                }
            )

        val customComponentCallback =
                ComponentCallback(
                        onReady = { component ->
                            if (BuildConfig.DEBUG) {
                                Log.d("GooglePayView", "onReady: ${component.name}")
                            }
                        },
                        handleSubmit = { sessionData ->
                            try {
                                currentSessionData?.let { baseSessionData ->
                                    val sessionDataWithRaw = baseSessionData.copy(
                                        sessionData = sessionData
                                    )
                                    
                                    val result = kotlinx.coroutines.runBlocking {
                                        this@GooglePayView.handleSubmit(sessionDataWithRaw)
                                    }
                                    
                                    if (result.success) {
                                        try {
                                            val responseJson = result.data?.get("response") as? String ?: "{\"status\":\"success\"}"
                                            
                                            // Parse the JSON response to create PaymentSessionSubmissionResult
                                            val jsonObject = JSONObject(responseJson)
                                            val id = jsonObject.getString("id")
                                            val status = jsonObject.getString("status")
                                            val type = jsonObject.optString("type", "googlepay") // Default to googlepay
                                            
                                            // Parse action if present
                                            val action = if (jsonObject.has("action")) {
                                                val actionObject = jsonObject.getJSONObject("action")
                                                PaymentAction(
                                                    type = actionObject.getString("type"),
                                                    url = if (actionObject.has("url")) actionObject.getString("url") else null
                                                )
                                            } else null
                                            
                                            // Create the proper PaymentSessionSubmissionResult
                                            val submissionResult = PaymentSessionSubmissionResult(
                                                id = id,
                                                type = type,
                                                status = status,
                                                action = action,
                                                declineReason = null
                                            )
                                            
                                            Log.d("GooglePayView", "✅ Created PaymentSessionSubmissionResult: id=$id, status=$status, type=$type")
                                            if (action != null) {
                                                if (BuildConfig.DEBUG) {
                                                    Log.d("GooglePayView", "➡️ Action required: type=${action.type}, url=${action.url}")
                                                }
                                            }
                                            
                                            ApiCallResult.Success(submissionResult)
                                        } catch (e: Exception) {
                                            Log.e("GooglePayView", "Error parsing response JSON", e)
                                            ApiCallResult.Failure
                                        }
                                    } else {
                                        ApiCallResult.Failure
                                    }
                                } ?: ApiCallResult.Failure
                            } catch (e: Exception) {
                                Log.e("GooglePayView", "Error in handleSubmit", e)
                                ApiCallResult.Failure
                            }
                        },
                        onSuccess = { component, paymentID ->
                            if (BuildConfig.DEBUG) {
                                Log.d("GooglePayView", "onSuccess: ${component.name}, $paymentID")
                            }
                            val map =
                                    Arguments.createMap().apply {
                                        putString("component", component::class.java.simpleName)
                                        putString("paymentId", paymentID)
                                    }
                            sendEvent("onFlowPaymentSuccess", map)
                        },
                        onError = { component, checkoutError ->
                            Log.e(
                                    "GooglePayView",
                                    "onError: ${checkoutError.message}, ${checkoutError.code}"
                            )
                            val map =
                                    Arguments.createMap().apply {
                                        putString("component", component::class.java.simpleName)
                                        putString(
                                                "errorMessage",
                                                checkoutError.message
                                        )
                                        putString("errorCode", checkoutError.code.toString())
                                    }
                            sendEvent("onFlowPaymentError", map)
                        }
                )

    val configuration =
        CheckoutComponentConfiguration(
            context = activityForCoordinator,
                        paymentSession =
                                PaymentSessionResponse(
                                        id = paymentSessionID,
                                        secret = paymentSessionSecret
                                ),
                        componentCallback = customComponentCallback,
                        publicKey = publicKey,
            environment = environment,
                        flowCoordinators =
                                mapOf(PaymentMethodName.GooglePay to googlePayCoordinator!!)
                )

        CoroutineScope(Dispatchers.Main).launch {
            try {
                checkoutComponents = CheckoutComponentsFactory(config = configuration).create()
                val googlePayComponent = checkoutComponents!!.create(PaymentMethodName.GooglePay)
                if (BuildConfig.DEBUG) {
                    Log.d("IsAvailable", googlePayComponent.isAvailable().toString())
                }
                val view = googlePayComponent.provideView(this@GooglePayView)
                if (BuildConfig.DEBUG) {
                    Log.d("GooglePayView", "View provided successfully")
                }

                val lp = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)
                view.layoutParams = lp

                try {
                    view.setBackgroundColor(0x20EC5E5E) // translucent tint
                } catch (t: Throwable) {
                    // ignore
                }

                // Your logic here is fine.
                // The `addView(view)` call inside the `post` block
                // will now trigger your overridden `requestLayout()`,
                // which will then post the `mLayoutRunnable` and fix the UI.
                this@GooglePayView.removeAllViews()
                this@GooglePayView.post {
                    try {
                        addView(view)
                        // These calls below are not strictly necessary anymore,
                        // as addView() will trigger our fix, but they don't hurt.
                        view.requestLayout()
                        this@GooglePayView.requestLayout()
                        this@GooglePayView.invalidate()
                    } catch (t: Throwable) {
                        Log.e("GooglePayView", "Error attaching Google Pay child view", t)
                    }
                }
            } catch (e: CheckoutError) {
                Log.e("GooglePayView", "Error creating Google Pay component", e)
            }
        }
    }
}
