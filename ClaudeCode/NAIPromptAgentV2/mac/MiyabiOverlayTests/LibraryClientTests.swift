import XCTest

final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?
    nonisolated(unsafe) static var seen: [URLRequest] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.seen.append(request)
        do {
            let (code, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: ["Set-Cookie": "studio_session=tok123; Path=/; HttpOnly"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class LibraryClientTests: XCTestCase {
    var dir: URL!
    let base = URL(string: "http://stub.invalid")!
    let json = #"{"outfits":["day"],"keys":[{"surface":"stage","key":"stand","label":"Stand","tier":"tame","tags":[],"prompt":"p","sort":0}],"edges":[],"clips":[{"surface":"stage","outfit":"day","from":"stand","to":"stand","frames":2,"fps":30,"w":480,"h":832,"v":7}]}"#

    override func setUp() {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("miyabi-test-\(UUID().uuidString)")
        StubProtocol.seen = []
    }
    override func tearDown() { try? FileManager.default.removeItem(at: dir) }

    private func client(_ store: CookieStore = MemoryCookieStore()) -> LibraryClient {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StubProtocol.self]
        return LibraryClient(session: URLSession(configuration: cfg), cacheDir: dir, cookies: store)
    }

    func testSyncParsesAndCaches() async throws {
        StubProtocol.handler = { r in r.url!.path == "/api/sprites/library" ? (200, Data(self.json.utf8)) : (200, Data([1, 2, 3])) }
        let c = client()
        let lib = try await c.sync(base: base)
        XCTAssertEqual(lib.outfits, ["day"])
        XCTAssertEqual(lib.clips[0].v, 7)
        let f = c.frameURL(lib.clips[0], 1)
        XCTAssertEqual(try Data(contentsOf: f), Data([1, 2, 3]))
        XCTAssertTrue(f.path.hasPrefix(dir.path))
        XCTAssertTrue(StubProtocol.seen.contains { $0.url!.path == "/api/sprites/library/file/stage/day/stand~stand/001.webp" && $0.url!.query == "v=7" })
    }

    func testOfflineReturnsCache() async throws {
        StubProtocol.handler = { _ in (200, Data(self.json.utf8)) }
        let c = client()
        _ = try await c.sync(base: base)
        StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        let lib = try await c.sync(base: base)
        XCTAssertEqual(lib.keys[0].key, "stand")
    }

    func testOfflineWithoutCacheThrows() async {
        StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        do { _ = try await client().sync(base: base); XCTFail("should throw") } catch {}
    }

    func test401NeedsLogin() async {
        StubProtocol.handler = { _ in (401, Data()) }
        do { _ = try await client().sync(base: base); XCTFail("should throw") } catch { XCTAssertEqual(error as? LibraryError, .needsLogin) }
    }

    func testLoginStoresCookieOnly() async throws {
        StubProtocol.handler = { _ in (200, Data(#"{"ok":true}"#.utf8)) }
        let store = MemoryCookieStore()
        try await client(store).login(base: base, password: "pw")
        XCTAssertEqual(store.cookie, "tok123")
        let body = String(data: StubProtocol.seen[0].httpBodyStream.map { Data(reading: $0) } ?? StubProtocol.seen[0].httpBody ?? Data(), encoding: .utf8)
        XCTAssertEqual(body, #"{"password":"pw"}"#)
        // next request carries the cookie
        StubProtocol.handler = { _ in (200, Data(self.json.utf8)) }
        _ = try await client(store).sync(base: base)
        XCTAssertEqual(StubProtocol.seen.last?.value(forHTTPHeaderField: "Cookie"), "studio_session=tok123")
    }

    func testQuipBody() async throws {
        StubProtocol.handler = { _ in (200, Data(#"{"expression":"smug","text":"hi","source":"canned"}"#.utf8)) }
        let q = try await client().quip(base: base, kind: "tap", now: 5)
        XCTAssertEqual(q.text, "hi")
    }
}

private extension Data {
    init(reading s: InputStream) {
        self.init(); s.open(); defer { s.close() }
        var buf = [UInt8](repeating: 0, count: 1024)
        while s.hasBytesAvailable { let n = s.read(&buf, maxLength: 1024); if n <= 0 { break }; append(buf, count: n) }
    }
}
