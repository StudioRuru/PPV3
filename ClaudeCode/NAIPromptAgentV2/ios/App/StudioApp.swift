import Photos
import UIKit
import WebKit

let studioNavy = UIColor(red: 13 / 255, green: 16 / 255, blue: 32 / 255, alpha: 1)

// Plain UIKit lifecycle: hosting WKWebView under SwiftUI crashed on iOS 27.2 beta the moment the
// password field took focus (UIGestureRecognizer _delayTouchesForEvent inserting nil, no app frames).
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Settings.bundle defaults only exist once the user opens Settings; register them so first launch works.
        UserDefaults.standard.register(defaults: ["serverURL": "https://big-mac-mini.tail57826e.ts.net:8443"])
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: nil, sessionRole: session.role)
        c.delegateClass = SceneDelegate.self
        return c
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        w.rootViewController = StudioViewController()
        w.backgroundColor = studioNavy
        w.makeKeyAndVisible()
        window = w
        open(options.urlContexts)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) { open(URLContexts) }
    func sceneDidBecomeActive(_ scene: UIScene) { WebHost.shared.becameActive() }

    /// naistudio://tab/<tab> from the island → switch tab (queued until the page is up).
    /// Anything else (naistudio://import from the share extension) imports; didFinish also imports, so a cold launch is covered.
    private func open(_ contexts: Set<UIOpenURLContext>) {
        for url in contexts.map(\.url) where url.scheme == "naistudio" {
            if url.host == "tab" {
                let p = url.pathComponents.filter { $0 != "/" }
                if p.count == 1, Mascot.validTabs.contains(p[0]) { WebHost.shared.sendIntent(["tab": p[0]]) }
            } else { WebHost.shared.importPending() }
        }
    }
}

final class StudioViewController: UIViewController, UITabBarDelegate {
    /// Mirrors studio/src/lib/tabs.ts. ponytail: duplicated list; a new web tab needs a row here too.
    static let tabs: [(id: String, title: String, symbol: String)] = [
        ("studio", "Studio", "paintbrush.pointed"), ("comfy", "Comfy", "point.3.connected.trianglepath.dotted"),
        ("roll", "Roll", "camera"), ("closet", "Closet", "hanger"),
        ("chat", "Chat", "bubble.left"), ("rp", "RP", "theatermasks"),
    ]
    private let bar = UITabBar()
    private var webHidden = false, keyboardUp = false

    /// The web view ends at the keyboard's top, so the page shrinks instead of WebKit scrolling it (sticky headers stay put).
    /// The glass tab bar floats over the page's bottom edge; the page pads itself by --tabbar-h.
    override func loadView() {
        view = UIView()
        let web = WebHost.shared.webView
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        view.keyboardLayoutGuide.usesBottomSafeArea = false
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.delegate = self
        bar.items = Self.tabs.enumerated().map { UITabBarItem(title: $1.title, image: UIImage(systemName: $1.symbol), tag: $0) }
        bar.selectedItem = bar.items?.first
        view.addSubview(bar)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        WebHost.shared.onTabbar = { [weak self] hidden, tab in self?.apply(hidden: hidden, tab: tab) }
        // Like Messages: the bar steps aside while typing.
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.keyboardUp = true; self?.sync() }
        }
        nc.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.keyboardUp = false; self?.sync() }
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        publishHeight()
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        UISelectionFeedbackGenerator().selectionChanged()
        WebHost.shared.sendIntent(["tab": Self.tabs[item.tag].id])
    }

    /// Web → bar: selection follows the page (no delegate call, so no intent echo); hidden inside an open RP chat.
    private func apply(hidden: Bool, tab: String) {
        if let i = Self.tabs.firstIndex(where: { $0.id == tab }) { bar.selectedItem = bar.items?[i] }
        webHidden = hidden
        sync()
    }

    private func sync() {
        let hide = webHidden || keyboardUp
        guard hide != bar.isHidden || bar.alpha != (hide ? 0 : 1) else { return }
        if !hide { bar.isHidden = false }
        UIView.animate(withDuration: 0.25, animations: { self.bar.alpha = hide ? 0 : 1 }) { _ in
            if hide == (self.webHidden || self.keyboardUp) { self.bar.isHidden = hide }
        }
        publishHeight()
    }

    /// --tabbar-h on <html>: the bar's height (incl. home-indicator inset) while shown, else 0.
    private func publishHeight() {
        let h = (webHidden || keyboardUp) ? 0 : bar.frame.height
        WebHost.shared.webView.callAsyncJavaScript("document.documentElement.style.setProperty('--tabbar-h', h + 'px')", arguments: ["h": h], in: nil, in: .page)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { WebHost.shared.lightTheme ? .darkContent : .lightContent }
}

