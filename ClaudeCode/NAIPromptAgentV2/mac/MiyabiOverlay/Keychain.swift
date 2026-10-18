import Foundation
import Security

/// Holds only the studio session cookie value, never the password.
protocol CookieStore: AnyObject, Sendable {
    var cookie: String? { get }
    func setCookie(_ v: String?) throws
}

final class MemoryCookieStore: CookieStore, @unchecked Sendable {
    private(set) var cookie: String?
    func setCookie(_ v: String?) throws { cookie = v }
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
    }

    func setCookie(_ v: String?) throws {
        SecItemDelete(query as CFDictionary)
        guard let v else { return }
        let st = SecItemAdd(query.merging([kSecValueData: Data(v.utf8)]) { $1 } as CFDictionary, nil)
        if st != errSecSuccess { throw NSError(domain: NSOSStatusErrorDomain, code: Int(st)) }
    }
}
