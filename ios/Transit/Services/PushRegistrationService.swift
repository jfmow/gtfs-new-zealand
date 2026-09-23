import TransitCore
import UIKit
import UserNotifications

/// Owns this install's device identity and its registration with the
/// backend's native-push endpoints (`/devices/*`).
///
/// Launch sequence: register the device id (so subscriptions work even
/// before permission is granted), then - if permission is already granted -
/// ask iOS for this launch's APNs token and forward it via
/// `updateDeviceToken`.
///
/// FIXED BUG (2026-09-23, "notifications don't send to iOS"): `start()` used
/// to re-register with an empty token on every launch, which the backend
/// wrote straight over the stored one, and `registerForRemoteNotifications()`
/// only ran from an explicit "Enable notifications" tap - so after the first
/// relaunch the server never had a token again and every push failed with
/// "client has no apns token". The backend now keeps the stored token on an
/// empty re-register, and this asks iOS for the token on every launch.
@MainActor
@Observable
final class PushRegistrationService {
    let identity: DeviceIdentity
    private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    private(set) var isRegisteredWithBackend = false
    /// Whether iOS has handed this launch an APNs token and the backend has
    /// accepted it.
    private(set) var hasUploadedToken = false
    private(set) var lastRegistrationError: String?

    private let api: APIClient
    /// A token that arrived before `start()` finished registering the device
    /// - `update-token` would 403 on an unregistered device, so it's held
    /// here and sent right after registration.
    private var pendingToken: String?
    private var pendingPushToStartToken: String?

    init(api: APIClient) {
        self.api = api
        self.identity = DeviceIdentityStore.loadOrCreate()
    }

    var isAuthorized: Bool {
        authorizationStatus == .authorized || authorizationStatus == .provisional || authorizationStatus == .ephemeral
    }

    func start() async {
        await api.setDeviceIdentity(identity)
        await refreshAuthorizationStatus()

        do {
            try await api.registerDevice(identity, environment: Self.apnsEnvironment)
            isRegisteredWithBackend = true
            lastRegistrationError = nil
        } catch {
            lastRegistrationError = error.localizedDescription
        }

        if let pendingToken {
            self.pendingToken = nil
            await upload(token: pendingToken)
        }
        if let pendingPushToStartToken {
            self.pendingPushToStartToken = nil
            await uploadPushToStartToken(pendingPushToStartToken)
        }

        // Tokens can change between launches (restore, reinstall, OS
        // update) and iOS only hands one out on request - so ask every
        // launch once permission exists.
        if isAuthorized {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// Prompts for notification permission, then (if granted) asks iOS for
    /// a device token - `didReceiveAPNsToken` completes the loop once the OS
    /// calls back.
    @discardableResult
    func requestPermission() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound, .timeSensitive])) ?? false
        await refreshAuthorizationStatus()
        if granted {
            UIApplication.shared.registerForRemoteNotifications()
        }
        return granted
    }

    func didReceiveAPNsToken(_ tokenData: Data) {
        let token = tokenData.map { String(format: "%02x", $0) }.joined()
        guard isRegisteredWithBackend else {
            pendingToken = token
            return
        }
        Task { await upload(token: token) }
    }

    func didFailToRegister(_ error: Error) {
        lastRegistrationError = error.localizedDescription
    }

    /// Re-reads permission - call when the app returns to the foreground,
    /// since the person may have changed it in Settings.
    func refreshAuthorizationStatus() async {
        let previouslyAuthorized = isAuthorized
        authorizationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        if isAuthorized, !previouslyAuthorized, isRegisteredWithBackend {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// ActivityKit's push-to-start token - lets the server start the journey
    /// Live Activity from a leave-by reminder with the app closed. Held
    /// until the device is registered, like the alert token.
    func uploadPushToStartToken(_ token: String) async {
        guard isRegisteredWithBackend else {
            pendingPushToStartToken = token
            return
        }
        try? await api.updateDeviceToken(identity, environment: Self.apnsEnvironment, pushToStartToken: token)
    }

    func sendTestNotification() async throws -> PushTestResult {
        try await api.sendTestNotification()
    }

    private func upload(token: String) async {
        do {
            try await api.updateDeviceToken(identity, apnsToken: token, environment: Self.apnsEnvironment)
            hasUploadedToken = true
            lastRegistrationError = nil
        } catch {
            lastRegistrationError = error.localizedDescription
        }
    }

    /// The APNs environment this build's token belongs to. That's decided
    /// by the provisioning profile's `aps-environment`, not by Debug vs
    /// Release - a Release build run from Xcode is still sandbox, and
    /// telling the backend the wrong one makes APNs reject every push with
    /// BadDeviceToken. App Store/TestFlight builds have no embedded profile
    /// and are always production.
    static let apnsEnvironment: String = {
        if let env = ProvisioningProfile.apsEnvironment {
            return env == "development" ? "sandbox" : "production"
        }
        #if targetEnvironment(simulator)
        return "sandbox"
        #else
        return Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") == nil ? "production" : "sandbox"
        #endif
    }()
}

/// Reads `aps-environment` out of the app's `embedded.mobileprovision` - a
/// CMS-signed blob with a plain XML plist inside it.
private enum ProvisioningProfile {
    static var apsEnvironment: String? {
        guard let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
              let data = FileManager.default.contents(atPath: path),
              let raw = String(data: data, encoding: .isoLatin1),
              let start = raw.range(of: "<plist"),
              let end = raw.range(of: "</plist>")
        else { return nil }
        let plistString = String(raw[start.lowerBound..<end.upperBound])
        guard let plistData = plistString.data(using: .isoLatin1),
              let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
              let entitlements = plist["Entitlements"] as? [String: Any]
        else { return nil }
        return entitlements["aps-environment"] as? String
    }
}
