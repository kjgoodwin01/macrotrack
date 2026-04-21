import Capacitor
import AuthenticationServices
import CryptoKit

@objc(SignInWithApplePlugin)
public class SignInWithApplePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SignInWithApple"
    public let jsName = "SignInWithApple"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    private var authCallId: String?

    @objc func authorize(_ call: CAPPluginCall) {
        authCallId = call.callbackId

        let nonce = call.getString("nonce") ?? ""
        let scopes = (call.getString("scopes") ?? "email name")
            .components(separatedBy: " ")

        let provider = ASAuthorizationAppleIDProvider()
        let request = provider.createRequest()

        var authScopes: [ASAuthorization.Scope] = []
        if scopes.contains("email") { authScopes.append(.email) }
        if scopes.contains("name") { authScopes.append(.fullName) }
        request.requestedScopes = authScopes
        request.nonce = nonce

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self

        DispatchQueue.main.async {
            controller.performRequests()
        }
    }
}

extension SignInWithApplePlugin: ASAuthorizationControllerDelegate {
    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let callId = authCallId,
              let call = bridge?.savedCall(withID: callId),
              let credential = authorization.credential as? ASAuthorizationAppleIDCredential else { return }

        var response: [String: Any] = [:]
        if let token = credential.identityToken,
           let tokenStr = String(data: token, encoding: .utf8) {
            response["identityToken"] = tokenStr
        }
        if let code = credential.authorizationCode,
           let codeStr = String(data: code, encoding: .utf8) {
            response["authorizationCode"] = codeStr
        }
        response["user"] = credential.user
        if let email = credential.email { response["email"] = email }
        if let fn = credential.fullName {
            response["givenName"] = fn.givenName ?? ""
            response["familyName"] = fn.familyName ?? ""
        }

        call.resolve(["response": response])
        bridge?.releaseCall(withID: callId)
        authCallId = nil
    }

    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithError error: Error) {
        guard let callId = authCallId,
              let call = bridge?.savedCall(withID: callId) else { return }

        let err = error as NSError
        // Code 1001 = user cancelled
        call.reject(error.localizedDescription, "\(err.code)", error)
        bridge?.releaseCall(withID: callId)
        authCallId = nil
    }
}

extension SignInWithApplePlugin: ASAuthorizationControllerPresentationContextProviding {
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.webView?.window ?? UIWindow()
    }
}
