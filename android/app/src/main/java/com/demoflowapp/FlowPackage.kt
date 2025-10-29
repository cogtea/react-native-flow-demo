package com.demoflowapp

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.bridge.ReactApplicationContext
import com.demoflowapp.googlepay.GooglePayViewManager
import com.demoflowapp.googlepay.GooglePayModule

import java.util.*

class FlowPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(FlowModule(reactContext), GooglePayModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return listOf(GooglePayViewManager())
    }
}
