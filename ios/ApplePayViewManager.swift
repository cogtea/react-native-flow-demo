import Foundation
import React

@objc(ApplePayViewManager)
class ApplePayViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }

  // Exported module name to match JS requireNativeComponent('RNApplePayView')
  @objc override static func moduleName() -> String! { return "RNApplePayView" }

  override func view() -> UIView! {
    return ApplePayView()
  }
}
