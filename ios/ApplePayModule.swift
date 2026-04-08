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
    return ["onHandleSubmit", "onHandleTokenized", "onFlowPaymentSuccess", "onFlowPaymentError"]
  }

  // Allow emitting events from Swift code
  func emitHandleSubmit(eventBody: [String: Any]) {
    sendEvent(withName: "onHandleSubmit", body: eventBody)
  }

  func emitHandleTokenized(eventBody: [String: Any]) {
    sendEvent(withName: "onHandleTokenized", body: eventBody)
  }

  // Called by JS after it handled submit
  @objc(handleSubmitResponse:success:data:)
  func handleSubmitResponse(_ requestId: String, success: Bool, data: NSDictionary?) {
    ApplePayViewRegistry.handleSubmitResponse(requestId: requestId, success: success, data: data)
  }

  // Called by JS after it handled tokenized
  @objc(handleTokenizedResponse:accepted:rejectionMessage:)
  func handleTokenizedResponse(_ requestId: String, accepted: Bool, rejectionMessage: NSString?) {
    ApplePayViewRegistry.handleTokenizedResponse(requestId: requestId, accepted: accepted, rejectionMessage: rejectionMessage as String?)
  }

  @objc(submit:resolver:rejecter:)
  func submit(_ paymentSessionID: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      let submitted = ApplePayViewRegistry.submit(sessionID: paymentSessionID)
      if submitted {
        NSLog("ApplePayModule.submit: submit requested for sessionID=\(paymentSessionID)")
        resolve(["success": true])
      } else {
        NSLog("ApplePayModule.submit: unable to submit for sessionID=\(paymentSessionID)")
        reject("E_SUBMIT_TARGET_NOT_FOUND", "No ApplePayView found for paymentSessionID: \(paymentSessionID)", nil)
      }
    }
  }
}

protocol HandleSubmitResponseTarget: AnyObject {
  var paymentSessionID: NSString? { get }
  func handleSubmitResponse(requestId: String, success: Bool, data: NSDictionary?)
  func handleTokenizedResponse(requestId: String, accepted: Bool, rejectionMessage: String?)
  @MainActor func submitFromJS() -> Bool
}

extension HandleSubmitResponseTarget {
  @MainActor
  func submitFromJS() -> Bool {
    return false
  }

  func handleTokenizedResponse(requestId: String, accepted: Bool, rejectionMessage: String?) {}
}

// Registry to route responses back to the right view instance
class ApplePayViewRegistry {
  private static var views = [String: [WeakHandleSubmitTarget]]()

  private static func key(for view: HandleSubmitResponseTarget) -> String? {
    if let sid = view.paymentSessionID as String?, !sid.isEmpty { return sid }
    return nil
  }

  static func register(_ view: HandleSubmitResponseTarget) {
    guard let k = key(for: view) else { return }
    let viewObject = view as AnyObject
    var targets = views[k] ?? []
    targets = targets.filter { $0.value != nil && $0.value !== viewObject }
    targets.append(WeakHandleSubmitTarget(value: view))
    views[k] = targets
  }

  static func update(_ view: HandleSubmitResponseTarget) { register(view) }

  static func unregister(_ view: HandleSubmitResponseTarget) {
    let viewObject = view as AnyObject
    for key in views.keys {
      let remaining = (views[key] ?? []).filter { $0.value != nil && $0.value !== viewObject }
      if remaining.isEmpty {
        views.removeValue(forKey: key)
      } else {
        views[key] = remaining
      }
    }
  }

  static func handleSubmitResponse(requestId: String, success: Bool, data: NSDictionary?) {
    // Direct lookup first (all views for key)
    if let targets = views[requestId] {
      for weakTarget in targets {
        weakTarget.target?.handleSubmitResponse(requestId: requestId, success: success, data: data)
      }
      return
    }
    // Fallback: sweep dead refs and try matching by session id
    views = views.reduce(into: [String: [WeakHandleSubmitTarget]]()) { partial, entry in
      let alive = entry.value.filter { $0.value != nil }
      if !alive.isEmpty { partial[entry.key] = alive }
    }
    for (_, weakViews) in views {
      for weakView in weakViews {
        weakView.target?.handleSubmitResponse(requestId: requestId, success: success, data: data)
      }
    }
  }

  static func handleTokenizedResponse(requestId: String, accepted: Bool, rejectionMessage: String?) {
    if let targets = views[requestId] {
      for weakTarget in targets {
        weakTarget.target?.handleTokenizedResponse(requestId: requestId, accepted: accepted, rejectionMessage: rejectionMessage)
      }
      return
    }
    views = views.reduce(into: [String: [WeakHandleSubmitTarget]]()) { partial, entry in
      let alive = entry.value.filter { $0.value != nil }
      if !alive.isEmpty { partial[entry.key] = alive }
    }
    for (_, weakViews) in views {
      for weakView in weakViews {
        weakView.target?.handleTokenizedResponse(requestId: requestId, accepted: accepted, rejectionMessage: rejectionMessage)
      }
    }
  }

  @MainActor
  static func submit(sessionID: String) -> Bool {
    views = views.reduce(into: [String: [WeakHandleSubmitTarget]]()) { partial, entry in
      let alive = entry.value.filter { $0.value != nil }
      if !alive.isEmpty { partial[entry.key] = alive }
    }

    if let targets = views[sessionID] {
      for weakTarget in targets {
        if weakTarget.target?.submitFromJS() == true {
          return true
        }
      }
    }

    if let fallbackTarget = views.values
      .flatMap({ $0 })
      .compactMap({ $0.target })
      .first(where: { $0.submitFromJS() }) {
      NSLog("ApplePayViewRegistry.submit: fallback target used for sessionID=\(sessionID)")
      _ = fallbackTarget
      return true
    }

    return false
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
