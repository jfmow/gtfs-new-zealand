import Foundation
import Security

/// This install's identity for the backend's native-device notification
/// endpoints (`POST /devices/register` and every `/notifications/*` call,
/// via the `X-Device-Id`/`X-Device-Secret` headers - see backend
/// `routes.go`'s `identityFromRequest`). Generated once and kept in the
/// Keychain (not UserDefaults - `secret` is a bearer credential: anyone who
/// has it can delete this device's subscriptions/reminders).
public struct DeviceIdentity: Sendable, Equatable {
    public let id: String
    public let secret: String
}

public enum DeviceIdentityStore {
    private static let service = "dev.suddsy.transit.device-identity"
    private static let account = "primary"

    /// Returns the existing identity, or creates and persists a new one.
    public static func loadOrCreate() -> DeviceIdentity {
        if let existing = load() { return existing }
        let created = DeviceIdentity(id: UUID().uuidString, secret: generateSecret())
        save(created)
        return created
    }

    private static func generateSecret() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            // SecRandomCopyBytes failing is exceptionally rare (no entropy
            // source) - UUID x2 is still cryptographically strong enough
            // for a bearer secret and keeps this from ever throwing.
            return UUID().uuidString + UUID().uuidString
        }
        return Data(bytes).base64EncodedString()
    }

    private static func load() -> DeviceIdentity? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let stored = try? JSONDecoder().decode(StoredIdentity.self, from: data)
        else { return nil }
        return DeviceIdentity(id: stored.id, secret: stored.secret)
    }

    private static func save(_ identity: DeviceIdentity) {
        guard let data = try? JSONEncoder().encode(StoredIdentity(id: identity.id, secret: identity.secret)) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(attributes as CFDictionary, nil)
    }

    private struct StoredIdentity: Codable {
        let id: String
        let secret: String
    }
}
