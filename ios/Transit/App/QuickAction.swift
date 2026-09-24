import UIKit

/// The app icon's Home Screen quick actions (long-press the icon).
enum QuickAction: String, CaseIterable {
    case planJourney = "dev.suddsy.transit.planJourney"

    var shortcutItem: UIApplicationShortcutItem {
        switch self {
        case .planJourney:
            UIApplicationShortcutItem(
                type: rawValue, localizedTitle: "Plan a journey", localizedSubtitle: nil,
                icon: UIApplicationShortcutIcon(systemImageName: "point.topleft.down.to.point.bottomright.curvepath")
            )
        }
    }

    /// Hands actions to the app once `TransitApp` has set `handler` - a cold
    /// launch delivers the action before any view exists, so it's buffered
    /// and replayed then, like AppDelegate's notification taps.
    @MainActor
    final class Relay {
        var handler: ((QuickAction) -> Void)? {
            didSet {
                if let pending, let handler {
                    self.pending = nil
                    handler(pending)
                }
            }
        }

        private var pending: QuickAction?

        func perform(_ action: QuickAction) {
            if let handler { handler(action) } else { pending = action }
        }
    }

    @MainActor static let relay = Relay()
}

/// Only here to receive quick actions while the app is running - SwiftUI
/// still owns the window.
final class QuickActionSceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        guard let action = QuickAction(rawValue: shortcutItem.type) else {
            completionHandler(false)
            return
        }
        QuickAction.relay.perform(action)
        completionHandler(true)
    }
}
