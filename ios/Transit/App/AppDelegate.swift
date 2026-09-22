import UIKit
import UserNotifications

/// A SwiftUI `App` has no `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`
/// callback of its own - this bridges it, and shows a notification banner
/// even while the app is in the foreground (iOS suppresses this by default).
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var onAPNsToken: ((Data) -> Void)?
    var onAPNsRegistrationFailure: ((Error) -> Void)?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        onAPNsToken?(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        onAPNsRegistrationFailure?(error)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
