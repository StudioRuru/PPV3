import Foundation

struct SpriteKey: Codable, Equatable, Sendable {
    var surface, key, label, tier: String
    var tags: [String]
    var prompt: String
    var sort: Double
}

struct LibClip: Codable, Equatable, Sendable {
    var surface, outfit, from, to: String
    var frames: Int
    var fps, w, h, v: Int
    var reverseOf: String?
    var dir: String { reverseOf ?? "\(from)~\(to)" }
    var ms: Double { Double(frames) / Double(fps) * 1000 }
}

struct Library: Codable, Equatable, Sendable {
    var outfits: [String]
    var keys: [SpriteKey]
    var edges: [[String]]
    var clips: [LibClip]

    func find(_ surface: String, _ outfit: String, _ from: String, _ to: String) -> LibClip? {
        clips.first { $0.surface == surface && $0.outfit == outfit && $0.from == from && $0.to == to }
    }

    /// Stage keys limited to poses with an approved idle for the outfit (mirrors player.ts withStageIdles).
    func withStageIdles(outfit: String) -> Library {
        var l = self
        l.keys = keys.filter { $0.surface != "stage" || find("stage", outfit, $0.key, $0.key) != nil }
        return l
    }
}

struct Quip: Decodable, Sendable { var expression: String?; var text: String; var source: String? }

enum LibraryError: Error, Equatable { case needsLogin, http(Int), offline }

final class LibraryClient: Sendable {
    let session: URLSession, cacheDir: URL, cookies: CookieStore

    init(session: URLSession = .shared, cacheDir: URL = LibraryClient.defaultCacheDir, cookies: CookieStore) {
        self.session = session; self.cacheDir = cacheDir; self.cookies = cookies
    }

    static var defaultCacheDir: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("MiyabiOverlay/library")
    }

    private var metaFile: URL { cacheDir.appendingPathComponent("library.json") }

    /// Local path of a frame, keyed by clip version.
    func frameURL(_ c: LibClip, _ i: Int) -> URL {
        cacheDir.appendingPathComponent("\(c.surface)/\(c.outfit)/\(c.dir)/\(c.v)/\(String(format: "%03d", i)).webp")
    }

    private func send(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var r = req
        r.httpShouldHandleCookies = false
        if let c = cookies.cookie { r.setValue("studio_session=\(c)", forHTTPHeaderField: "Cookie") }
        let (d, resp) = try await session.data(for: r)
        let h = resp as! HTTPURLResponse
        if h.statusCode == 401 { throw LibraryError.needsLogin }
        guard (200..<300).contains(h.statusCode) else { throw LibraryError.http(h.statusCode) }
        return (d, h)
    }

    func login(base: URL, password: String) async throws {
        var r = URLRequest(url: base.appendingPathComponent("api/auth/login"))
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONEncoder().encode(["password": password])
        let (_, h) = try await send(r)
        let fields = h.allHeaderFields as? [String: String] ?? [:]
        if let c = HTTPCookie.cookies(withResponseHeaderFields: fields, for: base).first(where: { $0.name == "studio_session" }) { cookies.cookie = c.value }
    }

    /// Fresh library with its frames cached; offline (or any non-auth failure) falls back to the cache.
    func sync(base: URL) async throws -> Library {
        do {
            let (d, _) = try await send(URLRequest(url: base.appendingPathComponent("api/sprites/library")))
            let lib = try JSONDecoder().decode(Library.self, from: d)
            try FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
            try d.write(to: metaFile)
            await fetchFrames(base: base, lib)
            return lib
        } catch LibraryError.needsLogin {
            throw LibraryError.needsLogin
        } catch {
            if let d = try? Data(contentsOf: metaFile), let lib = try? JSONDecoder().decode(Library.self, from: d) { return lib }
            throw error
        }
    }

    private func fetchFrames(base: URL, _ lib: Library) async {
        var seen = Set<URL>()
        let jobs = lib.clips.flatMap { c in (0..<c.frames).map { (c, $0) } }.filter { seen.insert(frameURL($0.0, $0.1)).inserted && !FileManager.default.fileExists(atPath: frameURL($0.0, $0.1).path) }
        await withTaskGroup(of: Void.self) { g in
            for (c, i) in jobs {
                g.addTask {
                    var u = URLComponents(url: base.appendingPathComponent("api/sprites/library/file/\(c.surface)/\(c.outfit)/\(c.dir)/\(String(format: "%03d", i)).webp"), resolvingAgainstBaseURL: false)!
                    u.queryItems = [URLQueryItem(name: "v", value: String(c.v))]
                    guard let (d, _) = try? await self.send(URLRequest(url: u.url!)) else { return }
                    let f = self.frameURL(c, i)
                    try? FileManager.default.createDirectory(at: f.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try? d.write(to: f, options: .atomic)
                }
            }
        }
    }

    /// kind: "tap" | "idle" | "greet" (what Mascot.tsx sends for poke / ignored / finally).
    func quip(base: URL, kind: String, now: Double) async throws -> Quip {
        var r = URLRequest(url: base.appendingPathComponent("api/mascot/quip"))
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["event": ["kind": kind, "at": now], "context": ["promptSummary": "", "nsfw": false]]
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try JSONDecoder().decode(Quip.self, from: try await send(r).0)
    }
}
