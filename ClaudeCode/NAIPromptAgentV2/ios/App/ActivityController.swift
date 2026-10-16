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

    /// Request (foreground only), update, or end, to match the latest state.
    func sync() {
        let running = Activity<MascotAttributes>.activities
        guard let state else { return }   // no word from the page yet (cold launch): leave any running activity alone
        guard on else { return running.forEach { a in Task { await a.end(nil, dismissalPolicy: .immediate) } } }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let content = ActivityContent(state: state, staleDate: nil)
        if let a = running.first(where: { $0.activityState == .active || $0.activityState == .stale }) {
            Task { await a.update(content) }
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
