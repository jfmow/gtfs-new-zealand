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
    /// Set by `JourneyTrackingView` while it's on screen, so the resume
    /// pill doesn't sit on top of the journey it would resume.
    var isTrackingVisible = false
    /// A full-screen map view (the service tracker) is on screen - the
    /// resume pill hides so it doesn't sit over its drawer.
    var isFullScreenMapVisible = false
    /// The journey whose detail screen is showing - it has its own
    /// "Resume tracking" button, so the resume bar hides for that journey.
    var visibleJourneyDetailPlanID: String?
    /// The tracker that's currently open (it stays open while the rider
    /// switches tabs, until End or minimise), and whether it's in a link's
    /// full-screen cover or pushed in the Planner tab. A Live Activity tap
    /// for the same journey goes back to it instead of opening a second
    /// tracker on top.
    var openTracker: (planID: String, inLink: Bool)?

    /// Set by the tracker's "Find a better route from here"; consumed by
    /// `PlannerView`, which re-plans from `origin` and offers to go back.
    var pendingReplan: ReplanRequest?

    /// The step-by-step planner is open (the Planner tab presents it) - set
    /// by its card there, or the "Plan step by step" Home Screen quick action.
    var showsEasyPlanner = false

    func openEasyPlanner() {
        activeLink = nil
        selectedTab = .planner
        showsEasyPlanner = true
    }

    struct ReplanRequest: Equatable {
        let origin: PlannerLocation
        let destination: PlannerLocation
        let departAt: Date
        /// The journey being replaced, for "Keep the route I was on".
        let planID: String
        let regionSlug: String
        let arrivalTime: Date?
    }

    func replan(_ request: ReplanRequest) {
        pendingReplan = request
        activeLink = nil
        selectedTab = .planner
    }

    func resume(planID: String, regionSlug: String) {
        route(.trackJourney(id: planID, region: regionSlug))
    }

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
        if case .trackJourney(let id, _) = link, let open = openTracker, open.planID == id {
            if !open.inLink { selectedTab = .planner }
            return
        }
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
