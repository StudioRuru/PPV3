import ImageIO
import UIKit
import UniformTypeIdentifiers

/// "Tag in Studio": copy the shared image into the app-group inbox, then try to open the app.
final class ShareViewController: UIViewController {
    private let label = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 13 / 255, green: 16 / 255, blue: 32 / 255, alpha: 1)
        label.textColor = UIColor(red: 233 / 255, green: 236 / 255, blue: 248 / 255, alpha: 1)
        label.font = .preferredFont(forTextStyle: .headline)
        label.numberOfLines = 0
        label.textAlignment = .center
        label.text = "Sending to Studio…"
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor), label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
        ])
        Task { await handle() }
    }

    @MainActor private func handle() async {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        guard let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }) else { return await handleLore(providers) }
        do {
            // PNGs keep their bytes (NovelAI recipe metadata lives in them); everything else becomes JPEG (HEIC included).
            if p.hasItemConformingToTypeIdentifier(UTType.png.identifier) {
                try Inbox.drop(try await p.data(for: .png), ext: "png")
            } else {
                let raw = try await p.data(for: .image)
                guard let jpg = Self.downsampledJPEG(raw) else { return finish("That image couldn't be read.") }
                try Inbox.drop(jpg, ext: "jpg")
            }
        } catch {
            return finish("Couldn't send: \(error.localizedDescription)")
        }
        openApp { [weak self] opened in self?.finish(opened ? nil : "Saved. Open Studio to tag it.") }
    }

    /// A .json lorebook (SillyTavern World Info or a card) waits in inbox/lore for the app to POST it.
    @MainActor private func handleLore(_ providers: [NSItemProvider]) async {
        guard let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.json.identifier) }) else { return finish("Nothing Studio can use.") }
        do {
            let data = try await p.data(for: .json)
            guard data.count <= 8 << 20 else { return finish("That lorebook is too big (8 MB max).") }
            try Inbox.dropLore(data, name: p.suggestedName ?? "Imported lore")
        } catch {
            return finish("Couldn't send: \(error.localizedDescription)")
        }
        openApp { [weak self] opened in self?.finish(opened ? nil : "Lorebook saved. Open Studio to import it.") }
    }

    /// ≤2048 px JPEG straight from the file: a full decode of a 48 MP photo would blow the ~120 MB extension limit.
    /// The tagger works at 448–1024 px, so nothing is lost.
    static func downsampledJPEG(_ data: Data) -> Data? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: 2048,
              ] as CFDictionary) else { return nil }
        return UIImage(cgImage: cg).jpegData(compressionQuality: 0.9)
    }

    /// Extensions may not open their app officially; walk the responder chain to UIApplication.
    /// If iOS refuses, the image still waits in the inbox for the next time Studio opens.
    private func openApp(_ done: @escaping (Bool) -> Void) {
        let url = URL(string: "naistudio://import")!
        let sel = NSSelectorFromString("openURL:options:completionHandler:")
        var r: UIResponder? = self
        while let next = r {
            if let app = next as? UIApplication, app.responds(to: sel) {
                // Call with all three arguments (perform(_:with:with:) would leave the completion handler as garbage).
                typealias Open = @convention(c) (AnyObject, Selector, URL, [UIApplication.OpenExternalURLOptionsKey: Any], ((Bool) -> Void)?) -> Void
                let open = unsafeBitCast(app.method(for: sel), to: Open.self)
                open(app, sel, url, [:]) { ok in DispatchQueue.main.async { done(ok) } }
                return
            }
            r = next.next
        }
        done(false)
    }

    private func finish(_ message: String?) {
        if let message { label.text = message }
        DispatchQueue.main.asyncAfter(deadline: .now() + (message == nil ? 0.3 : 1.6)) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}

private extension NSItemProvider {
    func data(for type: UTType) async throws -> Data {
        try await withCheckedThrowingContinuation { c in
            _ = loadDataRepresentation(for: type) { data, error in
                if let data { c.resume(returning: data) } else { c.resume(throwing: error ?? CocoaError(.fileReadUnknown)) }
            }
        }
    }
}
