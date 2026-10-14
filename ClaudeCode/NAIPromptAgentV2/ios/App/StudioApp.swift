import Photos
import SwiftUI
import WebKit

let studioNavy = UIColor(red: 13 / 255, green: 16 / 255, blue: 32 / 255, alpha: 1)

@main
struct StudioApp: App {
    @Environment(\.scenePhase) private var phase
    private let host = WebHost()

    init() {
        // Settings.bundle defaults only exist once the user opens Settings; register them so first launch works.
        UserDefaults.standard.register(defaults: ["serverURL": "https://big-mac-mini.tail57826e.ts.net:8443"])
    }

    var body: some Scene {
        WindowGroup {
            StudioView(host: host)
                .ignoresSafeArea()
                .background(Color(studioNavy))
                .onOpenURL { _ in host.importPending() }   // naistudio://import from the share extension
        }
        .onChange(of: phase) { _, p in if p == .active { host.reloadIfServerChanged(); host.importPending() } }
    }
}

struct StudioView: UIViewRepresentable {
    let host: WebHost
    func makeUIView(context: Context) -> WKWebView { host.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Owns the one WKWebView hosting the web Studio and the native side of its bridge.
final class WebHost: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    private var loadedServer = ""
    private var importing = false

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()   // persistent: the login cookie survives relaunches
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        config.userContentController.add(self, name: "studio")
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = studioNavy
        webView.scrollView.backgroundColor = studioNavy
        webView.scrollView.contentInsetAdjustmentBehavior = .never   // the page handles safe areas itself
        load()
    }

    private var server: String { UserDefaults.standard.string(forKey: "serverURL")?.trimmingCharacters(in: .whitespaces) ?? "" }

    func load() {
        loadedServer = server
        guard let url = URL(string: server), url.scheme?.hasPrefix("http") == true else { return showError("The server URL in Settings → Studio isn't valid.") }
        webView.load(URLRequest(url: url))
    }

    func reloadIfServerChanged() { if server != loadedServer { load() } }

    private func showError(_ message: String) {
        let esc = message.replacingOccurrences(of: "<", with: "&lt;")
        webView.loadHTMLString("""
        <meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1020;color:#e9ecf8;font:16px -apple-system">
        <div style="padding:24px;text-align:center"><p>\(esc)</p><p style="color:#aab2d0;font-size:14px">Is the Mac awake and on Tailscale?</p>
        <a href="naistudio-retry://" style="display:inline-block;margin-top:12px;padding:12px 24px;border-radius:12px;background:#b7a4ff;color:#1a1240;text-decoration:none;font-weight:600">Retry</a></div></body>
        """, baseURL: nil)
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.request.url?.scheme == "naistudio-retry" { decisionHandler(.cancel); load(); return }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showError("Can't reach the Studio at \(server).")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { importPending() }

    // MARK: Bridge

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let path = body["save"] as? String,
              let url = URL(string: path, relativeTo: webView.url) else { return }
        Task { await save(url.absoluteURL) }
    }

    /// Full PNG (with its NovelAI metadata) → Photos, add-only permission.
    @MainActor private func save(_ url: URL) async {
        do {
            let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
            var req = URLRequest(url: url)
            HTTPCookie.requestHeaderFields(with: cookies.filter { url.host?.hasSuffix($0.domain.trimmingCharacters(in: ["."])) == true })
                .forEach { req.setValue($1, forHTTPHeaderField: $0) }
            let (data, res) = try await URLSession.shared.data(for: req)
            guard (res as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            guard await PHPhotoLibrary.requestAuthorization(for: .addOnly) == .authorized else { return toast("Allow Photos access in Settings → Studio.") }
            try await PHPhotoLibrary.shared().performChanges {
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            toast("Saved to Photos")
        } catch {
            toast("Couldn't save: \(error.localizedDescription)")
        }
    }

    private func toast(_ msg: String) {
        webView.callAsyncJavaScript("window.studioToast?.(m)", arguments: ["m": msg], in: nil, in: .page)
    }

    /// Feed shared images to the page's Tagger. A file is deleted only after the page accepted it,
    /// so a share made while logged out (no studioImport yet) waits for the next foreground.
    func importPending() {
        guard !importing, let file = Inbox.pending().first, let data = try? Data(contentsOf: file) else { return }
        importing = true
        let mime = file.pathExtension == "png" ? "image/png" : "image/jpeg"
        let js = """
        for (let i = 0; i < 50 && !window.studioImport; i++) await new Promise(r => setTimeout(r, 100));
        if (!window.studioImport) return false;
        await window.studioImport(u, n);
        return true;
        """
        webView.callAsyncJavaScript(js, arguments: ["u": "data:\(mime);base64,\(data.base64EncodedString())", "n": file.lastPathComponent], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            self.importing = false
            if case .success(let ok) = result, ok as? Bool == true {
                try? FileManager.default.removeItem(at: file)
            }
        }
    }
}
