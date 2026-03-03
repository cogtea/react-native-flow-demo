import Foundation
import UIKit
import SwiftUI
import React
import CheckoutComponentsSDK

class ApplePayView: UIView, HandleSubmitResponseTarget {
  // MARK: - Props set from RN
  @objc var paymentSessionID: NSString? { didSet { ApplePayViewRegistry.update(self); maybeInitialize() } }
  @objc var paymentSessionSecret: NSString? { didSet { maybeInitialize() } }
  @objc var publicKey: NSString? { didSet { maybeInitialize() } }
  @objc var merchantIdentifier: NSString? { didSet { maybeInitialize() } }
  @objc var environment: NSString? { didSet { maybeInitialize() } }
  @objc var paymentMethod: NSString? { didSet { maybeInitialize() } }
  @objc var showPayButton: Bool = true { didSet { maybeInitialize() } }
  @objc var hasHandleSubmitListener: Bool = false { didSet { maybeInitialize() } }

  // MARK: - Private state
  private var hasInitialized = false
  private var checkoutComponents: CheckoutComponents?
  private var submittableComponent: (any CheckoutComponents.Submittable)?
  private var hostingController: UIHostingController<AnyView>?
  private weak var parentViewControllerRef: UIViewController?
  private var pendingContinuations: [String: CheckedContinuation<CheckoutComponents.APICallResult, Never>] = [:]

  override init(frame: CGRect) {
    super.init(frame: frame)
    ApplePayViewRegistry.register(self)
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    ApplePayViewRegistry.register(self)
  }

  deinit {
    ApplePayViewRegistry.unregister(self)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    maybeInitialize()
  }

  private func maybeInitialize() {
    guard !hasInitialized,
          let id = (paymentSessionID as String?), !id.isEmpty,
          let secret = paymentSessionSecret as String?, !secret.isEmpty,
          let key = publicKey as String?, !key.isEmpty else { return }
    Task { await initialize(paymentSessionID: id, paymentSessionSecret: secret, publicKey: key) }
  }

  @MainActor
  private func initialize(paymentSessionID: String, paymentSessionSecret: String, publicKey: String) async {
    guard !hasInitialized else { return }
    hasInitialized = true

    do {
  // Always use the real session id for backend calls
  let session = PaymentSession(id: paymentSessionID, paymentSessionSecret: paymentSessionSecret)

      let handleSubmitCallback: ((CheckoutComponents.SessionData) async -> CheckoutComponents.APICallResult)? = hasHandleSubmitListener ? { [weak self] submitData in
        guard let self else { return .failure }
        return await self.bridgeHandleSubmit(sessionId: paymentSessionID,
                                             secret: paymentSessionSecret,
                                             submitData: submitData)
      } : nil

      let shouldShowApplePayButton = showPayButton

      let callbacks = CheckoutComponents.Callbacks(
        onReady: { paymentMethod in
          NSLog("ApplePayView onReady: \(paymentMethod.name)")
        },
        handleTap: { component in
          if shouldShowApplePayButton,
             let submittable = component as? any CheckoutComponents.Submittable {
            submittable.submit()
          }
          return true
        },
        onChange: { [weak self] component in
          self?.submittableComponent = component
        },
        onSubmit: { _ in },
        handleSubmit: handleSubmitCallback,
        onSuccess: { [weak self] paymentMethod, paymentID in
          guard let self else { return }
          self.emit(name: "onFlowPaymentSuccess", body: [
            "component": paymentMethod.name,
            "paymentId": paymentID
          ])
          // Ensure any presented Apple Pay sheet/modal is dismissed
          DispatchQueue.main.async {
            self.dismissAnyPresentedViewController()
          }
        },
        onError: { [weak self] error in
          guard let self else { return }
          self.emit(name: "onFlowPaymentError", body: [
            "component": "ApplePay",
            "errorMessage": error.localizedDescription,
            "errorCode": "\(error.errorCode)"
          ])
          // Dismiss any presented modal in case an error leaves the sheet open
          DispatchQueue.main.async {
            self.dismissAnyPresentedViewController()
          }
        }
      )

      let configuration = try await CheckoutComponents.Configuration(
        paymentSession: session,
        publicKey: publicKey,
        environment: resolveEnvironment(),
        callbacks: callbacks
      )

      checkoutComponents = CheckoutComponents(configuration: configuration)

      let selectedPaymentMethod = ((paymentMethod as String?) ?? "applepay").lowercased()

      let component: any CheckoutComponents.Actionable
      if selectedPaymentMethod == "card" {
        component = try checkoutComponents!.create(
          .card(
            showPayButton: true,
            paymentButtonAction: .payment
          )
        )
      } else {
        let mId = (merchantIdentifier as String?) ?? "merchant.com.flow.checkout.sandbox"
        component = try checkoutComponents!.create(.applePay(merchantIdentifier: mId,
                             showPayButton: shouldShowApplePayButton))
      }
      if let submittable = component as? any CheckoutComponents.Submittable {
        submittableComponent = submittable
      }

      // If the SDK reports the component as unavailable, notify JS and don't render
      if component.isAvailable == false {
        NSLog("ApplePayView: component not available")
        self.emit(name: "onFlowPaymentError", body: [
          "component": "ApplePay",
          "errorMessage": "Apple Pay is not available on this device",
          "errorCode": "NOT_AVAILABLE"
        ])
        return
      }
      let view = component.render()
      attachSwiftUIView(view)
    } catch {
      NSLog("ApplePayView init error: \(error.localizedDescription)")
    }
  }

