import XCTest

final class BehaviourTests: XCTestCase {
    private func key(_ k: String, tags: [String] = []) -> SpriteKey { SpriteKey(surface: "stage", key: k, label: k, tier: "tame", tags: tags, prompt: "", sort: 0) }
    private func idle(_ k: String) -> LibClip { LibClip(surface: "stage", outfit: "day", from: k, to: k, frames: 10, fps: 30, w: 480, h: 832, v: 1, reverseOf: nil) }
    private func lib() -> Library {
        Library(outfits: ["day"], keys: [key("stand"), key("sit"), key("noidle")], edges: [["stand", "sit"]], clips: [idle("stand"), idle("sit")])
    }

    func testPokeYieldsQuip() throws {
        let b = try Behaviour()
        let s = try b.initialState(pose: "stand", now: 1_000)
        let r = try b.step(state: s, event: "poke", lib: lib(), outfit: "day", boldness: "tame", now: 2_000)
        XCTAssertEqual(r.act?.quip, "poke")
        XCTAssertNil(r.error)
        XCTAssertTrue(r.state.contains("\"pokes\""))
    }

    func testStateRoundTripsOpaque() throws {
        let b = try Behaviour()
        let s = try b.initialState(pose: "stand", now: 1_000)
        let r = try b.step(state: s, event: "typing", lib: lib(), outfit: "day", boldness: "tame", now: 2_000)
        XCTAssertTrue(r.state.contains("lastLook"))
        XCTAssertEqual(r.act?.look, "cursor")
    }

    func testStageKeysWithoutIdleAreDropped() {
        let l = lib().withStageIdles(outfit: "day")
        XCTAssertEqual(l.keys.map(\.key), ["stand", "sit"])
        XCTAssertTrue(lib().withStageIdles(outfit: "night").keys.isEmpty)
    }

    func testBadEventReportsErrorNotThrow() throws {
        let b = try Behaviour()
        let s = try b.initialState(pose: "stand", now: 1)
        let r = try b.step(state: s, event: "nope", lib: lib(), outfit: "day", boldness: "tame", now: 2)
        XCTAssertNotNil(r.error)
        XCTAssertNil(r.act)
        XCTAssertEqual(r.state, s)
    }
}
