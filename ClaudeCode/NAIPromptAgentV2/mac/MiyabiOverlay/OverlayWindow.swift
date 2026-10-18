import AppKit

/// Borderless click-through-on-transparency window hosting the clip layer.
@MainActor final class OverlayWindow: NSWindow {
    static let size = CGSize(width: 240, height: 416)
    var alphaSource: () -> CGImage? = { nil }
    var onPoke: () -> Void = {}
    var onDragStart: () -> Void = {}
    var onDrop: () -> Void = {}
    private var hitTimer: Timer?

    init(layer: CALayer) {
        super.init(contentRect: CGRect(origin: .zero, size: Self.size), styleMask: .borderless, backing: .buffered, defer: false)
        isOpaque = false; backgroundColor = .clear; hasShadow = false
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        sharingType = .none
        isReleasedWhenClosed = false
        let v = SpriteView(frame: CGRect(origin: .zero, size: Self.size))
        v.wantsLayer = true
        layer.frame = v.bounds
        v.layer?.addSublayer(layer)
        v.owner = self
        contentView = v
        let s = NSScreen.main ?? NSScreen.screens[0]
        setFrameOrigin(Placement.home(screen: s.frame, visible: s.visibleFrame, size: Self.size))
        hitTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.updateHit() } }
    }

    override var canBecomeKey: Bool { false }

    /// Mouse events pass through unless the pixel under the cursor is (mostly) opaque.
    private func updateHit() {
        guard isVisible else { return }
        let m = NSEvent.mouseLocation
        guard frame.contains(m), let img = alphaSource() else { ignoresMouseEvents = true; return }
        if NSEvent.pressedMouseButtons != 0, !ignoresMouseEvents { return } // keep a drag alive
        let p = CGPoint(x: (m.x - frame.minX) / frame.width * CGFloat(img.width), y: (1 - (m.y - frame.minY) / frame.height) * CGFloat(img.height))
        ignoresMouseEvents = HitTest.alphaAt(img, p) < 0.1
    }
}

@MainActor private final class SpriteView: NSView {
    weak var owner: OverlayWindow?
    private var downAt: NSPoint?, dragged = false

    override func mouseDown(with e: NSEvent) { downAt = NSEvent.mouseLocation; dragged = false }
    override func mouseDragged(with e: NSEvent) {
        guard let o = owner, let d = downAt else { return }
        let m = NSEvent.mouseLocation
        if !dragged, hypot(m.x - d.x, m.y - d.y) < 4 { return }
        if !dragged { dragged = true; o.onDragStart() }
        o.setFrameOrigin(NSPoint(x: o.frame.minX + e.deltaX, y: o.frame.minY - e.deltaY))
    }
    override func mouseUp(with e: NSEvent) {
        if dragged { owner?.onDrop() } else { owner?.onPoke() }
        downAt = nil
    }
}

/// Quip bubble above her, auto-hidden after 5 s.
@MainActor final class Bubble {
    private let panel: NSPanel
    private let label = NSTextField(wrappingLabelWithString: "")
    private var hide: Timer?

    init() {
        panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.sharingType = .none; panel.ignoresMouseEvents = true; panel.isReleasedWhenClosed = false
        let box = NSVisualEffectView(); box.material = .popover; box.state = .active; box.wantsLayer = true; box.layer?.cornerRadius = 12
        label.maximumNumberOfLines = 4; label.preferredMaxLayoutWidth = 220
        box.addSubview(label)
        panel.contentView = box
    }

    func show(_ text: String, above w: NSWindow) {
        label.stringValue = text
        let ls = label.fittingSize
        let size = NSSize(width: ls.width + 24, height: ls.height + 16)
        label.frame = NSRect(x: 12, y: 8, width: ls.width, height: ls.height)
        panel.setFrame(NSRect(x: w.frame.midX - size.width / 2, y: w.frame.maxY - 40, width: size.width, height: size.height), display: true)
        panel.orderFrontRegardless()
        hide?.invalidate()
        hide = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.panel.orderOut(nil) } }
    }

    func dismiss() { hide?.invalidate(); panel.orderOut(nil) }
}
