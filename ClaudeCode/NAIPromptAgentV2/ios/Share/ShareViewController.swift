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
        guard let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }) else { return finish("No image to send.") }
        do {
            // PNGs keep their bytes (NovelAI recipe metadata lives in them); everything else becomes JPEG (HEIC included).
            if p.hasItemConformingToTypeIdentifier(UTType.png.identifier) {
                try Inbox.drop(try await p.data(for: .png), ext: "png")
            } else {
                let raw = try await p.data(for: .image)
                guard let jpg = UIImage(data: raw)?.jpegData(compressionQuality: 0.92) else { return finish("That image couldn't be read.") }
                try Inbox.drop(jpg, ext: "jpg")
            }
        } catch {
            return finish("Couldn't send: \(error.localizedDescription)")
        }
        if openApp() { return finish(nil) }
        finish("Saved. Open Studio to tag it.")
    }

    /// Extensions may not open their app officially; walk the responder chain to UIApplication.
    /// If iOS refuses, the image still waits in the inbox for the next time Studio opens.
    private func openApp() -> Bool {
        let url = URL(string: "naistudio://import")!
        var r: UIResponder? = self
        while let next = r {
            if let app = next as? UIApplication {
                let sel = NSSelectorFromString("openURL:options:completionHandler:")
                guard app.responds(to: sel) else { return false }
                app.perform(sel, with: url, with: [:])
                return true
            }
            r = next.next
        }
        return false
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
