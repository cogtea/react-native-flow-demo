import Foundation
import CheckoutComponentsSDK
import SwiftUI
import React

@objc(CheckoutFlowManager)
class CheckoutFlowManager: RCTEventEmitter {

    private var checkoutComponents: CheckoutComponents?
    private var flowHostingController: UIHostingController<AnyView>?

    private let publicKey = "pk_sbox_u57rqbpjsrmyjpyrycxk42jbnuz"
    private let environment = CheckoutComponents.Environment.sandbox

    override static func requiresMainQueueSetup() -> Bool {
        return false
    }

    override func supportedEvents() -> [String]! {
        return ["onFlowPaymentSuccess", "onFlowPaymentError"]
    }

    @objc func initialize(_ paymentSession: NSDictionary, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        guard let paymentSessionID = paymentSession["id"] as? String,
              let paymentSessionSecret = paymentSession["payment_session_secret"] as? String else {
            rejecter("ERROR", "Invalid payment session object", nil)
            return
        }

        Task {
            do {
                let session = PaymentSession(id: paymentSessionID, paymentSessionSecret: paymentSessionSecret)

                let config = try await CheckoutComponents.Configuration(
                    paymentSession: session,
                    publicKey: publicKey,
                    environment: environment,
                    callbacks: CheckoutComponents.Callbacks(
                        onSuccess: { [weak self] paymentMethod, paymentID in
                            print("✅ Payment successful: \(paymentID)")
                            let eventBody: [String: Any] = [
                                "component": "Flow",
                                "paymentId": paymentID
                            ]
                            self?.sendEvent(withName: "onFlowPaymentSuccess", body: eventBody)
                            self?.dismissFlowView()
                        },
                        onError: { [weak self] error in
                            print("❌ Payment error: \(error)")
                            let eventBody: [String: Any] = [
                                "component": "Flow",
                                "errorMessage": error.localizedDescription,
                                "errorCode": "\(error.localizedDescription)"
                            ]
                            //self?.sendEvent(withName: "onFlowPaymentError", body: eventBody)
                            //self?.dismissFlowView()
                        }
                    )
                )

                self.checkoutComponents = CheckoutComponents(configuration: config)
                print("✅ CheckoutComponents initialized")

                DispatchQueue.main.async {
                    resolver(["success": true])
                }
            } catch {
                print("❌ Initialization error: \(error)")
                DispatchQueue.main.async {
                    rejecter("INIT_ERROR", "Failed to initialize: \(error.localizedDescription)", error as NSError)
                }
            }
        }
    }

    @objc func renderFlow(_ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        guard let checkoutComponents = checkoutComponents else {
            rejecter("NOT_INITIALIZED", "CheckoutComponents not initialized", nil)
            return
        }

        DispatchQueue.main.async {
            guard let rootViewController = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap({ $0.windows })
                .first(where: { $0.isKeyWindow })?.rootViewController else {
                rejecter("NO_ROOT_VIEW", "Root view controller not found", nil)
                return
            }

            do {
                let flowComponent = try checkoutComponents.create(.flow())
                let flowView = AnyView(flowComponent.render())

                let controller = UIHostingController(rootView: flowView)
                controller.view.frame = rootViewController.view.bounds
                controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]

                rootViewController.addChild(controller)
                rootViewController.view.addSubview(controller.view)
                controller.didMove(toParent: rootViewController)

                self.flowHostingController = controller

                resolver(["success": true])
            } catch {
                print("❌ Render error: \(error)")
                rejecter("RENDER_ERROR", "Failed to render Flow: \(error.localizedDescription)", error as NSError)
            }
        }
    }

    @objc func dismissFlow(_ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.dismissFlowView()
            resolver(["success": true])
        }
    }

    private func dismissFlowView() {
        guard let controller = self.flowHostingController else {
            print("ℹ️ No flow controller to dismiss")
            return
        }
        controller.willMove(toParent: nil)
        controller.view.removeFromSuperview()
        controller.removeFromParent()
        self.flowHostingController = nil
        print("✅ Flow UI dismissed")
    }
}