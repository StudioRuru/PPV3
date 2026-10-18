import Foundation
import JavaScriptCore

struct Act: Decodable, Equatable, Sendable { var pose: String; var quip: String?; var look: String? }

/// JSContext over Resources/behaviour.js. BState stays an opaque JSON string so every field round-trips.
final class Behaviour {
    struct Result { var state: String; var act: Act?; var error: String? }
    enum Failure: Error { case noScript, js(String) }

    private let ctx = JSContext()!
    private let stepFn: JSValue, initFn: JSValue

    init(bundle: Bundle = Bundle(for: Behaviour.self)) throws {
        guard let url = bundle.url(forResource: "behaviour", withExtension: "js"), let src = try? String(contentsOf: url, encoding: .utf8) else { throw Failure.noScript }
        ctx.evaluateScript(src)
        // Wrapper keeps s as a JSON string on the way out; init gets a real Math.random.
        guard let s = ctx.evaluateScript("""
            (j) => { const r = JSON.parse(Behaviour.toJSONStep(j));
              return JSON.stringify({ s: r.s == null ? null : JSON.stringify(r.s), act: r.act ?? null, error: r.error ?? null }); }
            """), let i = ctx.evaluateScript("(p, n) => JSON.stringify(Behaviour.init(p, n, Math.random))"), !s.isUndefined, !i.isUndefined else { throw Failure.js("load failed") }
        stepFn = s; initFn = i
    }

    func initialState(pose: String, now: Double) throws -> String {
        guard let s = initFn.call(withArguments: [pose, now])?.toString(), s != "undefined" else { throw Failure.js("init failed") }
        return s
    }

    func step(state: String, event: String, lib: Library, outfit: String, boldness: String, now: Double) throws -> Result {
        let enc = JSONEncoder()
        let libJSON = String(decoding: try enc.encode(lib.withStageIdles(outfit: outfit)), as: UTF8.self)
        let str = { (v: String) in String(decoding: (try? enc.encode(v)) ?? Data("\"\"".utf8), as: UTF8.self) }
        let input = #"{"s":\#(state),"ev":{"type":\#(str(event))},"ctx":{"lib":\#(libJSON),"outfit":\#(str(outfit)),"boldness":\#(str(boldness)),"now":\#(now)}}"#
        guard let out = stepFn.call(withArguments: [input])?.toString(), let d = out.data(using: .utf8),
              let o = try JSONSerialization.jsonObject(with: d) as? [String: Any] else { throw Failure.js("step failed") }
        let act = (o["act"] as? [String: Any]).flatMap { try? JSONDecoder().decode(Act.self, from: JSONSerialization.data(withJSONObject: $0)) }
        return Result(state: (o["s"] as? String) ?? state, act: act, error: o["error"] as? String)
    }
}
