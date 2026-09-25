import TransitCore
import UIKit

/// Something outside the app's UI asked it to do - a Home Screen quick
/// action (long-press the icon) or a Siri / Shortcuts intent.
enum AppAction {
    case planJourney
    /// "Go Home": plan from here to a saved place.
    case goTo(name: String, coordinate: Coordinate)

    /// Hands actions to the app once `TransitApp` has set `handler` - a cold
    /// launch delivers the action before any view exists, so it's buffered
    /// and replayed then, like AppDelegate's notification taps.
    @MainActor
    final class Relay {
        var handler: ((AppAction) -> Void)? {
            didSet {
                if let pending, let handler {
                    self.pending = nil
                    handler(pending)
                }
            }
        }

        private var pending: AppAction?

        func perform(_ action: AppAction) {
            if let handler { handler(action) } else { pending = action }
        }
    }

    @MainActor static let relay = Relay()
}

/// The app icon's quick actions: "Plan a journey", then one per saved place
/// in the current region (iOS shows four at most).
enum QuickAction {
    static let planJourneyType = "dev.suddsy.transit.planJourney"
    static let placeType = "dev.suddsy.transit.place"

    static func shortcutItems(places: [SharedStore.SavedPlace]) -> [UIApplicationShortcutItem] {
        let plan = UIApplicationShortcutItem(
            type: planJourneyType, localizedTitle: "Plan a journey", localizedSubtitle: nil,
            icon: UIApplicationShortcutIcon(systemImageName: "point.topleft.down.to.point.bottomright.curvepath")
        )
        let placeItems = places.prefix(3).map { place in
            UIApplicationShortcutItem(
                type: placeType, localizedTitle: "Go to \(place.name)", localizedSubtitle: nil,
                icon: UIApplicationShortcutIcon(systemImageName: place.systemImage),
                userInfo: ["name": place.name as NSString, "lat": place.latitude as NSNumber, "lon": place.longitude as NSNumber]
            )
        }
        return placeItems + [plan]
    }

    static func action(for item: UIApplicationShortcutItem) -> AppAction? {
        switch item.type {
        case planJourneyType:
            return .planJourney
        case placeType:
            guard let name = item.userInfo?["name"] as? String,
                  let lat = (item.userInfo?["lat"] as? NSNumber)?.doubleValue,
                  let lon = (item.userInfo?["lon"] as? NSNumber)?.doubleValue else { return nil }
            return .goTo(name: name, coordinate: Coordinate(latitude: lat, longitude: lon))
        default:
            return nil
        }
    }
}

/// Only here to receive quick actions while the app is running - SwiftUI
/// still owns the window.
final class QuickActionSceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        guard let action = QuickAction.action(for: shortcutItem) else {
            completionHandler(false)
            return
        }
        AppAction.relay.perform(action)
        completionHandler(true)
    }
}
