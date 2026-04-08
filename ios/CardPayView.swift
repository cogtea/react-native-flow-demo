import Foundation
import UIKit
import SwiftUI
import React
import CheckoutComponentsSDK

class CardPayView: UIView, HandleSubmitResponseTarget {
  @objc var paymentSessionID: NSString? { didSet { ApplePayViewRegistry.update(self); maybeInitialize() } }
  @objc var paymentSessionSecret: NSString? { didSet { maybeInitialize() } }
  @objc var publicKey: NSString? { didSet { maybeInitialize() } }
  @objc var merchantIdentifier: NSString? { didSet { maybeInitialize() } }
  @objc var environment: NSString? { didSet { maybeInitialize() } }
  @objc var paymentMethod: NSString? { didSet { maybeInitialize() } }
  @objc var hasHandleSubmitListener: Bool = false { didSet { maybeInitialize() } }
  @objc var hasOnTokenizedListener: Bool = false { didSet { maybeInitialize() } }

  private var hasInitialized = false
  private var checkoutComponents: CheckoutComponents?
  private var hostingController: UIHostingController<AnyView>?
  private weak var parentViewControllerRef: UIViewController?
  private var pendingContinuations: [String: CheckedContinuation<CheckoutComponents.APICallResult, Never>] = [:]
  private var pendingTokenizedContinuations: [String: CheckedContinuation<CheckoutComponents.CallbackResult, Never>] = [:]

