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

    /// A library-supplied path segment must be a plain name.
    static func safe(_ s: String) -> Bool {
        !s.isEmpty && s != "." && s != ".." && !s.contains { $0 == "/" || $0 == "\\" || $0 == "\0" }
    }
    private func valid(_ c: LibClip) -> Bool { [c.surface, c.outfit, c.from, c.to, c.dir].allSatisfy(Self.safe) && c.frames >= 0 && c.frames < 10_000 }

    /// Local path of a frame, keyed by clip version; nil for an unsafe clip or a path that escapes the cache.
    func frameURL(_ c: LibClip, _ i: Int) -> URL? {
        guard valid(c) else { return nil }
        let u = cacheDir.appendingPathComponent("\(c.surface)/\(c.outfit)/\(c.dir)/\(c.v)/\(String(format: "%03d", i)).webp").standardizedFileURL
        return u.path.hasPrefix(cacheDir.standardizedFileURL.path + "/") ? u : nil
    }

    private final class SameHost: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
        let host: String?
        init(_ h: String?) { host = h }
        func urlSession(_ s: URLSession, task: URLSessionTask, willPerformHTTPRedirection r: HTTPURLResponse, newRequest q: URLRequest, completionHandler done: @escaping (URLRequest?) -> Void) {
            done(q.url?.host == host ? q : nil)
        }
    }

    private func send(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var r = req
        r.httpShouldHandleCookies = false
        if let c = cookies.cookie { r.setValue("studio_session=\(c)", forHTTPHeaderField: "Cookie") }
        let (d, resp) = try await session.data(for: r, delegate: SameHost(req.url?.host))
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
        if let c = HTTPCookie.cookies(withResponseHeaderFields: fields, for: base).first(where: { $0.name == "studio_session" }) { try cookies.setCookie(c.value) }
    }

    /// Fresh library with its frames cached; the meta is written only once every frame is in, so a partial fetch retries next sync.
    /// Offline (or any non-auth failure) falls back to the last complete cache.
    func sync(base: URL) async throws -> Library {
        do {
            let (d, _) = try await send(URLRequest(url: base.appendingPathComponent("api/sprites/library")))
            let lib = try JSONDecoder().decode(Library.self, from: d)
            if await fetchFrames(base: base, lib) {
                try FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
                try d.write(to: metaFile, options: .atomic)
            }
            return lib
        } catch LibraryError.needsLogin {
            throw LibraryError.needsLogin
        } catch {
            if let d = try? Data(contentsOf: metaFile), let lib = try? JSONDecoder().decode(Library.self, from: d) { return lib }
            throw error
        }
    }

    private static let seg = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))

    /// True when every frame of every valid clip is on disk. At most 6 fetches in flight; invalid clips are skipped.
    private func fetchFrames(base: URL, _ lib: Library) async -> Bool {
        var seen = Set<URL>()
        var jobs: [(LibClip, Int, URL)] = []
        for c in lib.clips where valid(c) {
            for i in 0..<c.frames {
                guard let f = frameURL(c, i), seen.insert(f).inserted, !FileManager.default.fileExists(atPath: f.path) else { continue }
                jobs.append((c, i, f))
            }
        }
        let root = base.absoluteString.hasSuffix("/") ? String(base.absoluteString.dropLast()) : base.absoluteString
        return await withTaskGroup(of: Bool.self) { g in
            var ok = true, it = jobs.makeIterator()
            func next() -> Bool {
                guard let (c, i, f) = it.next() else { return false }
                let path = ["api", "sprites", "library", "file", c.surface, c.outfit, c.dir, String(format: "%03d.webp", i)].map { $0.addingPercentEncoding(withAllowedCharacters: Self.seg)! }.joined(separator: "/")
                g.addTask {
                    guard let u = URL(string: "\(root)/\(path)?v=\(c.v)"), let (d, _) = try? await self.send(URLRequest(url: u)) else { return false }
                    do {
                        try FileManager.default.createDirectory(at: f.deletingLastPathComponent(), withIntermediateDirectories: true)
                        try d.write(to: f, options: .atomic)
                        return true
                    } catch { return false }
                }
                return true
            }
            for _ in 0..<6 { if !next() { break } }
            while let r = await g.next() { ok = ok && r; _ = next() }
            return ok
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
