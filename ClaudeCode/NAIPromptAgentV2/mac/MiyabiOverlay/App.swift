import AppKit

@main
@MainActor final class AppDelegate: NSObject, NSApplicationDelegate, MenuHost {
    static func main() {
        let app = NSApplication.shared
        let d = AppDelegate()
        app.delegate = d
        app.setActivationPolicy(.accessory)
        app.run()
    }

    private let defaults = UserDefaults.standard
    private let client = LibraryClient(cookies: KeychainCookieStore())
    private let player = ClipPlayer()
    private let bubble = Bubble()
    private let activity = Activity()
    private var window: OverlayWindow!
    private var menu: MenuBar!
    private var behaviour: Behaviour?
    private var lib: Library?
    private var bstate: String?
    private var sharing = false

    var baseURL: String { defaults.string(forKey: "baseURL") ?? "" }
    var shown: Bool { get { !defaults.bool(forKey: "hidden") } set { defaults.set(!newValue, forKey: "hidden"); refreshVisibility() } }
    var boldness: String { get { defaults.string(forKey: "boldness") ?? "tame" } set { defaults.set(newValue, forKey: "boldness") } }
    var muted: Bool { get { defaults.bool(forKey: "muted") } set { defaults.set(newValue, forKey: "muted"); if newValue { bubble.dismiss() } } }
    var outfit: String { get { defaults.string(forKey: "outfit") ?? "day" } set { defaults.set(newValue, forKey: "outfit"); startPlayer() } }
    var outfits: [String] { lib?.outfits ?? [outfit] }

    func applicationDidFinishLaunching(_ n: Notification) {
        behaviour = try? Behaviour(bundle: .main)
        window = OverlayWindow(layer: player.layer)
        window.alphaSource = { [player] in player.current }
        window.onPoke = { [weak self] in self?.send("poke") }
        window.onDragStart = { [weak self] in self?.send("dragStart") }
        window.onDrop = { [weak self] in self?.send("drop") }
        menu = MenuBar(host: self)
        activity.onEvent = { [weak self] in self?.send($0) }
        activity.onShared = { [weak self] in self?.sharing = $0; self?.refreshVisibility() }
        activity.start()
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.send("tick") } }
        refreshVisibility()
        syncNow()
    }

    private func refreshVisibility() {
        if shown && !sharing && lib != nil { window.orderFrontRegardless() } else { window.orderOut(nil); bubble.dismiss() }
    }

    func configureServer(url: String, password: String) {
        defaults.set(url, forKey: "baseURL")
        Task {
            if let u = URL(string: url), !password.isEmpty { try? await client.login(base: u, password: password) }
            syncNow()
        }
    }

    func syncNow() {
        guard let base = URL(string: baseURL), base.host != nil else { menu.server(); return }
        Task {
            do { lib = try await client.sync(base: base); startPlayer() }
            catch LibraryError.needsLogin { menu.server() }
            catch { NSLog("MiyabiOverlay: sync failed: \(error)") }
        }
    }

    /// Starts on stand if the outfit has a stage idle for it, else any stage idle.
    private func startPlayer() {
        guard let lib else { return }
        if !lib.outfits.contains(outfit), let o = lib.outfits.first { defaults.set(o, forKey: "outfit") }
        let idles = lib.clips.filter { $0.surface == "stage" && $0.outfit == outfit && $0.from == $0.to }
        guard let start = (idles.first { $0.from == "stand" } ?? idles.first)?.from, let behaviour else { return }
        bstate = try? behaviour.initialState(pose: start, now: Date().timeIntervalSince1970 * 1000)
        player.load(lib: lib, outfit: outfit, client: client, start: start)
        refreshVisibility()
    }

    private func send(_ event: String) {
        guard let behaviour, let lib, let s = bstate else { return }
        guard let r = try? behaviour.step(state: s, event: event, lib: lib, outfit: outfit, boldness: boldness, now: Date().timeIntervalSince1970 * 1000) else { return }
        bstate = r.state
        guard let act = r.act else { return }
        player.request(act.pose)
        if let q = act.quip { say(q) }
    }

    private func say(_ quip: String) {
        guard !muted, shown, !sharing, let base = URL(string: baseURL), Double.random(in: 0..<1) < (quip == "poke" ? 1 : 0.4) else { return }
        let kind = quip == "ignored" ? "idle" : quip == "finally" ? "greet" : "tap"
        Task {
            guard let q = try? await client.quip(base: base, kind: kind, now: Date().timeIntervalSince1970 * 1000), !q.text.isEmpty, !muted else { return }
            bubble.show(q.text, above: window)
        }
    }
}