/// Owns the one WKWebView hosting the web Studio and the native side of its bridge.
final class WebHost: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKDownloadDelegate {
    static let shared = WebHost()
    let webView: WKWebView
    private(set) var lightTheme = false
    private var loadedServer = ""
    private var importing = false
    private var showingError = false
    private var outbox: [[String: String]] = []   // tab intents from URLs, oldest first (island taps wait in IntentQueue)
    private var delivering = false
    var onTabbar: ((Bool, String) -> Void)?

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
        NotificationCenter.default.addObserver(forName: IntentQueue.note, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.deliverIntents() }
        }
        load()
    }

    private var server: String { UserDefaults.standard.string(forKey: "serverURL")?.trimmingCharacters(in: .whitespaces) ?? "" }

    func load() {
        loadedServer = server
        showingError = false
        guard let url = URL(string: server), url.scheme?.hasPrefix("http") == true else { return showError("The server URL in Settings → Studio isn't valid.") }
        webView.load(URLRequest(url: url))
    }

    /// Foreground: reload if the URL changed or the last load failed (Mac was asleep), else pick up a waiting share.
    func becameActive() {
        if server != loadedServer || showingError { load() } else { importPending(); deliverIntents() }
        ActivityController.shared.sync()
    }

    private var origin: URL? { URL(string: server) }
    private func sameOrigin(_ u: URL?) -> Bool {
        guard let u, let o = origin else { return false }
        return u.scheme == o.scheme && u.host == o.host && u.port == o.port
    }

    private func showError(_ message: String) {
        showingError = true
        let esc = message.replacingOccurrences(of: "<", with: "&lt;")
        webView.loadHTMLString("""
        <meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1020;color:#e9ecf8;font:16px -apple-system">
        <div style="padding:24px;text-align:center"><p>\(esc)</p><p style="color:#aab2d0;font-size:14px">Is the Mac awake and on Tailscale?</p>
        <a href="naistudio-retry://" style="display:inline-block;margin-top:12px;padding:12px 24px;border-radius:12px;background:#b7a4ff;color:#1a1240;text-decoration:none;font-weight:600">Retry</a></div></body>
        """, baseURL: nil)
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == "naistudio-retry" { decisionHandler(.cancel); load(); return }
        if action.shouldPerformDownload, sameOrigin(url) { return decisionHandler(.download) }   // <a download> (zip export)
        // The Studio's own pages (and the local error page) stay here; anything else opens in Safari.
        if sameOrigin(url) || url.scheme == "about" || !action.targetFrame.map({ $0.isMainFrame }).defaultTrue { return decisionHandler(.allow) }
        decisionHandler(.cancel)
        UIApplication.shared.open(url)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        // -999: superseded by another load; 102: our own cancel of naistudio-retry:// — neither means the Mac is unreachable.
        if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { return }
        showError("Can't reach the Studio at \(server).")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        importPending(); deliverIntents()
        webView.window?.rootViewController?.view.setNeedsLayout()   // a fresh page needs --tabbar-h again
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { load() }

    // MARK: Downloads (zip export) → share sheet, so it can go to Files, AirDrop, etc.

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        decisionHandler(disposition.lowercased().hasPrefix("attachment") ? .download : .allow)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    private var downloadURL: URL?

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(suggestedFilename.isEmpty ? "nai-studio.zip" : suggestedFilename)
        try? FileManager.default.removeItem(at: url)
        downloadURL = url
        toast("Preparing zip…")
        completionHandler(url)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloadURL, var top = webView.window?.rootViewController else { return }
        while let next = top.presentedViewController { top = next }   // present over whatever is already up
        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = webView   // iPad safety
        share.completionWithItemsHandler = { [weak self] _, _, _, _ in
            try? FileManager.default.removeItem(at: url)   // zips can be large; don't leave them in tmp
            if self?.downloadURL == url { self?.downloadURL = nil }
        }
        top.present(share, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        toast("Download failed: \(error.localizedDescription)")
    }

    // MARK: Bridge

    /// Web `postHaptic` → native tap. Unknown kinds are ignored.
    private func play(_ kind: String) {
        switch kind {
        case "light": UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
        case "selection": UISelectionFeedbackGenerator().selectionChanged()
        default: break
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // The page's theme script reports its theme: status-bar style + the colour behind bounces.
        if let theme = (message.body as? [String: Any])?["theme"] as? [String: Any], sameOrigin(message.frameInfo.request.url) {
            lightTheme = theme["light"] as? Bool ?? false
            if let hex = theme["bg"] as? String, let color = UIColor(hex: hex) {
                webView.backgroundColor = color; webView.scrollView.backgroundColor = color; webView.window?.backgroundColor = color
            }
            webView.window?.rootViewController?.setNeedsStatusBarAppearanceUpdate()
            return
        }
        if let a = (message.body as? [String: Any])?["activity"] as? [String: Any] {
            guard sameOrigin(message.frameInfo.request.url), let u = ActivityController.parse(a, resolve: { [webView] p in
                URL(string: p, relativeTo: webView.url).map(\.absoluteURL).flatMap { self.sameOrigin($0) ? $0 : nil }
            }) else { return }
            return ActivityController.shared.apply(u)
        }
        if let h = (message.body as? [String: Any])?["haptic"] as? String, sameOrigin(message.frameInfo.request.url) { return play(h) }
        if let t = (message.body as? [String: Any])?["tabbar"] as? [String: Any], sameOrigin(message.frameInfo.request.url),
           let hidden = t["hidden"] as? Bool, let tab = t["tab"] as? String, StudioViewController.tabs.contains(where: { $0.id == tab }) {
            onTabbar?(hidden, tab); return
        }
        guard let body = message.body as? [String: Any], let path = body["save"] as? String,
              let url = URL(string: path, relativeTo: webView.url)?.absoluteURL, sameOrigin(url), sameOrigin(message.frameInfo.request.url) else { return }
        Task { await save(url) }
    }

    /// Full PNG (with its NovelAI metadata) → Photos, add-only permission.
    @MainActor private func save(_ url: URL) async {
        do {
            let (data, res) = try await URLSession.shared.data(for: cookieRequest(url))
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

    /// A request carrying the web view's login cookies for `url` — callers must have checked it's same-origin.
    @MainActor func cookieRequest(_ url: URL) async -> URLRequest {
        let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        var req = URLRequest(url: url)
        let host = url.host ?? ""
        let matching = cookies.filter { c in
            let d = c.domain.trimmingCharacters(in: ["."])
            return (host == d || host.hasSuffix("." + d)) && (!c.isSecure || url.scheme == "https")
        }
        HTTPCookie.requestHeaderFields(with: matching)
            .forEach { req.setValue($1, forHTTPHeaderField: $0) }
        return req
    }

    private func toast(_ msg: String) {
        webView.callAsyncJavaScript("window.studioToast?.(m)", arguments: ["m": msg], in: nil, in: .page)
    }

    /// Feed shared images to the page's Tagger. A file is deleted only after the page accepted it,
    /// so a share made while logged out (no studioImport yet) waits for the next foreground.
    func importPending() {
        // While loading, didFinish will call us — importing into the outgoing page would lose the file.
        guard !importing, !webView.isLoading, !showingError, let file = Inbox.pending().first, let data = try? Data(contentsOf: file) else { return }
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

extension WebHost {
    func sendIntent(_ intent: [String: String]) {
        outbox.append(intent)
        deliverIntents()
    }

    /// Island taps (app-group IntentQueue) then URL intents → window.studioIntent, in order, as call arguments (never built JS).
    /// Taps leave the persisted queue only once the page has taken them, so a killed app or logged-out page keeps them
    /// for the next didFinish/foreground. Each call is wrapped in try/catch: one throwing can't make earlier ones replay.
    func deliverIntents() {
        guard !delivering, !webView.isLoading, !showingError else { return }
        let queued = IntentQueue.peek(), tabs = outbox
        let batch = queued.filter(Mascot.validActions.contains).map { ["mascot": $0] } + tabs
        if batch.isEmpty { IntentQueue.remove(first: queued.count); return }
        outbox = []
        delivering = true
        let js = """
        for (let i = 0; i < 50 && !window.studioIntent; i++) await new Promise(r => setTimeout(r, 100));
        if (!window.studioIntent) return false;
        for (const x of l) { try { window.studioIntent(x); } catch (e) { console.error(e); } }
        return true;
        """
        webView.callAsyncJavaScript(js, arguments: ["l": batch], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            self.delivering = false
            if case .success(let ok) = result, ok as? Bool == true {
                IntentQueue.remove(first: queued.count)
                if !self.outbox.isEmpty || !IntentQueue.peek().isEmpty { self.deliverIntents() }
            } else {
                self.outbox = tabs + self.outbox
            }
        }
    }
}

private extension Optional where Wrapped == Bool {
    var defaultTrue: Bool { self ?? true }
}

private extension UIColor {
    convenience init?(hex: String) {
        guard hex.count == 7, hex.hasPrefix("#"), let v = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(red: CGFloat(v >> 16 & 255) / 255, green: CGFloat(v >> 8 & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    }
}
