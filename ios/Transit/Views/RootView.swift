import SwiftUI

/// The tab shell - the web nav's routes (`components/nav.tsx`): Schedule,
/// Planner, Stops, Vehicles, Alerts. Settings and "My reminders" live in
/// each tab's menu, like the web's header menu, alongside the bell.
struct RootView: View {
    @AppStorage("appearanceMode") private var appearanceModeRaw = AppearanceMode.system.rawValue
    @Environment(DeepLinkRouter.self) private var router
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.selectedTab) {
            HomeView()
                .resumeJourneyInset()
                .tabItem { Label("Schedule", systemImage: "calendar") }
                .tag(DeepLinkRouter.Tab.schedule)

            PlannerView()
                .resumeJourneyInset()
                .tabItem { Label("Planner", systemImage: "point.topleft.down.to.point.bottomright.curvepath") }
                .tag(DeepLinkRouter.Tab.planner)

            StopsTabView()
                .resumeJourneyInset()
                .tabItem { Label("Stops", systemImage: "map") }
                .tag(DeepLinkRouter.Tab.stops)

            VehiclesTabView()
                .resumeJourneyInset()
                .tabItem { Label("Vehicles", systemImage: "bus") }
                .tag(DeepLinkRouter.Tab.vehicles)

            AlertsTabView()
                .resumeJourneyInset()
                .tabItem { Label("Alerts", systemImage: "exclamationmark.triangle") }
                .tag(DeepLinkRouter.Tab.alerts)
        }
        .resumeJourneyAccessory()
        .tint(Theme.primary)
        .font(.bodyText)
        .toastOverlay(environment.toasts)
        .preferredColorScheme((AppearanceMode(rawValue: appearanceModeRaw) ?? .system).colorScheme)
        .task { await environment.notificationFeed.poll() }
        .fullScreenCover(item: Binding(get: { router.activeLink }, set: { router.activeLink = $0 })) { link in
            DeepLinkPresentationView(link: link)
        }
    }
}

#Preview {
    RootView()
        .environment(AppEnvironment())
        .environment(DeepLinkRouter())
}
