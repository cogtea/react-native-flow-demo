package com.demoflowapp.card

import android.content.Context
import android.util.Log
import android.view.View
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.demoflowapp.BuildConfig
import androidx.activity.ComponentActivity
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.checkout.components.core.CheckoutComponentsFactory
import com.checkout.components.interfaces.Environment
import com.checkout.components.interfaces.api.CheckoutComponents
import com.checkout.components.interfaces.component.CheckoutComponentConfiguration
import com.checkout.components.interfaces.component.ComponentCallback
import com.checkout.components.interfaces.component.ComponentOption
import com.checkout.components.interfaces.error.CheckoutError
import com.checkout.components.interfaces.model.PaymentMethodName
import com.checkout.components.interfaces.model.PaymentSessionResponse
import com.checkout.components.interfaces.model.ApiCallResult
import com.checkout.components.interfaces.model.paymentsession.PaymentSessionSubmissionResult
import com.checkout.components.interfaces.model.paymentsession.PaymentAction
import org.json.JSONObject
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import java.util.UUID

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
    private var renderedCardComponent: Any? = null
    private var hasInitialized = false
    private var currentSessionData: SessionData? = null
    private var lastIsValid: Boolean? = null
    private var lastReportedHeightPx: Int = 0
    private var renderedCardView: View? = null
    private var globalLayoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null
    private var preDrawListener: ViewTreeObserver.OnPreDrawListener? = null
    private var pendingContinuations = mutableMapOf<String, kotlin.coroutines.Continuation<CustomApiCallResult>>()
    private var submitAction: () -> Unit = {
        Log.e("CardView", "❌ submitFromJs called before card component submit action is ready")
    }
    private val layoutRunnable = Runnable {
        if (width > 0) {
            measure(
                MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
            )
            layout(left, top, right, top + measuredHeight)
            emitNativeHeightIfChanged(measuredHeight)
        }
    }
    var environment: Environment = Environment.SANDBOX
    var showPayButton: Boolean = false
    var hasHandleSubmitListener: Boolean = false  // Flag to indicate if handleSubmit listener is available

    init {
        Log.d("CardView", "🎯 CardView instance created")
        clipChildren = false
        clipToPadding = false
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        val child = renderedCardView
        if (child != null && child.isAttachedToWindow) {
            val w = right - left
            // Measure child without height constraint so Compose can report its full preferred height
            // even when CardView is constrained to a smaller size by RN's Yoga layout.
            // This ensures addOnLayoutChangeListener fires on every Compose recomposition.
            child.measure(
                MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
            )
            child.layout(0, 0, w, child.measuredHeight)
        } else {
            super.onLayout(changed, left, top, right, bottom)
        }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val child = renderedCardView
        if (child != null && child.isAttachedToWindow) {
            child.measure(
                widthMeasureSpec,
                MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
            )
            val fallback = super.getSuggestedMinimumHeight().coerceAtLeast(1)
            val h = child.measuredHeight.coerceAtLeast(fallback)
            setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), h)
            emitNativeHeightIfChanged(h)
        } else {
            super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        }
    }

    override fun requestLayout() {
        super.requestLayout()
        post(layoutRunnable)
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
    }

    private fun emitValidity(isValid: Boolean) {
        if (lastIsValid == isValid) return
        lastIsValid = isValid
        val map = Arguments.createMap().apply {
            putBoolean("isValid", isValid)
        }
        sendEvent("onCardValidityChange", map)
    }

    private fun emitNativeHeightIfChanged(heightPx: Int) {
        if (heightPx <= 0) return
        if (heightPx == lastReportedHeightPx) return
        lastReportedHeightPx = heightPx
        val heightDp = (heightPx / resources.displayMetrics.density).toInt()
        val map = Arguments.createMap().apply {
            putInt("height", heightDp)
        }
        sendEvent("onCardNativeHeight", map)
    }

    private fun detachHeightListeners(view: View?) {
        if (view == null) return
        if (!view.viewTreeObserver.isAlive) return

        globalLayoutListener?.let { listener ->
            view.viewTreeObserver.removeOnGlobalLayoutListener(listener)
        }
        preDrawListener?.let { listener ->
            view.viewTreeObserver.removeOnPreDrawListener(listener)
        }

        globalLayoutListener = null
        preDrawListener = null
    }

    private fun sampleAndEmitHeight(view: View) {
        if (!view.isAttachedToWindow) return
        var h = view.height
        if (h <= 0) {
            val w = view.width.coerceAtLeast(this@CardView.width).coerceAtLeast(1)
            view.measure(
                MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
            )
            h = view.measuredHeight
        }
        if (h > 0) {
            val prev = lastReportedHeightPx
            emitNativeHeightIfChanged(h)
            if (h != prev) {
                this@CardView.requestLayout()
            }
        }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        detachHeightListeners(renderedCardView)
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
                },
                onChange = { component ->
                    renderedCardView?.let { view ->
                        // Sample immediately on the same callback tick to reduce perceived latency.
                        sampleAndEmitHeight(view)
                    }
                    // Trigger re-measure so Yoga picks up the new child height.
                    this@CardView.requestLayout()
                    CoroutineScope(Dispatchers.Main).launch {
                        val isValid = try {
                            component.isValid()
                        } catch (_: Throwable) {
                            false
                        }
                        if (BuildConfig.DEBUG) {
                            Log.d("CardView", "onChange: ${component.name}, isValid=$isValid")
                        }
                        emitValidity(isValid)
                    }
                    val map =
                            Arguments.createMap().apply {
                                putString("component", component::class.java.simpleName)
                            }
                    sendEvent("onFlowPaymentChange", map)
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

    val cardOption = ComponentOption(
        showPayButton = showPayButton,
        callback = customComponentCallback
    )

    val configuration =
        CheckoutComponentConfiguration(
            activityForCoordinator,
            publicKey,
            environment,
            PaymentSessionResponse(paymentSessionID, paymentSessionSecret),
            mapOf(PaymentMethodName.Card to cardOption)
        )

        CoroutineScope(Dispatchers.Main).launch {
            try {
                Log.d("CardView", "⚙️ Creating CheckoutComponents...")
                checkoutComponents = CheckoutComponentsFactory(config = configuration).create()
                Log.d("CardView", "✅ CheckoutComponents created")
                
                Log.d("CardView", "💳 Creating Card component...")
                val cardComponent = checkoutComponents!!.create(PaymentMethodName.Card)
                renderedCardComponent = cardComponent
                submitAction = {
                    CoroutineScope(Dispatchers.Main).launch {
                        try {
                            cardComponent.submit()
                        } catch (t: Throwable) {
                            Log.e("CardView", "❌ cardComponent.submit() failed", t)
                        }
                    }
                }
                Log.d("CardView", "💳 Card component created")
                
                val isAvailable = cardComponent.isAvailable()
                Log.d("CardView", "💳 Card isAvailable: $isAvailable")
                
                Log.d("CardView", "🎨 Requesting view from component...")
                val previousView = renderedCardView
                val view = cardComponent.provideView(this@CardView)
                renderedCardView = view
                Log.d("CardView", "✅ View provided successfully: $view")

                view.setViewTreeLifecycleOwner(activityForCoordinator)
                view.setViewTreeViewModelStoreOwner(activityForCoordinator)
                view.setViewTreeSavedStateRegistryOwner(activityForCoordinator)

                val lp = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)
                view.layoutParams = lp

                Log.d("CardView", "🧹 Removing all existing views")
                this@CardView.removeAllViews()

                Log.d("CardView", "📌 Posting view attachment to main thread")
                this@CardView.post {
                    try {
                        Log.d("CardView", "➕ Adding card view to container")
                        detachHeightListeners(previousView)
                        addView(view)
                        val listener = ViewTreeObserver.OnGlobalLayoutListener {
                            sampleAndEmitHeight(view)
                        }
                        val preDraw = ViewTreeObserver.OnPreDrawListener {
                            // Compose can update size during draw animations without a full global layout pass.
                            // Sampling here makes push/pull behavior consistent even when inputs are not focused.
                            sampleAndEmitHeight(view)
                            true
                        }
                        globalLayoutListener = listener
                        preDrawListener = preDraw
                        view.viewTreeObserver.addOnGlobalLayoutListener(listener)
                        view.viewTreeObserver.addOnPreDrawListener(preDraw)
                        val containerLp = layoutParams
                        if (containerLp != null && containerLp.height != LayoutParams.WRAP_CONTENT) {
                            containerLp.height = LayoutParams.WRAP_CONTENT
                            layoutParams = containerLp
                        }
                        view.requestLayout()
                        this@CardView.requestLayout()
                        this@CardView.invalidate()
                        Log.d("CardView", "✅ Card view successfully attached and laid out")
                    } catch (t: Throwable) {
                        Log.e("CardView", "❌ Error attaching Card child view", t)
                    }
                }
            } catch (e: CheckoutError) {
                Log.e("CardView", "❌ Error creating Card component: ${e.message}", e)
            } catch (e: Exception) {
                Log.e("CardView", "❌ Unexpected error: ${e.message}", e)
            }
        }
    }

    fun submitFromJs() {
        submitAction()
        Log.d("CardView", "✅ submitFromJs invoked cardComponent.submit()")
    }
}
