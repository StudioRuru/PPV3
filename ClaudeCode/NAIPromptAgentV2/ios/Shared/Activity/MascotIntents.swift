import ActivityKit
import AppIntents
import Foundation

/// Island buttons. They queue the action for the page; the app delivers it at once if it's running, else on next launch/foreground.
struct SummonMiyabiIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Summon Miyabi"
    func perform() async throws -> some IntentResult { await queueMascot("summon"); return .result() }
}

struct HideMiyabiIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Hide Miyabi"
    func perform() async throws -> some IntentResult { await queueMascot("hide"); return .result() }
}

/// Also flips the island's own `hidden` now: the page may be suspended and only report back later (it will carry the same value).
private func queueMascot(_ action: String) async {
    IntentQueue.push(action)
    NotificationCenter.default.post(name: IntentQueue.note, object: nil, userInfo: ["mascot": action])
    for a in Activity<MascotAttributes>.activities {
        var s = a.content.state
        s.hidden = action == "hide"
        await a.update(ActivityContent(state: s, staleDate: nil))
    }
}
