import Foundation
import Security

/// Holds only the studio session cookie value, never the password.
protocol CookieStore: AnyObject, Sendable {
    var cookie: String? { get set }
}

final class MemoryCookieStore: CookieStore, @unchecked Sendable {
    var cookie: String?
}

final class KeychainCookieStore: CookieStore, @unchecked Sendable {
    private let service = "com.philly95.miyabiOverlay", account = "studio_session"
    private var query: [CFString: Any] { [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account] }

    var cookie: String? {
        get {
            var out: CFTypeRef?
            guard SecItemCopyMatching(query.merging([kSecReturnData: true]) { $1 } as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
            return String(data: d, encoding: .utf8)
        }
        set {
            SecItemDelete(query as CFDictionary)
            if let v = newValue { SecItemAdd(query.merging([kSecValueData: Data(v.utf8)]) { $1 } as CFDictionary, nil) }
        }
    }
}
