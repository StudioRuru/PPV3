import AppKit

@MainActor protocol MenuHost: AnyObject {
    var shown: Bool { get set }
    var boldness: String { get set }
    var muted: Bool { get set }
    var outfit: String { get set }
    var outfits: [String] { get }
    var baseURL: String { get }
    func configureServer(url: String, password: String)
    func syncNow()
}

@MainActor final class MenuBar: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private unowned let host: MenuHost

    init(host: MenuHost) {
        self.host = host
        super.init()
        item.button?.title = "雅"
        let m = NSMenu(); m.delegate = self
        item.menu = m
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        add(menu, host.shown ? "Hide" : "Show", #selector(toggleShown))
        let b = NSMenu()
        for t in ["tame", "teasing", "lewd"] { let i = add(b, t.capitalized, #selector(setBoldness(_:))); i.representedObject = t; i.state = host.boldness == t ? .on : .off }
        sub(menu, "Boldness", b)
        let c = add(menu, "Mute bubble", #selector(toggleMute)); c.state = host.muted ? .on : .off
        let o = NSMenu()
        for n in host.outfits { let i = add(o, n.capitalized, #selector(setOutfit(_:))); i.representedObject = n; i.state = host.outfit == n ? .on : .off }
        sub(menu, "Outfit", o)
        menu.addItem(.separator())
        add(menu, "Server URL and password…", #selector(server))
        add(menu, "Sync now", #selector(sync))
        menu.addItem(.separator())
        add(menu, "Quit", #selector(quit))
    }

    @discardableResult private func add(_ m: NSMenu, _ title: String, _ sel: Selector) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: sel, keyEquivalent: ""); i.target = self; m.addItem(i); return i
    }
    private func sub(_ m: NSMenu, _ title: String, _ s: NSMenu) { let i = NSMenuItem(title: title, action: nil, keyEquivalent: ""); i.submenu = s; m.addItem(i) }

    @objc private func toggleShown() { host.shown.toggle() }
    @objc private func setBoldness(_ i: NSMenuItem) { host.boldness = i.representedObject as! String }
    @objc private func toggleMute() { host.muted.toggle() }
    @objc private func setOutfit(_ i: NSMenuItem) { host.outfit = i.representedObject as! String }
    @objc private func sync() { host.syncNow() }
    @objc private func quit() { NSApp.terminate(nil) }

    /// Password is used once to log in; only the session cookie is kept (in the Keychain).
    @objc func server() {
        let a = NSAlert(); a.messageText = "Studio server"
        let url = NSTextField(frame: NSRect(x: 0, y: 30, width: 260, height: 24)); url.stringValue = host.baseURL; url.placeholderString = "http://host:port"
        let pw = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24)); pw.placeholderString = "Password"
        let v = NSView(frame: NSRect(x: 0, y: 0, width: 260, height: 56)); v.addSubview(url); v.addSubview(pw)
        a.accessoryView = v
        a.addButton(withTitle: "Connect"); a.addButton(withTitle: "Cancel")
        NSApp.activate()
        if a.runModal() == .alertFirstButtonReturn { host.configureServer(url: url.stringValue, password: pw.stringValue) }
    }
}
