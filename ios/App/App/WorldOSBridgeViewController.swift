import UIKit
import Capacitor

final class WorldOSBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        // Capacitor normally makes WKWebView the root view. An app-owned
        // container gives the AR camera a sibling beneath the web interface.
        if let webView = webView {
            let container = UIView(frame: webView.frame)
            container.backgroundColor = webView.backgroundColor
            view = container
            webView.frame = container.bounds
            webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            container.addSubview(webView)
        }

        bridge?.registerPluginInstance(InteriorARPlugin())
    }
}
