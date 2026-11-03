import ARKit
import AVFoundation
import Capacitor
import RealityKit
import UIKit
import WebKit

@objc(InteriorARPlugin)
final class InteriorARPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "InteriorARPlugin"
    let jsName = "InteriorAR"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateScene", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "select", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise)
    ]

    // All session and view mutations run on the main queue. The token also
    // distinguishes a cancelled permission request from a later session.
    private var sessionID: String?
    private var sessionToken: UUID?
    private var pendingStart: CAPPluginCall?
    private var permissionRequestInFlight = false
    private var retiredSessionIDs: [String] = []
    private var renderer: InteriorARRenderer?
    private var arView: ARView?
    private var appearance: InteriorARWebViewAppearance?

    override func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(applicationDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification, object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(sceneDidEnterBackground(_:)),
            name: UIScene.didEnterBackgroundNotification, object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        let endingRenderer = renderer
        let endingView = arView
        let savedAppearance = appearance
        let startingCall = pendingStart
        // Do not capture self during teardown. UIKit cleanup is still required
        // if the bridge releases its plugin from a background queue.
        let cleanup = {
            startingCall?.reject("The AR session was closed.", "SESSION_ENDED")
            endingRenderer?.stop()
            endingView?.removeFromSuperview()
            savedAppearance?.restore()
        }
        if Thread.isMainThread {
            cleanup()
        } else {
            DispatchQueue.main.async(execute: cleanup)
        }
    }

    @objc func getCapabilities(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let supported = ARWorldTrackingConfiguration.isSupported
            let permission = AVCaptureDevice.authorizationStatus(for: .video)
            var result: [String: Any] = [
                "supported": supported,
                "cameraPermission": Self.cameraPermissionName(permission)
            ]
            if !supported {
                result["reason"] = "This device does not support AR world tracking."
            } else if permission == .denied {
                result["reason"] = "Allow Camera access for WorldOS in Settings to use AR."
            } else if permission == .restricted {
                result["reason"] = "Camera access is restricted on this device."
            }
            // Capability checks never request access or create an AR session.
            call.resolve(result)
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.reject("The AR bridge is unavailable.", "UNAVAILABLE")
                return
            }
            guard let requestedID = self.validSessionID(call) else { return }
            guard !self.retiredSessionIDs.contains(requestedID) else {
                call.reject("This AR session has already ended.", "SESSION_ENDED")
                return
            }
            guard self.sessionID == nil, !self.permissionRequestInFlight else {
                call.reject("An AR session is already starting or running.", "BUSY")
                return
            }
            guard ARWorldTrackingConfiguration.isSupported else {
                call.reject("This device does not support AR world tracking.", "UNSUPPORTED")
                return
            }
            guard UIApplication.shared.applicationState != .background else {
                call.reject("Open WorldOS before starting AR.", "BACKGROUND")
                return
            }

            let token = UUID()
            self.sessionID = requestedID
            self.sessionToken = token
            self.pendingStart = call
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                self.beginSession(requestedID, token: token)
            case .notDetermined:
                self.permissionRequestInFlight = true
                // This is reached only by the explicit start action in the UI.
                AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                    DispatchQueue.main.async { [weak self] in
                        guard let self = self else { return }
                        self.permissionRequestInFlight = false
                        guard self.sessionID == requestedID, self.sessionToken == token else { return }
                        if granted {
                            self.beginSession(requestedID, token: token)
                        } else {
                            self.finishSession(
                                message: "Allow Camera access for WorldOS in Settings to use AR.",
                                pendingErrorCode: "CAMERA_PERMISSION_DENIED"
                            )
                        }
                    }
                }
            case .denied:
                self.finishSession(
                    message: "Allow Camera access for WorldOS in Settings to use AR.",
                    pendingErrorCode: "CAMERA_PERMISSION_DENIED"
                )
            case .restricted:
                self.finishSession(
                    message: "Camera access is restricted on this device.",
                    pendingErrorCode: "CAMERA_PERMISSION_RESTRICTED"
                )
            @unknown default:
                self.finishSession(message: "Camera access is unavailable.", pendingErrorCode: "UNAVAILABLE")
            }
        }
    }

    @objc func updateScene(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.reject("The AR bridge is unavailable.", "UNAVAILABLE")
                return
            }
            guard let requestedID = self.validSessionID(call),
                  let renderer = self.activeRenderer(for: requestedID, call: call) else { return }
            guard let payload = call.options as? [String: Any] else {
                call.reject("The AR scene is invalid.", "INVALID_SCENE")
                return
            }
            do {
                try renderer.updateScene(payload)
                call.resolve()
            } catch let error as InteriorARRenderer.RendererError {
                call.reject(error.localizedDescription, error.code, error)
            } catch {
                call.reject(error.localizedDescription, "AR_UPDATE_FAILED", error)
            }
        }
    }

    @objc func select(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.reject("The AR bridge is unavailable.", "UNAVAILABLE")
                return
            }
            guard let requestedID = self.validSessionID(call),
                  let renderer = self.activeRenderer(for: requestedID, call: call) else { return }
            guard let x = call.getDouble("x"), let y = call.getDouble("y"),
                  x.isFinite, y.isFinite, (0.0...1.0).contains(x), (0.0...1.0).contains(y) else {
                call.reject("Selection coordinates must be between zero and one.", "INVALID_COORDINATES")
                return
            }
            let selectedID = renderer.select(normalizedX: x, normalizedY: y)
            call.resolve(["id": selectedID.map { $0 as Any } ?? NSNull()])
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.resolve()
                return
            }
            guard let requestedID = self.validSessionID(call) else { return }
            if self.sessionID == requestedID {
                self.finishSession(message: "AR session ended.")
            } else {
                // Idempotent cleanup must never close a newer session. Remember
                // cancellation that arrives before its start has been handled.
                self.retireSession(requestedID)
            }
            call.resolve()
        }
    }

    override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        if navigationAction.targetFrame?.isMainFrame == true {
            finishSession(message: "AR session ended because the page changed.")
        }
        return nil
    }

    private func beginSession(_ requestedID: String, token: UUID) {
        guard sessionID == requestedID, sessionToken == token else { return }
        guard UIApplication.shared.applicationState != .background,
              let webView = bridge?.webView,
              let parent = webView.superview, webView.window != nil else {
            finishSession(message: "The app is not ready to display AR.", pendingErrorCode: "UNAVAILABLE")
            return
        }

        let savedAppearance = InteriorARWebViewAppearance(webView: webView, parent: parent)
        let cameraView = ARView(frame: webView.frame, cameraMode: .ar, automaticallyConfigureSession: false)
        cameraView.isUserInteractionEnabled = false
        cameraView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cameraView.translatesAutoresizingMaskIntoConstraints = false
        appearance = savedAppearance
        arView = cameraView
        parent.insertSubview(cameraView, belowSubview: webView)
        NSLayoutConstraint.activate([
            cameraView.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
            cameraView.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
            cameraView.topAnchor.constraint(equalTo: webView.topAnchor),
            cameraView.bottomAnchor.constraint(equalTo: webView.bottomAnchor)
        ])
        savedAppearance.makeTransparent()
        parent.layoutIfNeeded()

        let newRenderer = InteriorARRenderer(view: cameraView) { [weak self] state in
            guard let self = self, self.sessionID == requestedID, self.sessionToken == token else { return }
            if state["phase"] as? String == "ended" {
                self.finishSession(
                    message: state["message"] as? String ?? "AR session ended.",
                    pendingErrorCode: "SESSION_ENDED",
                    rendererState: state
                )
            } else {
                self.sendState(state, sessionID: requestedID)
            }
        }
        renderer = newRenderer
        newRenderer.start()
        guard sessionID == requestedID, sessionToken == token else { return }
        let startingCall = pendingStart
        pendingStart = nil
        startingCall?.resolve()
    }

    private func activeRenderer(for requestedID: String, call: CAPPluginCall) -> InteriorARRenderer? {
        guard sessionID == requestedID, let renderer = renderer else {
            call.reject("This AR session is no longer active.", "SESSION_ENDED")
            return nil
        }
        return renderer
    }

    private func validSessionID(_ call: CAPPluginCall) -> String? {
        guard let value = call.getString("sessionId"), !value.isEmpty, value.count <= 128 else {
            call.reject("A valid AR session identifier is required.", "INVALID_SESSION")
            return nil
        }
        return value
    }

    private func retireSession(_ value: String) {
        if !retiredSessionIDs.contains(value) { retiredSessionIDs.append(value) }
        if retiredSessionIDs.count > 128 { retiredSessionIDs.removeFirst(retiredSessionIDs.count - 128) }
    }

    private func finishSession(
        message: String,
        pendingErrorCode: String = "SESSION_ENDED",
        rendererState: [String: Any] = [:]
    ) {
        guard let endingID = sessionID else { return }
        // Invalidate before stopping: late permission and renderer callbacks
        // cannot recreate the camera or publish state for the next session.
        sessionID = nil
        sessionToken = nil
        retireSession(endingID)
        let startingCall = pendingStart
        pendingStart = nil
        let endingRenderer = renderer
        renderer = nil
        endingRenderer?.stop()
        arView?.removeFromSuperview()
        arView = nil
        appearance?.restore()
        appearance = nil
        startingCall?.reject(message, pendingErrorCode)
        var state = rendererState
        state["phase"] = "ended"
        state["canSelect"] = false
        state["message"] = message
        sendState(state, sessionID: endingID)
    }

    private func sendState(_ state: [String: Any], sessionID: String) {
        var payload = state
        payload["sessionId"] = sessionID
        notifyListeners("state", data: payload)
    }

    @objc private func applicationDidEnterBackground() {
        finishSession(message: "AR ended when WorldOS moved to the background. Start AR again to continue.")
    }

    @objc private func sceneDidEnterBackground(_ notification: Notification) {
        if let scene = notification.object as? UIScene,
           let activeScene = bridge?.webView?.window?.windowScene, scene !== activeScene { return }
        applicationDidEnterBackground()
    }

    private static func cameraPermissionName(_ status: AVAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .notDetermined: return "prompt"
        case .denied: return "denied"
        case .restricted: return "restricted"
        @unknown default: return "restricted"
        }
    }
}