  // Dismiss any presented view controller (e.g. the Apple Pay sheet) from the app's key window.
  fileprivate func dismissAnyPresentedViewController() {
    NSLog("ApplePayView: attempt dismissAnyPresentedViewController")

    // Helper to attempt dismissing the presented controllers recursively
    func tryDismiss(from root: UIViewController?) {
      guard let root = root else { return }
      if let presented = root.presentedViewController {
        NSLog("ApplePayView: found presentedViewController of type: \(type(of: presented)) - dismissing")
        presented.dismiss(animated: true) {
          NSLog("ApplePayView: dismissed presentedViewController")
        }
      } else {
        // If root itself was presented, dismiss it
        if root.presentingViewController != nil {
          NSLog("ApplePayView: root is presented itself - dismissing root")
          root.dismiss(animated: true) {
            NSLog("ApplePayView: dismissed root")
          }
        } else {
          NSLog("ApplePayView: nothing to dismiss on this root (type: \(type(of: root)))")
        }
      }
    }

    // Scene-based windows (iOS 13+)
    let sceneWindows = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap({ $0.windows })

    for window in sceneWindows {
      tryDismiss(from: window.rootViewController)
    }

    // Fallback: iterate all application windows
    for window in UIApplication.shared.windows {
      tryDismiss(from: window.rootViewController)
    }
  }

  private func resolveEnvironment() -> CheckoutComponents.Environment {
    let value = (environment as String?)?.lowercased() ?? "sandbox"
    switch value {
    case "production", "prod", "live":
      return .production
    default:
      return .sandbox
    }
  }

  @MainActor
  private func attachSwiftUIView(_ swiftUIView: AnyView) {
    let controller = UIHostingController(rootView: swiftUIView)
    controller.view.backgroundColor = .clear
    controller.view.translatesAutoresizingMaskIntoConstraints = false

    // Find a suitable parent UIViewController to host this SwiftUI controller.
    // Prefer the nearest React view controller, fallback to key window root VC.
    let parentVC: UIViewController? = self.reactViewController() ?? UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first(where: { $0.isKeyWindow })?.rootViewController

    if let parentVC {
      parentVC.addChild(controller)
    }

    self.addSubview(controller.view)
    NSLayoutConstraint.activate([
      controller.view.leadingAnchor.constraint(equalTo: self.leadingAnchor),
      controller.view.trailingAnchor.constraint(equalTo: self.trailingAnchor),
      controller.view.topAnchor.constraint(equalTo: self.topAnchor),
      controller.view.bottomAnchor.constraint(equalTo: self.bottomAnchor)
    ])

    if let parentVC {
      controller.didMove(toParent: parentVC)
    }

    self.parentViewControllerRef = parentVC
    self.hostingController = controller
  }

  // MARK: - JS Bridge for handleSubmit
  private func emit(name: String, body: [String: Any]) {
    ApplePayModule.shared?.sendEvent(withName: name, body: body)
  }

  private func emitHandleSubmit(requestId: String, id: String, secret: String, submitData: String) {
    let component = ((paymentMethod as String?) ?? "applepay").lowercased()
    let session: [String: Any] = [
      "component": component,
      "requestId": requestId,
      "id": id,
      "secret": secret,
      "sessionData": submitData
    ]
    ApplePayModule.shared?.emitHandleSubmit(eventBody: ["sessionData": session])
  }

  private func decodeSubmissionResult(from json: String) -> CheckoutComponents.PaymentSessionSubmissionResult? {
    guard let data = json.data(using: .utf8) else { return nil }
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try? decoder.decode(CheckoutComponents.PaymentSessionSubmissionResult.self, from: data)
  }

  fileprivate func bridgeHandleSubmit(sessionId: String, secret: String, submitData: String) async -> CheckoutComponents.APICallResult {
    let requestId = UUID().uuidString
    return await withCheckedContinuation { (continuation: CheckedContinuation<CheckoutComponents.APICallResult, Never>) in
      // Store continuation
      self.pendingContinuations[requestId] = continuation
      // Emit to JS
      self.emitHandleSubmit(requestId: requestId, id: sessionId, secret: secret, submitData: submitData)
    }
  }

  // Called by module when JS responds
  func handleSubmitResponse(requestId: String, success: Bool, data: NSDictionary?) {
    guard let continuation = pendingContinuations.removeValue(forKey: requestId) else { return }
    if success, let response = data?["response"] as? String, let result = decodeSubmissionResult(from: response) {
      continuation.resume(returning: .success(result))
    } else {
      continuation.resume(returning: .failure)
    }
  }

  @MainActor
  func submitFromJS() -> Bool {
    guard let component = submittableComponent else {
      NSLog("ApplePayView submitFromJS: no submittable component available")
      self.emit(name: "onFlowPaymentError", body: [
        "component": "ApplePay",
        "errorMessage": "Apple Pay component is not ready yet",
        "errorCode": "NOT_READY"
      ])
      return false
    }

    if component.isValid == false {
      NSLog("ApplePayView submitFromJS: component is not valid")
      self.emit(name: "onFlowPaymentError", body: [
        "component": "ApplePay",
        "errorMessage": "Apple Pay component is not valid",
        "errorCode": "INVALID"
      ])
      return false
    }

    NSLog("ApplePayView submitFromJS: calling component.submit()")
    component.submit()
    return true
  }
}
