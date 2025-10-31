import Foundation
import UIKit
import SwiftUI
import React
import CheckoutComponentsSDK

class ApplePayView: UIView {
  // MARK: - Props set from RN
  @objc var paymentSessionID: NSString? { didSet { ApplePayViewRegistry.update(self); maybeInitialize() } }
  @objc var paymentSessionSecret: NSString? { didSet { maybeInitialize() } }
  @objc var publicKey: NSString? { didSet { maybeInitialize() } }
  @objc var merchantIdentifier: NSString? { didSet { maybeInitialize() } }
  @objc var environment: NSString? { didSet { maybeInitialize() } }

  // MARK: - Private state
  private var hasInitialized = false
  private var checkoutComponents: CheckoutComponents?
  private var hostingController: UIHostingController<AnyView>?
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

      let callbacks = CheckoutComponents.Callbacks(
        onReady: { paymentMethod in
          NSLog("ApplePayView onReady: \(paymentMethod.name)")
        },
        handleTap: { _ async -> Bool in true },
        onChange: { _ in },
        onSubmit: { _ in },
        onTokenized: nil,
        handleSubmit: { [weak self] submitData in
          guard let self else { return .failure }
          return await self.bridgeHandleSubmit(sessionId: paymentSessionID,
                                               secret: paymentSessionSecret,
                                               submitData: submitData)
        },
        onSuccess: { [weak self] paymentMethod, paymentID in
          guard let self else { return }
          self.emit(name: "onFlowPaymentSuccess", body: [
            "component": paymentMethod.name,
            "paymentId": paymentID
          ])
        },
        onError: { [weak self] error in
          guard let self else { return }
          self.emit(name: "onFlowPaymentError", body: [
            "component": "ApplePay",
            "errorMessage": error.localizedDescription,
            "errorCode": "\(error.errorCode)"
          ])
        }
      )

      let configuration = try await CheckoutComponents.Configuration(
        paymentSession: session,
        publicKey: publicKey,
        environment: resolveEnvironment(),
        callbacks: callbacks
      )

      checkoutComponents = CheckoutComponents(configuration: configuration)

  // Create Apple Pay component and render
  let mId = (merchantIdentifier as String?) ?? "merchant.com.flow.checkout.sandbox"
  let component = try checkoutComponents!.create(.applePay(merchantIdentifier: mId,
                       showPayButton: true))

      guard let renderable = component as? any CheckoutComponents.Renderable else {
        NSLog("ApplePayView: component not renderable")
        return
      }
      let view = renderable.render()
      attachSwiftUIView(view)
    } catch {
      NSLog("ApplePayView init error: \(error.localizedDescription)")
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
    self.addSubview(controller.view)
    NSLayoutConstraint.activate([
      controller.view.leadingAnchor.constraint(equalTo: self.leadingAnchor),
      controller.view.trailingAnchor.constraint(equalTo: self.trailingAnchor),
      controller.view.topAnchor.constraint(equalTo: self.topAnchor),
      controller.view.bottomAnchor.constraint(equalTo: self.bottomAnchor)
    ])
    self.hostingController = controller
  }

  // MARK: - JS Bridge for handleSubmit
  private func emit(name: String, body: [String: Any]) {
    ApplePayModule.shared?.sendEvent(withName: name, body: body)
  }

  private func emitHandleSubmit(requestId: String, id: String, secret: String, submitData: String) {
    let session: [String: Any] = [
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
    let requestId = sessionId
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
}
