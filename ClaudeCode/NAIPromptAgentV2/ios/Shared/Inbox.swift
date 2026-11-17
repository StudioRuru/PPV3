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

    /// Images waiting for the Tagger: regular files only (the lore/ subfolder is not an image).
    static func pending() -> [URL] { files(in: dir) }

    static var loreDir: URL? {
        guard let d = dir?.appendingPathComponent("lore", isDirectory: true) else { return nil }
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    static func pendingLore() -> [URL] { files(in: loreDir) }

    /// Lorebooks queue up (unlike images): each one is imported in turn.
    static func dropLore(_ data: Data, name: String) throws {
        guard let d = loreDir else { throw CocoaError(.fileNoSuchFile) }
        try data.write(to: d.appendingPathComponent("\(UUID().uuidString)-\(loreName(name)).json"), options: .atomic)
    }

    /// File-safe display name: no "/", trailing ".json" (any case) dropped.
    static func loreName(_ name: String) -> String {
        let safe = name.replacingOccurrences(of: "/", with: "-")
        return safe.lowercased().hasSuffix(".json") ? String(safe.dropLast(5)) : safe
    }

    static func files(in d: URL?) -> [URL] {
        guard let d, let files = try? FileManager.default.contentsOfDirectory(at: d, includingPropertiesForKeys: [.creationDateKey, .isRegularFileKey]) else { return [] }
        return files.filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true }
            .sorted { ($0.creationDate ?? .distantPast) < ($1.creationDate ?? .distantPast) }
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
