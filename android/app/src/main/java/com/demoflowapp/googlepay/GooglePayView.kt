package com.demoflowapp.googlepay

import android.content.Context
import android.util.Log
import android.widget.FrameLayout
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
import com.checkout.components.wallet.wrapper.GooglePayFlowCoordinator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class GooglePayView(context: Context, private val reactApplicationContext: ReactApplicationContext) : FrameLayout(context) {
    private var checkoutComponents: CheckoutComponents? = null
    private var googlePayCoordinator: GooglePayFlowCoordinator? = null
    private var hasInitialized = false

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

    fun initialize(
            paymentSessionID: String,
            paymentSessionSecret: String,
            publicKey: String
    ) {
        if (hasInitialized) return
        hasInitialized = true

        googlePayCoordinator =
                GooglePayFlowCoordinator(
                        context = context,
                        handleActivityResult = { resultCode, data ->
                            checkoutComponents?.handleActivityResult(resultCode, data)
                        }
                )

        val customComponentCallback =
                ComponentCallback(
                        onReady = { component ->
                            Log.d("GooglePayView", "onReady: ${component.name}")
                        },
                        onSubmit = { component ->
                            Log.d("GooglePayView", "onSubmit: ${component.name}")
                        },
                        onSuccess = { component, paymentID ->
                            Log.d("GooglePayView", "onSuccess: ${component.name}, $paymentID")
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
                        context = context,
                        paymentSession =
                                PaymentSessionResponse(
                                        id = paymentSessionID,
                                        secret = paymentSessionSecret
                                ),
                        componentCallback = customComponentCallback,
                        publicKey = publicKey,
                        environment = Environment.SANDBOX,
                        flowCoordinators =
                                mapOf(PaymentMethodName.GooglePay to googlePayCoordinator!!)
                )

        CoroutineScope(Dispatchers.Main).launch {
            try {
                checkoutComponents = CheckoutComponentsFactory(config = configuration).create()
                val googlePayComponent = checkoutComponents!!.create(PaymentMethodName.GooglePay)
                Log.d("IsAvailable", googlePayComponent.isAvailable().toString())
                val view = googlePayComponent.provideView(this@GooglePayView)
                Log.d("GooglePayView", "View provided successfully")

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
