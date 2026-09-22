import TransitCore
import UIKit
import UserNotifications

/// Owns this install's device identity and its registration with the
/// backend's native-push endpoints (`/devices/*`). Registers the device id
/// (with an empty APNs token) as soon as the app launches - `RegisterIOSDevice`
/// on the Go side accepts that - so stop/route subscriptions and reminders
/// work immediately, even before the person grants notification permission
/// or a real push token exists. A real APNs environment (Team ID,
/// provisioning, a physical device) is required for the token to ever
/// actually arrive; until then this device is registered but push-silent.
@MainActor
@Observable
final class PushRegistrationService {
    private(set) var identity: DeviceIdentity?
    private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    private(set) var isRegisteredWithBackend = false

    private let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    var isAuthorized: Bool {
        authorizationStatus == .authorized || authorizationStatus == .provisional
    }

    func start() async {
        let identity = DeviceIdentityStore.loadOrCreate()
        self.identity = identity
        await api.setDeviceIdentity(identity)
        await refreshAuthorizationStatus()

        do {
            try await api.registerDevice(identity, environment: Self.apnsEnvironment)
            isRegisteredWithBackend = true
        } catch {
            // Best-effort - subscription/reminder calls will surface their
            // own error if this device genuinely isn't registered yet.
        }
    }

    /// Prompts for notification permission, then (if granted) asks iOS for
    /// a device token - `didReceiveAPNsToken` completes the loop once/if
    /// the OS calls back.
    @discardableResult
    func requestPermission() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        await refreshAuthorizationStatus()
        if granted {
            UIApplication.shared.registerForRemoteNotifications()
        }
        return granted
    }

    func didReceiveAPNsToken(_ tokenData: Data) {
        let token = tokenData.map { String(format: "%02x", $0) }.joined()
        guard let identity else { return }
        Task {
            try? await api.updateDeviceToken(identity, apnsToken: token, environment: Self.apnsEnvironment)
        }
    }

    private func refreshAuthorizationStatus() async {
        authorizationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    private static var apnsEnvironment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }
}