  override init(frame: CGRect) {
    super.init(frame: frame)
    paymentMethod = "card"
    ApplePayViewRegistry.register(self)
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    paymentMethod = "card"
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
      let session = PaymentSession(id: paymentSessionID, paymentSessionSecret: paymentSessionSecret)

      let handleSubmitCallback: ((CheckoutComponents.SessionData) async -> CheckoutComponents.APICallResult)? = hasHandleSubmitListener ? { [weak self] submitData in
        guard let self else { return .failure }
        return await self.bridgeHandleSubmit(sessionId: paymentSessionID,
                                             secret: paymentSessionSecret,
                                             submitData: submitData)
      } : nil

      let onTokenizedCallback: ((CheckoutComponents.TokenizationResult) async -> CheckoutComponents.CallbackResult)? = hasOnTokenizedListener ? { [weak self] tokenizationResult in
        guard let self else { return .accepted }
        return await self.bridgeOnTokenized(tokenizationResult: tokenizationResult)
      } : nil

      let callbacks = CheckoutComponents.Callbacks(
        onReady: { paymentMethod in
          NSLog("CardPayView onReady: \(paymentMethod.name)")
        },
        handleTap: { _ async -> Bool in true },
        onChange: { _ in },
        onSubmit: { _ in },
        onTokenized: onTokenizedCallback,
        handleSubmit: handleSubmitCallback,
        onSuccess: { [weak self] paymentMethod, paymentID in
          guard let self else { return }
          self.emit(name: "onFlowPaymentSuccess", body: [
            "component": paymentMethod.name,
            "paymentId": paymentID
          ])
          DispatchQueue.main.async {
            self.dismissAnyPresentedViewController()
          }
        },
        onError: { [weak self] error in
          guard let self else { return }
          self.emit(name: "onFlowPaymentError", body: [
            "component": "Card",
            "errorMessage": error.localizedDescription,
            "errorCode": "\(error.errorCode)"
          ])
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
      let component = try checkoutComponents!.create(
        .card(
          showPayButton: true,
          paymentButtonAction: .payment
        )
      )

      if component.isAvailable == false {
        NSLog("CardPayView: component not available")
        self.emit(name: "onFlowPaymentError", body: [
          "component": "Card",
          "errorMessage": "Card is not available on this device",
          "errorCode": "NOT_AVAILABLE"
        ])
        return
      }

      let view = component.render()
      attachSwiftUIView(view)
    } catch {
      NSLog("CardPayView init error: \(error.localizedDescription)")
    }
  }

  fileprivate func dismissAnyPresentedViewController() {
    func tryDismiss(from root: UIViewController?) {
      guard let root = root else { return }
      if let presented = root.presentedViewController {
        presented.dismiss(animated: true)
      } else if root.presentingViewController != nil {
        root.dismiss(animated: true)
      }
    }

    let sceneWindows = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap({ $0.windows })

    for window in sceneWindows {
      tryDismiss(from: window.rootViewController)
    }

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

  private func emit(name: String, body: [String: Any]) {
    ApplePayModule.shared?.sendEvent(withName: name, body: body)
  }

  private func emitHandleSubmit(requestId: String, id: String, secret: String, submitData: String) {
    let session: [String: Any] = [
      "component": "card",
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
      self.pendingContinuations[requestId] = continuation
      self.emitHandleSubmit(requestId: requestId, id: sessionId, secret: secret, submitData: submitData)
    }
  }

  func handleSubmitResponse(requestId: String, success: Bool, data: NSDictionary?) {
    guard let continuation = pendingContinuations.removeValue(forKey: requestId) else { return }
    if success, let response = data?["response"] as? String, let result = decodeSubmissionResult(from: response) {
      continuation.resume(returning: .success(result))
    } else {
      continuation.resume(returning: .failure)
    }
  }

  private func emitHandleTokenized(requestId: String, tokenizationResult: CheckoutComponents.TokenizationResult) {
    var tokenData: [String: Any] = [
      "token": tokenizationResult.data.token,
      "type": tokenizationResult.data.type.rawValue,
      "expiresOn": tokenizationResult.data.expiresOn,
      "expiryMonth": tokenizationResult.data.expiryMonth,
      "expiryYear": tokenizationResult.data.expiryYear,
      "last4": tokenizationResult.data.last4,
      "bin": tokenizationResult.data.bin,
    ]
    if let scheme = tokenizationResult.data.scheme { tokenData["scheme"] = scheme }
    if let schemeLocal = tokenizationResult.data.schemeLocal { tokenData["schemeLocal"] = schemeLocal }
    if let cardType = tokenizationResult.data.cardType { tokenData["cardType"] = cardType }
    if let cardCategory = tokenizationResult.data.cardCategory { tokenData["cardCategory"] = cardCategory }
    if let issuer = tokenizationResult.data.issuer { tokenData["issuer"] = issuer }
    if let issuerCountry = tokenizationResult.data.issuerCountry { tokenData["issuerCountry"] = issuerCountry }
    if let productId = tokenizationResult.data.productId { tokenData["productId"] = productId }
    if let productType = tokenizationResult.data.productType { tokenData["productType"] = productType }
    if let name = tokenizationResult.data.name { tokenData["name"] = name }
    if let cvv = tokenizationResult.data.cvv { tokenData["cvv"] = cvv }
    if let billingAddress = tokenizationResult.data.billingAddress {
      var addr: [String: Any] = ["country": billingAddress.country.rawValue]
      if let line1 = billingAddress.addressLine1 { addr["addressLine1"] = line1 }
      if let line2 = billingAddress.addressLine2 { addr["addressLine2"] = line2 }
      if let city = billingAddress.city { addr["city"] = city }
      if let state = billingAddress.state { addr["state"] = state }
      if let zip = billingAddress.zip { addr["zip"] = zip }
      tokenData["billingAddress"] = addr
    }
    if let phone = tokenizationResult.data.phone {
      tokenData["phone"] = [
        "number": phone.number,
        "countryCode": phone.countryCode,
      ]
    }
    if let preferredScheme = tokenizationResult.preferredScheme { tokenData["preferredScheme"] = preferredScheme }
    if let cardMetadata = tokenizationResult.cardMetadata {
      var meta: [String: Any] = [
        "bin": cardMetadata.bin,
        "scheme": cardMetadata.scheme,
      ]
      if let localSchemes = cardMetadata.localSchemes { meta["localSchemes"] = localSchemes }
      if let cardType = cardMetadata.cardType { meta["cardType"] = cardType }
      if let cardCategory = cardMetadata.cardCategory { meta["cardCategory"] = cardCategory }
      if let currency = cardMetadata.currency { meta["currency"] = currency }
      if let issuer = cardMetadata.issuer { meta["issuer"] = issuer }
      if let issuerCountry = cardMetadata.issuerCountry { meta["issuerCountry"] = issuerCountry }
      if let issuerCountryName = cardMetadata.issuerCountryName { meta["issuerCountryName"] = issuerCountryName }
      if let productId = cardMetadata.productId { meta["productId"] = productId }
      if let productType = cardMetadata.productType { meta["productType"] = productType }
      tokenData["cardMetadata"] = meta
    }
    let payload: [String: Any] = [
      "component": "card",
      "requestId": requestId,
      "tokenizationResult": tokenData,
    ]
    ApplePayModule.shared?.emitHandleTokenized(eventBody: ["tokenizationData": payload])
  }

  fileprivate func bridgeOnTokenized(tokenizationResult: CheckoutComponents.TokenizationResult) async -> CheckoutComponents.CallbackResult {
    let requestId = UUID().uuidString
    return await withCheckedContinuation { (continuation: CheckedContinuation<CheckoutComponents.CallbackResult, Never>) in
      self.pendingTokenizedContinuations[requestId] = continuation
      self.emitHandleTokenized(requestId: requestId, tokenizationResult: tokenizationResult)
    }
  }

  func handleTokenizedResponse(requestId: String, accepted: Bool, rejectionMessage: String?) {
    guard let continuation = pendingTokenizedContinuations.removeValue(forKey: requestId) else { return }
    if accepted {
      continuation.resume(returning: .accepted)
    } else {
      continuation.resume(returning: .rejected(message: rejectionMessage))
    }
  }
}
