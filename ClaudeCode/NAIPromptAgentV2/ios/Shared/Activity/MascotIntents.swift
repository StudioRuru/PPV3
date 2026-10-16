import AppIntents
import Foundation

/// Island buttons. They queue the action for the page; the app delivers it at once if it's running, else on next launch/foreground.
struct SummonMiyabiIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Summon Miyabi"
    func perform() async throws -> some IntentResult { queueMascot("summon"); return .result() }
}

struct HideMiyabiIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Hide Miyabi"
    func perform() async throws -> some IntentResult { queueMascot("hide"); return .result() }
}

private func queueMascot(_ action: String) {
    IntentQueue.push(action)
    NotificationCenter.default.post(name: IntentQueue.note, object: nil)
}
