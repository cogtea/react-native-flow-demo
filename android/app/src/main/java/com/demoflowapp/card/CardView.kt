package com.demoflowapp.card

import android.content.Context
import android.util.Log
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.checkout.components.core.CheckoutComponentsFactory
import com.checkout.components.interfaces.Environment
import com.checkout.components.interfaces.api.CheckoutComponents
import com.checkout.components.interfaces.api.PaymentMethodComponent
import com.checkout.components.interfaces.component.CheckoutComponentConfiguration
import com.checkout.components.interfaces.component.ComponentCallback
import com.checkout.components.interfaces.error.CheckoutError
import com.checkout.components.interfaces.model.ApiCallResult
import com.checkout.components.interfaces.model.PaymentMethodName
import com.checkout.components.interfaces.model.PaymentSessionResponse
import com.checkout.components.interfaces.model.paymentsession.PaymentAction
import com.checkout.components.interfaces.model.paymentsession.PaymentSessionSubmissionResult
import com.demoflowapp.BuildConfig
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import java.util.UUID
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

class CardView(context: Context, private val reactApplicationContext: ReactApplicationContext) : FrameLayout(context) {
    private var checkoutComponents: CheckoutComponents? = null
    private var hasInitialized = false
    private var currentSessionData: SessionData? = null
    private var pendingContinuations = mutableMapOf<String, kotlin.coroutines.Continuation<CustomApiCallResult>>()
    var environment: Environment = Environment.SANDBOX
    var hasHandleSubmitListener: Boolean = false  // Flag to indicate if handleSubmit listener is available

    private val componentState = mutableStateOf<PaymentMethodComponent?>(null)
    private var lastPreferredHeight = 0
    private var lastPreferredWidth = 0

    private fun emitOnDimensionsChanged(width: Dp, height: Dp) {
        val newWidth = width.value.toInt()
        val newHeight = height.value.toInt()

        // Break the infinite layout loop: Only emit if the size actually changed
        if (newWidth != lastPreferredWidth || newHeight != lastPreferredHeight) {
            lastPreferredWidth = newWidth
            lastPreferredHeight = newHeight

            val eventData = Arguments.createMap().apply {
                putDouble("width", width.value.toDouble())
                putDouble("height", height.value.toDouble())
            }

            sendEvent("onDimensionsChanged", eventData)
        }
    }

    private val mLayoutRunnable = Runnable {
        if (!isAttachedToWindow) return@Runnable
        val child = if (childCount > 0) getChildAt(0) else null
        if (child == null || !child.isAttachedToWindow) return@Runnable

        // Measure the child. Keep the width constrained by React Native,
        // but let the height be UNSPECIFIED so Compose can size itself.
        child.measure(
            MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
        )

        // Layout the child using its newly measured dimensions
        child.layout(0, 0, child.measuredWidth, child.measuredHeight)
    }

    override fun requestLayout() {
        super.requestLayout()
        if (!isAttachedToWindow) return
        post(mLayoutRunnable)
    }

    init {
        Log.d("CardView", "🎯 CardView instance created")
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    /**
     * Called from JavaScript with the API response after payment submission
     */
    fun handleSubmitResponse(requestId: String, success: Boolean, data: ReadableMap?) {
        CardViewRegistry.unregisterView(requestId)
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
            val requestId = UUID.randomUUID().toString()
            pendingContinuations[requestId] = continuation
            CardViewRegistry.registerView(requestId, this)

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

            CardModule.emitEvent(event)
        }
    }