// Capture the actual values, including nil and opacity, instead of guessing
// the app's normal colors when the AR camera is removed.
private final class InteriorARWebViewAppearance {
    private let webView: WKWebView
    private let parent: UIView
    private let webBackground: UIColor?
    private let webOpaque: Bool
    private let scrollBackground: UIColor?
    private let scrollOpaque: Bool
    private let parentBackground: UIColor?
    private let parentOpaque: Bool
    private let underPageBackground: UIColor

    init(webView: WKWebView, parent: UIView) {
        self.webView = webView
        self.parent = parent
        webBackground = webView.backgroundColor
        webOpaque = webView.isOpaque
        scrollBackground = webView.scrollView.backgroundColor
        scrollOpaque = webView.scrollView.isOpaque
        parentBackground = parent.backgroundColor
        parentOpaque = parent.isOpaque
        underPageBackground = webView.underPageBackgroundColor
    }

    func makeTransparent() {
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isOpaque = false
        webView.scrollView.backgroundColor = .clear
        webView.underPageBackgroundColor = .clear
        parent.isOpaque = false
        parent.backgroundColor = .clear
    }

    func restore() {
        webView.backgroundColor = webBackground
        webView.isOpaque = webOpaque
        webView.scrollView.backgroundColor = scrollBackground
        webView.scrollView.isOpaque = scrollOpaque
        webView.underPageBackgroundColor = underPageBackground
        parent.backgroundColor = parentBackground
        parent.isOpaque = parentOpaque
    }
}
