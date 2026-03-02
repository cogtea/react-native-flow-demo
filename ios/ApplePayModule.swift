import Foundation
import React

@objc(ApplePayModule)
class ApplePayModule: RCTEventEmitter {
  static weak var shared: ApplePayModule?

  override init() {
    super.init()
    ApplePayModule.shared = self
  }

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    return ["onHandleSubmit", "onFlowPaymentSuccess", "onFlowPaymentError"]
  }

  // Allow emitting events from Swift code
  func emitHandleSubmit(eventBody: [String: Any]) {
    sendEvent(withName: "onHandleSubmit", body: eventBody)
  }

  // Called by JS after it handled submit
  @objc(handleSubmitResponse:success:data:)
  func handleSubmitResponse(_ requestId: String, success: Bool, data: NSDictionary?) {
    ApplePayViewRegistry.handleSubmitResponse(requestId: requestId, success: success, data: data)
  }
}

protocol HandleSubmitResponseTarget: AnyObject {
  var paymentSessionID: NSString? { get }
  func handleSubmitResponse(requestId: String, success: Bool, data: NSDictionary?)
}

// Registry to route responses back to the right view instance
class ApplePayViewRegistry {
  private static var views = [String: WeakHandleSubmitTarget]()

  private static func key(for view: HandleSubmitResponseTarget) -> String? {
    if let sid = view.paymentSessionID as String?, !sid.isEmpty { return sid }
    return nil
  }

  static func register(_ view: HandleSubmitResponseTarget) {
    guard let k = key(for: view) else { return }
    views[k] = WeakHandleSubmitTarget(value: view)
  }

  static func update(_ view: HandleSubmitResponseTarget) { register(view) }

  static func unregister(_ view: HandleSubmitResponseTarget) {
    let viewObject = view as AnyObject
    // Remove any entries pointing to this view
    for (k, v) in views where v.value === viewObject { views.removeValue(forKey: k) }
  }

  static func handleSubmitResponse(requestId: String, success: Bool, data: NSDictionary?) {
    // Direct lookup first
    if let target = views[requestId]?.target {
      target.handleSubmitResponse(requestId: requestId, success: success, data: data)
      return
    }
    // Fallback: sweep dead refs and try matching by session id
    views = views.filter { $0.value.value != nil }
    for (_, weakView) in views {
      weakView.target?.handleSubmitResponse(requestId: requestId, success: success, data: data)
    }
  }
}

private struct WeakHandleSubmitTarget {
  weak var value: AnyObject?

  init(value: HandleSubmitResponseTarget) {
    self.value = value as AnyObject
  }

  var target: HandleSubmitResponseTarget? {
    return value as? HandleSubmitResponseTarget
  }
}
