import Capacitor
import UIKit
import AuthenticationServices

class CustomBridgeViewController: CAPBridgeViewController {
    private var splashView: UIView?
    private var splashHidden = false
    private var appleSignInReplyHandler: ((Any?, String?) -> Void)?

    override open func capacitorDidLoad() {
        let dark = UIColor(red: 8/255, green: 14/255, blue: 28/255, alpha: 1)
        view.backgroundColor = dark
        webView?.isOpaque = false
        webView?.backgroundColor = .clear
        webView?.scrollView.backgroundColor = .clear

        showSplash()
        webView?.configuration.userContentController.add(self, name: "appReady")
        webView?.configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "signInWithApple")
        DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) { [weak self] in
            self?.hideSplash()
        }
    }

    private func showSplash() {
        let splash = UIView(frame: view.bounds)
        splash.backgroundColor = UIColor(red: 8/255, green: 14/255, blue: 28/255, alpha: 1)
        splash.autoresizingMask = [.flexibleWidth, .flexibleHeight]

        if let splashImage = UIImage(named: "Splash") {
            let iv = UIImageView(image: splashImage)
            iv.contentMode = .scaleAspectFill
            iv.frame = splash.bounds
            iv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            splash.addSubview(iv)
        }

        view.addSubview(splash)
        splashView = splash
    }

    func hideSplash() {
        guard !splashHidden, let splash = splashView else { return }
        splashHidden = true
        splashView = nil
        UIView.animate(withDuration: 0.25, delay: 0, options: .curveEaseOut, animations: {
            splash.alpha = 0
        }, completion: { _ in
            splash.removeFromSuperview()
        })
    }
}

extension CustomBridgeViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        if message.name == "appReady" {
            DispatchQueue.main.async { [weak self] in self?.hideSplash() }
        }
    }
}

extension CustomBridgeViewController: WKScriptMessageHandlerWithReply {
    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage,
                                replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.name == "signInWithApple" else {
            replyHandler(nil, "Unknown message")
            return
        }

        let body = message.body as? [String: Any]
        let nonce = body?["nonce"] as? String ?? ""
        appleSignInReplyHandler = replyHandler

        DispatchQueue.main.async {
            let provider = ASAuthorizationAppleIDProvider()
            let request = provider.createRequest()
            request.requestedScopes = [.email, .fullName]
            request.nonce = nonce

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }
}

extension CustomBridgeViewController: ASAuthorizationControllerDelegate {
    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            appleSignInReplyHandler?(nil, "Failed to get identity token")
            appleSignInReplyHandler = nil
            return
        }

        var response: [String: Any] = [
            "identityToken": identityToken,
            "user": credential.user
        ]
        if let codeData = credential.authorizationCode,
           let authCode = String(data: codeData, encoding: .utf8) {
            response["authorizationCode"] = authCode
        }
        if let email = credential.email { response["email"] = email }
        if let fn = credential.fullName {
            response["givenName"] = fn.givenName ?? ""
            response["familyName"] = fn.familyName ?? ""
        }

        appleSignInReplyHandler?(response, nil)
        appleSignInReplyHandler = nil
    }

    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithError error: Error) {
        let nsErr = error as NSError
        if nsErr.code == ASAuthorizationError.canceled.rawValue {
            appleSignInReplyHandler?(nil, "canceled")
        } else {
            appleSignInReplyHandler?(nil, error.localizedDescription)
        }
        appleSignInReplyHandler = nil
    }
}

extension CustomBridgeViewController: ASAuthorizationControllerPresentationContextProviding {
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return view.window ?? UIWindow()
    }
}