    fun initialize(
        paymentSessionID: String,
        paymentSessionSecret: String,
        publicKey: String
    ) {
        Log.d("CardView", "🚀 initialize() called with sessionID: $paymentSessionID")
        Log.d("CardView", "📋 hasHandleSubmitListener: $hasHandleSubmitListener")
        if (hasInitialized) {
            Log.d("CardView", "⚠️ Already initialized, skipping")
            return
        }
        hasInitialized = true

        // Store session data for handleSubmit functionality
        currentSessionData = SessionData(paymentSessionID, paymentSessionSecret)

        // Register this view with the registry
        CardViewRegistry.registerView(paymentSessionID, this)

        // Obtain a ComponentActivity for Card flow (no specific coordinator needed like GooglePay)
        Log.d("CardView", "📱 Getting ComponentActivity...")
        val activityForCoordinator: ComponentActivity? =
            (reactApplicationContext.currentActivity as? ComponentActivity)
                ?: (context as? ComponentActivity)
        Log.d("CardView", "📱 Activity: $activityForCoordinator")
        if (activityForCoordinator == null) {
            Log.e(
                "CardView",
                "Host Activity not available or not a ComponentActivity; cannot initialize Card payment"
            )
            // Give up early to avoid crash; RN will keep the view rendered without Card initialized.
            // Caller can re-render later when Activity is ready.
            hasInitialized = false
            return
        }

        val customComponentCallback = if (hasHandleSubmitListener) {
            // Client passed handleSubmit from JS, use callback that emits to JS
            ComponentCallback(
                onReady = { component ->
                    if (BuildConfig.DEBUG) {
                        Log.d("CardView", "onReady: ${component.name}")
                    }
                },
                handleSubmit = { sessionData ->
                    val resultToReturn: ApiCallResult = try {
                        currentSessionData?.let { baseSessionData ->
                            val sessionDataWithRaw = baseSessionData.copy(
                                sessionData = sessionData
                            )

                            val result = kotlinx.coroutines.runBlocking {
                                this@CardView.handleSubmit(sessionDataWithRaw)
                            }

                            if (result.success) {
                                try {
                                    val responseJson = result.data?.get("response") as? String ?: "{\"status\":\"success\"}"

                                    // Parse the JSON response to create PaymentSessionSubmissionResult
                                    val jsonObject = JSONObject(responseJson)
                                    val id = jsonObject.getString("id")
                                    val status = jsonObject.getString("status")
                                    val type = jsonObject.optString("type", "card") // Default to card

                                    // Parse action if present
                                    val action = if (jsonObject.has("action")) {
                                        val actionObject = jsonObject.getJSONObject("action")
                                        PaymentAction(
                                            type = actionObject.getString("type"),
                                            url = if (actionObject.has("url")) actionObject.getString(
                                                "url"
                                            ) else null
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

                                    Log.d("CardView", "✅ Created PaymentSessionSubmissionResult: id=$id, status=$status, type=$type")
                                    if (action != null) {
                                        if (BuildConfig.DEBUG) {
                                            Log.d("CardView", "➡️ Action required: type=${action.type}, url=${action.url}")
                                        }
                                    }

                                    ApiCallResult.Success(submissionResult)
                                } catch (e: Exception) {
                                    Log.e("CardView", "Error parsing response JSON", e)
                                    ApiCallResult.Failure
                                }
                            } else {
                                ApiCallResult.Failure
                            }
                        } ?: ApiCallResult.Failure
                    } catch (e: Exception) {
                        Log.e("CardView", "Error in handleSubmit", e)
                        ApiCallResult.Failure
                    }
                    resultToReturn
                },
                onSuccess = { component, paymentID ->
                    if (BuildConfig.DEBUG) {
                        Log.d("CardView", "onSuccess: ${component.name}, $paymentID")
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
                        "CardView",
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
        } else {
            // Client didn't pass handleSubmit, use minimal callback without submit handling
            ComponentCallback(
                onReady = { component ->
                    if (BuildConfig.DEBUG) {
                        Log.d("CardView", "onReady: ${component.name}")
                    }
                },
                onSuccess = { component, paymentID ->
                    if (BuildConfig.DEBUG) {
                        Log.d("CardView", "onSuccess: ${component.name}, $paymentID")
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
                        "CardView",
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
        }

        val configuration = CheckoutComponentConfiguration(
            context = activityForCoordinator,
            paymentSession = PaymentSessionResponse(
                id = paymentSessionID,
                secret = paymentSessionSecret
            ),
            componentCallback = customComponentCallback,
            publicKey = publicKey,
            environment = environment
        )

        CoroutineScope(Dispatchers.Main).launch {
            try {
                Log.d("CardView", "⚙️ Creating CheckoutComponents...")
                checkoutComponents = CheckoutComponentsFactory(config = configuration).create()
                Log.d("CardView", "✅ CheckoutComponents created")

                Log.d("CardView", "💳 Creating Card component...")
                val cardComponent = checkoutComponents!!.create(PaymentMethodName.Card)
                Log.d("CardView", "💳 Card component created")

                val isAvailable = cardComponent.isAvailable()
                Log.d("CardView", "💳 Card isAvailable: $isAvailable")

                Log.d("CardView", "🎨 Creating ComposeView...")
                val composeView = ComposeView(context).apply {
                    setViewTreeLifecycleOwner(activityForCoordinator)
                    setViewTreeViewModelStoreOwner(activityForCoordinator)
                    setViewTreeSavedStateRegistryOwner(activityForCoordinator)
                    // Apply WRAP_CONTENT to height so Compose can determine its own size
                    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)
                    setContent {
                        MeasuringBox(
                            onSizeChanged = { size ->
                                emitOnDimensionsChanged(size.width, size.height)
                            }
                        ) {
                            cardComponent.Render()
                        }
                    }
                }

                componentState.value = cardComponent

                Log.d("CardView", "🧹 Removing all existing views")
                this@CardView.removeAllViews()
                Log.d("CardView", "📌 Posting compose view attachment to main thread")
                this@CardView.post {
                    try {
                        Log.d("CardView", "➕ Adding compose view to container")
                        addView(composeView)
                        composeView.requestLayout()
                        this@CardView.requestLayout()
                        this@CardView.invalidate()
                        Log.d("CardView", "✅ Compose view successfully attached and laid out")
                    } catch (t: Throwable) {
                        Log.e("CardView", "❌ Error attaching Compose child view", t)
                    }
                }
            } catch (e: CheckoutError) {
                Log.e("CardView", "❌ Error creating Card component: ${e.message}", e)
            } catch (e: Exception) {
                Log.e("CardView", "❌ Unexpected error: ${e.message}", e)
            }
        }
    }
}

@Composable
public fun MeasuringBox(
    onSizeChanged: (DpSize) -> Unit,
    content: @Composable () -> Unit,
) {
    val density = LocalDensity.current

    Box(
        modifier = Modifier.onSizeChanged { size ->
            val sizeInDp = with(density) {
                DpSize(size.width.toDp(), size.height.toDp())
            }
            if (sizeInDp.height.value > 0 && sizeInDp.width.value > 0) {
                onSizeChanged(sizeInDp)
            }
        }
    ) {
        content()
    }
}