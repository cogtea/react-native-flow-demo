package com.demoflowapp

import android.content.Context
import android.util.Log
import android.widget.FrameLayout
import android.view.ViewGroup
import android.widget.TextView
import android.graphics.Color
import com.checkout.components.core.CheckoutComponentsFactory
import com.checkout.components.interfaces.Environment
import com.checkout.components.interfaces.component.CheckoutComponentConfiguration
import com.checkout.components.interfaces.error.CheckoutError
import com.checkout.components.interfaces.model.PaymentSessionResponse
import com.checkout.components.interfaces.component.ComponentCallback
import com.checkout.components.interfaces.model.ComponentName
import com.checkout.components.interfaces.model.PaymentMethodName
import com.checkout.components.interfaces.api.CheckoutComponents
import com.checkout.components.wallet.wrapper.GooglePayFlowCoordinator
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.activity.ComponentActivity
import com.checkout.components.interfaces.uicustomisation.font.FontName
import com.checkout.components.interfaces.uicustomisation.BorderRadius
import com.checkout.components.interfaces.uicustomisation.designtoken.ColorTokens
import com.checkout.components.interfaces.uicustomisation.font.*
import com.checkout.components.interfaces.uicustomisation.designtoken.DesignTokens

class FlowModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private lateinit var checkoutComponents: CheckoutComponents
    private var containerView: FrameLayout? = null
    private var googlePayCoordinator: GooglePayFlowCoordinator? = null

    override fun getName(): String = "FlowModule"
    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    @ReactMethod fun addListener(eventName: String?) {}
    @ReactMethod fun removeListeners(count: Int) {}

    @ReactMethod
    fun startPaymentSession(paymentSessionID: String, paymentSessionToken: String, paymentSessionSecret: String) {
        val activity = currentActivity as? ComponentActivity ?: run {
            Log.e("FlowModule", "Current activity is not a ComponentActivity")
            return
        }

        activity.runOnUiThread {
            if (BuildConfig.DEBUG) {
                Log.d("FlowModule", "Starting payment session on UI thread")
            }

            // Create container view
            containerView = FrameLayout(activity).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            }

            activity.addContentView(containerView, containerView?.layoutParams)

            // Setup Google Pay flow coordinator
            googlePayCoordinator = GooglePayFlowCoordinator(
                context = activity,
                handleActivityResult = { resultCode, data ->
                    checkoutComponents.handleActivityResult(resultCode, data)
                }
            )

            startCheckoutFlow(
                activity,
                paymentSessionID,
                paymentSessionToken,
                paymentSessionSecret
            )
        }
    }

    private fun startCheckoutFlow(
        activity: ComponentActivity,
        paymentSessionID: String,
        paymentSessionToken: String,
        paymentSessionSecret: String
    ) {
        val customComponentCallback = ComponentCallback(
            onReady = { component ->
                if (BuildConfig.DEBUG) {
                    Log.d("FlowModule", "Component ready: ${component.name}")
                }
            },
            onSubmit = { component ->
                if (BuildConfig.DEBUG) {
                    Log.d("FlowModule", "Component submitted: ${component.name}")
                }
            },
            onSuccess = { component, paymentID ->
                if (BuildConfig.DEBUG) {
                    Log.d("FlowModule", "Payment Success: ${component.name} - $paymentID")
                }
                val map = Arguments.createMap().apply {
                    putString("component", component::class.java.simpleName)
                    putString("paymentId", paymentID)
                }
                sendEvent("onFlowPaymentSuccess", map)
            },
            onError = { component, checkoutError ->
                Log.e("FlowModule", "Error: ${component.name} - ${checkoutError.message}")
                val map = Arguments.createMap().apply {
                    putString("component", component::class.java.simpleName)
                    putString("errorMessage", checkoutError.message ?: "Unknown error")
                    putString("errorCode", checkoutError.code.toString())
                }
                sendEvent("onFlowPaymentError", map)
            }
        )

        val designTokens = DesignTokens(
            colorTokens = ColorTokens(
                colorAction = 0xFF00CC2D,
                colorBackground = 0xFF17201E,
                colorBorder = 0xFF00CC2D,
                colorDisabled = 0xFFBBFFB9,
                colorPrimary = 0xFFB1B1B1,
                colorFormBackground = 0xFF24302D,
                colorFormBorder = 0xFFB1B1B1,
                colorInverse = 0xFFFFFFFF,
                colorOutline = 0xFFB1B1B1,
                colorSecondary = 0xFF000000,
                colorSuccess = 0xFF00CC2D,
                colorError = 0xFFFF0000,
                colorScrolledContainer = 0xFFE8E6E6
            ),
            borderButtonRadius = BorderRadius(all = 20),
            borderFormRadius = BorderRadius(all = 20),
            fonts = mapOf(
                FontName.Subheading to Font(
                    fontStyle = FontStyle.Italic,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = FontFamily.Monospace,
                    letterSpacing = 2,
                    lineHeight = 2
                ),
                FontName.Input to Font(
                    fontStyle = FontStyle.Italic,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = FontFamily.Monospace,
                    letterSpacing = 2,
                    lineHeight = 2
                ),
                FontName.Button to Font(
                    fontStyle = FontStyle.Italic,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = FontFamily.SansSerif,
                    letterSpacing = 2,
                    lineHeight = 2
                ),
                FontName.Label to Font(
                    fontStyle = FontStyle.Normal,
                    fontWeight = FontWeight.Light,
                    fontFamily = FontFamily.Cursive,
                    letterSpacing = 2,
                    lineHeight = 2
                )
            )
        )

        val configuration = CheckoutComponentConfiguration(
            context = activity,
            paymentSession = PaymentSessionResponse(
                id = paymentSessionID,
                paymentSessionToken = paymentSessionToken,
                paymentSessionSecret = paymentSessionSecret
            ),
            componentCallback = customComponentCallback,
            publicKey = BuildConfig.FLOW_API_KEY,
            environment = Environment.SANDBOX,
            //appearance = designTokens,
            flowCoordinators = mapOf(PaymentMethodName.GooglePay to googlePayCoordinator!!)
        )

        CoroutineScope(Dispatchers.IO).launch {
            try {
                checkoutComponents = CheckoutComponentsFactory(config = configuration).create()
                // val flowComponent = checkoutComponents.create(ComponentName.Flow)
                //val googlePayComponent = checkoutComponents.create(PaymentMethodName.GooglePay)
                // Log.d("FlowModule", "Created GooglePay component: $googlePayComponent")
                //googlePayComponent.Render()

                val googlePayComponent = checkoutComponents.create(PaymentMethodName.GooglePay)

                if (BuildConfig.DEBUG) {
                    Log.d(
                        "FlowModule",
                        if (googlePayComponent.isAvailable())
                            "✔️ Google Pay component is available"
                        else
                            "✖️ Google Pay component is NOT available"
                    )
                }

                withContext(Dispatchers.Main) {
                    containerView?.let {
                        val view = googlePayComponent.provideView(it)
                        if (view != null) {
                            it.addView(view)
                        } else {
                            it.addView(TextView(activity).apply {
                                text = "Flow component failed to render."
                                textSize = 20f
                                setTextColor(Color.RED)
                            })
                        }
                    }
                }

            } catch (checkoutError: CheckoutError) {
                Log.e("FlowModule", "Exception during component creation", checkoutError)
                val errorParams = Arguments.createMap().apply {
                    putString("component", "Flow")
                    putString("errorMessage", checkoutError.message ?: "Unknown error")
                    putString("errorCode", checkoutError.code.toString())
                }
                sendEvent("onFlowPaymentError", errorParams)
            }
        }
    }

    @ReactMethod
    fun dismissFlow() {
        currentActivity?.runOnUiThread {
            containerView?.let {
                (it.parent as? ViewGroup)?.removeView(it)
                if (BuildConfig.DEBUG) {
                    Log.d("FlowModule", "Flow UI dismissed")
                }
            }
        }
    }
}
