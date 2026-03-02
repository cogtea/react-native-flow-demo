import Foundation
import React

@objc(ApplePayViewManager)
class ApplePayViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }

  override func view() -> UIView! {
    return ApplePayView()
  }
}

@objc(CardViewIOSManager)
class CardViewIOSManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }

  override func view() -> UIView! {
    return CardPayView()
  }
}
