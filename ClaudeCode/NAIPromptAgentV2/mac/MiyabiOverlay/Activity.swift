import CoreGraphics
import Foundation

/// Polls session idle/typing time (no Input Monitoring permission needed) and the screen-share flag.
@MainActor final class Activity {
    var onEvent: (String) -> Void = { _ in }
    var onShared: (Bool) -> Void = { _ in }
    private var asleep = false, shared = false
    private var timers: [Timer] = []

    private static let anyEvent = CGEventType(rawValue: ~0)!

    func start() {
        timers = [
            Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.poll() } },
            Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.pollShare() } },
        ]
    }

    private func poll() {
        if CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .keyDown) < 1 { onEvent("typing") }
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: Self.anyEvent)
        if idle > 300, !asleep { asleep = true; onEvent("sysIdle") }
        else if idle < 300, asleep { asleep = false; onEvent("sysActive") }
    }

    private func pollShare() {
        let d = CGSessionCopyCurrentDictionary() as? [String: Any]
        let now = (d?["CGSSessionScreenIsShared"] as? Bool) ?? false
        if now != shared { shared = now; onShared(now) }
    }
}
