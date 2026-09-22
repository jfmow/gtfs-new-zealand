import Foundation
import TransitCore

/// Holds the most recently opened deep link so a view can present it -
/// `TransitApp.onOpenURL` writes to this, `RootView` presents from it.
@MainActor
@Observable
final class DeepLinkRouter {
    var activeLink: DeepLink?

    func handle(_ url: URL) {
        guard let link = DeepLink(url: url) else { return }
        activeLink = link
    }
}
