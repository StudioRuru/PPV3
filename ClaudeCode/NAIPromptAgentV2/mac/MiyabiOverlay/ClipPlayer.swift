import AppKit
import ImageIO
import QuartzCore

/// Port of player.ts (stage surface): which clip plays when. Pure value type.
struct Seg: Equatable { var clip: LibClip; var reversed: Bool; var loop: Bool }
struct PlayerState: Equatable { var at: String; var seg: Seg?; var startedAt: Double; var pending: String? }

enum ClipRoute {
    static func idle(_ lib: Library, _ outfit: String, _ key: String) -> Seg? {
        lib.find("stage", outfit, key, key).map { Seg(clip: $0, reversed: false, loop: true) }
    }
    /// nil = crossfade: own clip, else the mirror played backwards.
    static func route(_ lib: Library, _ outfit: String, _ from: String, _ to: String) -> Seg? {
        if let own = lib.find("stage", outfit, from, to) { return Seg(clip: own, reversed: own.reverseOf != nil, loop: false) }
        if let m = lib.find("stage", outfit, to, from), m.reverseOf == nil { return Seg(clip: m, reversed: true, loop: false) }
        return nil
    }
    static func initial(_ lib: Library, _ outfit: String, _ at: String, _ now: Double) -> PlayerState {
        PlayerState(at: at, seg: idle(lib, outfit, at), startedAt: now, pending: nil)
    }
    static func request(_ s: PlayerState, _ to: String, _ lib: Library, _ outfit: String, _ now: Double) -> (PlayerState, crossfade: Bool) {
        if let seg = s.seg, !seg.loop { var n = s; n.pending = to == s.at ? nil : to; return (n, false) }
        if to == s.at { return (s, false) }
        if let r = route(lib, outfit, s.at, to) { return (PlayerState(at: to, seg: r, startedAt: now, pending: nil), false) }
        return (initial(lib, outfit, to, now), true)
    }
    static func tick(_ s: PlayerState, _ lib: Library, _ outfit: String, _ now: Double) -> (PlayerState, crossfade: Bool) {
        guard let seg = s.seg else { return (idle(lib, outfit, s.at) != nil ? initial(lib, outfit, s.at, now) : s, false) }
        if seg.loop || now - s.startedAt < seg.clip.ms { return (s, false) }
        let settled = initial(lib, outfit, s.at, now)
        if let p = s.pending { return request(settled, p, lib, outfit, now) }
        return (settled, false)
    }
    /// Frame index to show; idles drop the loop seam (first frame equals the last).
    static func frameIndex(_ s: PlayerState, _ now: Double) -> (LibClip, Int)? {
        guard let seg = s.seg else { return nil }
        let n = seg.clip.frames, step = max(0, Int((now - s.startedAt) / 1000 * Double(seg.clip.fps)))
        let i = seg.loop ? step % max(1, n - 1) : min(step, n - 1)
        return (seg.clip, seg.reversed ? n - 1 - i : i)
    }
}

/// Draws the current frame into a layer; a crossfade (missing clip) animates `contents`.
@MainActor final class ClipPlayer {
    let layer = CALayer()
    private(set) var current: CGImage?
    private var state: PlayerState?
    private var lib: Library?
    private var outfit = ""
    private var client: LibraryClient?
    private var timer: Timer?
    private var cache: [URL: CGImage] = [:]

    init() { layer.contentsGravity = .resizeAspect }

    func load(lib: Library, outfit: String, client: LibraryClient, start: String) {
        self.lib = lib; self.outfit = outfit; self.client = client; cache = [:]
        state = ClipRoute.initial(lib, outfit, start, now)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tick() } }
        draw(fade: false)
    }

    func request(_ pose: String) {
        guard let lib, let state else { return }
        let r = ClipRoute.request(state, pose, lib, outfit, now)
        self.state = r.0
        draw(fade: r.crossfade)
    }

    private var now: Double { Date().timeIntervalSince1970 * 1000 }

    private func tick() {
        guard let lib, let state else { return }
        let r = ClipRoute.tick(state, lib, outfit, now)
        self.state = r.0
        draw(fade: r.crossfade)
    }

    private func draw(fade: Bool) {
        guard let state, let client, let (clip, i) = ClipRoute.frameIndex(state, now) else { return }
        let url = client.frameURL(clip, i)
        let img = cache[url] ?? CGImageSourceCreateWithURL(url as CFURL, nil).flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) }
        guard let img else { return }
        if cache.count > 240 { cache = [:] }
        cache[url] = img
        guard img !== current else { return }
        current = img
        if fade {
            let a = CABasicAnimation(keyPath: "contents")
            a.duration = 0.25
            layer.add(a, forKey: "fade")
        }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        layer.contents = img
        CATransaction.commit()
    }
}
