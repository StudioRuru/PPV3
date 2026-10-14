import Foundation

/// Hand-off folder in the shared app group: the share extension drops images here, the app imports them.
enum Inbox {
    static let group = "group.com.philly95.naistudio"

    static var dir: URL? {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
        let d = base.appendingPathComponent("inbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    static func pending() -> [URL] {
        guard let d = dir, let files = try? FileManager.default.contentsOfDirectory(at: d, includingPropertiesForKeys: [.creationDateKey]) else { return [] }
        return files.sorted { ($0.creationDate ?? .distantPast) < ($1.creationDate ?? .distantPast) }
    }

    /// The Tagger shows one image at a time, so a new share replaces anything still waiting.
    static func drop(_ data: Data, ext: String) throws {
        guard let d = dir else { throw CocoaError(.fileNoSuchFile) }
        pending().forEach { try? FileManager.default.removeItem(at: $0) }
        try data.write(to: d.appendingPathComponent("\(UUID().uuidString).\(ext)"), options: .atomic)
    }
}

private extension URL {
    var creationDate: Date? { (try? resourceValues(forKeys: [.creationDateKey]))?.creationDate }
}
