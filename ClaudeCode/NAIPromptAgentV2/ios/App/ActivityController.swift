import ActivityKit
import UIKit

/// Keeps the one Miyabi Live Activity in step with the page's `{activity: …}` messages.
/// Requests only while the app is active (iOS refuses otherwise); updates any time; ends when the page says `on: false`.
@MainActor final class ActivityController {
    static let shared = ActivityController()
    private var state: MascotAttributes.ContentState?
    private var on = false
    private var bust: URL?
    private var imageVersion = 0
    private var last: Task<Void, Never>?   // ActivityKit calls run one at a time, in order

    /// Island Hide/Summon flip the card at once (MascotIntents); mirror it here so a later reconcile doesn't flip it back before the page reports.
    private init() {
        NotificationCenter.default.addObserver(forName: IntentQueue.note, object: nil, queue: .main) { [weak self] n in
            guard let m = n.userInfo?["mascot"] as? String else { return }
            MainActor.assumeIsolated { self?.state?.hidden = m == "hide" }
        }
    }

    struct Update { let tab, tabLabel, expression: String; let hidden, on: Bool; let bust: URL? }

    /// Untrusted page input → Update, or nil to drop the message. `resolve` turns the bust path into a same-origin URL or nil.
    nonisolated static func parse(_ a: [String: Any], resolve: (String) -> URL?) -> Update? {
        guard let tab = a["tab"] as? String, Mascot.validTabs.contains(tab),
              let label = a["tabLabel"] as? String, label.count <= 24,
              let hidden = a["hidden"] as? Bool, let on = a["on"] as? Bool else { return nil }
        let expression = (a["expression"] as? String).flatMap { Mascot.expressions.contains($0) ? $0 : nil } ?? "smug"
        var bust: URL?
        switch a["bust"] {
        case nil, is NSNull: bust = nil
        case let p as String:
            guard p.count <= 300, p.hasPrefix("/api/mascot/sprites/"), !p.contains(".."), let u = resolve(p) else { return nil }
            bust = u
        default: return nil
        }
        return Update(tab: tab, tabLabel: label, expression: expression, hidden: hidden, on: on, bust: bust)
    }

    func apply(_ u: Update) {
        on = u.on
        state = .init(tab: u.tab, tabLabel: u.tabLabel, expression: u.expression, hidden: u.hidden, imageVersion: imageVersion)
        // bust nil (hidden) keeps the last image; the widget dims it via `hidden`.
        if let url = u.bust, url != bust { bust = url; Task { await fetchImage(url) } }
        sync()
    }

    /// Queue a reconcile behind the previous one. Each reads the latest state when it runs, so an `end`
    /// followed by `on: true` re-requests (if active), and an older state can never land after a newer one.
    func sync() {
        let prev = last
        last = Task { await prev?.value; await reconcile() }
    }

    /// Request (foreground only), update, or end, to match the latest state. Keeps at most one activity.
    private func reconcile() async {
        guard let state else { return }   // no word from the page yet (cold launch): leave any running activity alone
        guard on else {
            for a in Activity<MascotAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        for dead in Activity<MascotAttributes>.activities where dead.activityState == .ended || dead.activityState == .dismissed {
            await dead.end(nil, dismissalPolicy: .immediate)   // an 8 h-expired card lingers on the Lock Screen until dismissed
        }
        let live = Activity<MascotAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
        for extra in live.dropFirst() { await extra.end(nil, dismissalPolicy: .immediate) }
        let content = ActivityContent(state: state, staleDate: nil)
        if let a = live.first {
            await a.update(content)
        } else if UIApplication.shared.applicationState == .active {
            _ = try? Activity.request(attributes: MascotAttributes(), content: content, pushType: nil)
        }
    }

    private func fetchImage(_ url: URL) async {
        let req = await WebHost.shared.cookieRequest(url)
        let res = try? await URLSession.shared.data(for: req)
        let png: Data? = if case let (data, r)? = res, (r as? HTTPURLResponse)?.statusCode == 200 {
            await Task.detached { Self.thumbnail(data) }.value
        } else { nil }
        guard url == bust else { return }   // a newer bust arrived meanwhile; its own fetch wins
        // A ≤120 px PNG is a few KB, so this write on main is negligible.
        guard let png, let dest = AppGroup.moodImageURL, (try? png.write(to: dest, options: .atomic)) != nil else {
            bust = nil   // let the next message retry
            return
        }
        imageVersion += 1
        state?.imageVersion = imageVersion
        sync()
    }

    /// Downscale to ≤ 120 px on the long edge (widget memory limits), keeping alpha.
    nonisolated static func thumbnail(_ data: Data) -> Data? {
        guard let img = UIImage(data: data), img.size.width > 0, img.size.height > 0 else { return nil }
        let k = min(1, 120 / max(img.size.width * img.scale, img.size.height * img.scale))
        let size = CGSize(width: (img.size.width * img.scale * k).rounded(), height: (img.size.height * img.scale * k).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).pngData { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
    }
}
