import UIKit
import UserNotifications

/// A SwiftUI `App` has no `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`
/// callback of its own - this bridges it, shows banners while the app is in
/// the foreground, and routes a tapped notification's deeplink.
///
/// Both the APNs token and a tapped notification can arrive before SwiftUI
/// has set the handlers below (a cold launch from a notification tap
/// delivers `didReceive` during launch), so each is buffered and replayed
/// the moment its handler is set, rather than dropped.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var onAPNsToken: ((Data) -> Void)? {
        didSet {
            if let token = pendingToken, let onAPNsToken {
                pendingToken = nil
                onAPNsToken(token)
            }
        }
    }

    var onAPNsRegistrationFailure: ((Error) -> Void)?

    /// Whether the journey tracker is on screen - its in-app alert already
    /// shows the same get-on/get-off moment, so the push's banner is
    /// skipped then.
    var isJourneyTrackerVisible: () -> Bool = { false }

    /// Called with a tapped notification's `url` payload (usually a web path
    /// like `/?s=Britomart 11814` - see `DeepLink.init(string:)`).
    var onOpenNotificationURL: ((String) -> Void)? {
        didSet {
            if let url = pendingNotificationURL, let onOpenNotificationURL {
                pendingNotificationURL = nil
                onOpenNotificationURL(url)
            }
        }
    }

    private var pendingToken: Data?
    private var pendingNotificationURL: String?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        if let onAPNsToken {
            onAPNsToken(deviceToken)
        } else {
            pendingToken = deviceToken
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        onAPNsRegistrationFailure?(error)
    }

    @MainActor
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        if notification.request.content.userInfo["kind"] as? String == "journey", isJourneyTrackerVisible() {
            return [.list]
        }
        return [.banner, .list, .sound]
    }

    @MainActor
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              let url = response.notification.request.content.userInfo["url"] as? String,
              !url.isEmpty
        else { return }
        if let onOpenNotificationURL {
            onOpenNotificationURL(url)
        } else {
            pendingNotificationURL = url
        }
    }
}
