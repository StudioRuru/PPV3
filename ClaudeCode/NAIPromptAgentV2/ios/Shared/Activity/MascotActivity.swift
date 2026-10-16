import ActivityKit
import Foundation

/// Miyabi in the Dynamic Island. Compiled into the app and the widget extension — keep it free of app-only APIs.
struct MascotAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var tab: String
        var tabLabel: String
        var expression: String
        var hidden: Bool
        /// Bumped whenever `AppGroup.moodImageURL` is rewritten, so the widget re-reads the file.
        var imageVersion: Int
    }
}

enum AppGroup {
    static let id = "group.com.philly95.naistudio"
    static var container: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) }
    /// The current bust, PNG ≤ 120 px on the long edge. Written by the app only.
    static var moodImageURL: URL? { container?.appendingPathComponent("mood.png") }
}

enum Mascot {
    static let validTabs: Set = ["studio", "roll", "closet", "chat", "rp"]
    static let validActions: Set = ["summon", "hide"]
    static let expressions: Set = ["smug", "laughing", "wink", "pout", "flirty", "shocked", "annoyed", "excited", "sleepy"]
}

/// Island button taps waiting for the page: survives a suspended or killed app; the app drains it oldest first.
enum IntentQueue {
    static let note = Notification.Name("com.philly95.naistudio.mascotIntent")
    private static let key = "mascotIntents"
    private static let lock = NSLock()
    private static var defaults: UserDefaults? { UserDefaults(suiteName: AppGroup.id) }

    // ponytail: in-process lock only; LiveActivityIntents run in the app's process, so no cross-process writer exists.
    static func push(_ action: String) {
        guard Mascot.validActions.contains(action) else { return }
        lock.lock(); defer { lock.unlock() }
        defaults?.set((defaults?.stringArray(forKey: key) ?? []) + [action], forKey: key)
    }

    /// Everything waiting, oldest first; stays queued until `remove(first:)` after the page has it.
    static func peek() -> [String] {
        lock.lock(); defer { lock.unlock() }
        return defaults?.stringArray(forKey: key) ?? []
    }

    /// Drop the delivered prefix (push only appends, so the first n are what `peek` returned).
    static func remove(first n: Int) {
        guard n > 0 else { return }
        lock.lock(); defer { lock.unlock() }
        defaults?.set(Array((defaults?.stringArray(forKey: key) ?? []).dropFirst(n)), forKey: key)
    }
}
