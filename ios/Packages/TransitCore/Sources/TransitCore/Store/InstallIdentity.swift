import Foundation

/// Persists small pieces of per-install identity that aren't user data.
/// Currently just the trace id sent as `X-Trace-ID` on every request -
/// mirrors the web app's `localStorage["trace-id"]`, used only for log
/// correlation, not authentication (that's the device id/secret pair, kept
/// in the Keychain - added when device registration lands).
public enum InstallIdentity {
    private static let traceIDKey = "transit.traceID"

    public static func traceID(userDefaults: UserDefaults = .standard) -> String {
        if let existing = userDefaults.string(forKey: traceIDKey) {
            return existing
        }
        let generated = UUID().uuidString
        userDefaults.set(generated, forKey: traceIDKey)
        return generated
    }
}
