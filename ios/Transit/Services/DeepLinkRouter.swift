import Foundation
import TransitCore

/// Routes an opened link - from `TransitApp.onOpenURL` or a tapped push
/// notification. Most links are presented full-screen by `RootView`
/// (`activeLink`); a `/plan?...` prefill instead switches to the Planner tab
/// and hands the form its values (`pendingPlan`), since it's a form to act
/// on rather than a screen to look at.
@MainActor
@Observable
final class DeepLinkRouter {
    enum Tab: Hashable { case schedule, planner, stops, vehicles, alerts }

    var activeLink: DeepLink?
    var selectedTab: Tab = .schedule
    /// Consumed (set back to nil) by `PlannerView` once applied.
    var pendingPlan: PlanPrefill?

    func handle(_ url: URL) {
        guard let link = DeepLink(url: url) else { return }
        route(link)
    }

    /// A push notification's `url` payload - usually a bare web path.
    func handle(notificationURL: String) {
        guard let link = DeepLink(string: notificationURL) else { return }
        route(link)
    }

    private func route(_ link: DeepLink) {
        switch link {
        case .plan(let prefill):
            activeLink = nil
            pendingPlan = prefill
            selectedTab = .planner
        default:
            activeLink = link
        }
    }
}
