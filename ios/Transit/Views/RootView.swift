import SwiftData
import SwiftUI
import TransitCore
import WidgetKit

/// The tab shell - the web nav's routes (`components/nav.tsx`): Home,
/// Planner, Map (the web's Stops and Vehicles pages, switched in its nav
/// bar), Alerts. Settings and "My reminders" live in
/// each tab's menu, like the web's header menu, alongside the bell.
struct RootView: View {
    @AppStorage("appearanceMode") private var appearanceModeRaw = AppearanceMode.system.rawValue
    @Environment(DeepLinkRouter.self) private var router
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.modelContext) private var modelContext
    @AppStorage("hasOnboarded") private var hasOnboarded = false
    @Query(sort: \FavouriteStop.sortOrder) private var favourites: [FavouriteStop]
    @Query(sort: \SavedPlace.sortOrder) private var places: [SavedPlace]

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.selectedTab) {
            HomeView()
                .resumeJourneyInset()
                .tabItem { Label("Home", systemImage: "house") }
                .tag(DeepLinkRouter.Tab.schedule)

            PlannerTab()
                .resumeJourneyInset()
                .tabItem { Label("Planner", systemImage: "point.topleft.down.to.point.bottomright.curvepath") }
                .tag(DeepLinkRouter.Tab.planner)

            MapTabView()
                .resumeJourneyInset()
                .tabItem { Label("Map", systemImage: "map") }
                .tag(DeepLinkRouter.Tab.map)

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
        // A journey still on from before the app was closed carries on
        // tracking (from its saved offline data) straight away.
        .task { environment.journey.restoreIfNeeded(modelContext: modelContext, region: environment.region) }
        // Widgets, Siri and the icon's quick actions can't read SwiftData -
        // they get a copy through the app group.
        .onChange(of: sharedSnapshot, initial: true) { _, snapshot in
            SharedStore.savedStops = snapshot.stops
            SharedStore.savedPlaces = snapshot.places
            UIApplication.shared.shortcutItems = QuickAction.shortcutItems(places: SharedStore.placesInRegion)
            WidgetCenter.shared.reloadAllTimelines()
            // Siri's "next departures from <stop>" phrases list the stops.
            TransitShortcuts.updateAppShortcutParameters()
        }
        .onAppear {
            // Someone who used the app before first-launch setup existed
            // doesn't need walking through it.
            if !hasOnboarded, !favourites.isEmpty || !places.isEmpty || environment.location.isAuthorized || environment.push.isAuthorized {
                hasOnboarded = true
            }
        }
        .fullScreenCover(isPresented: Binding(get: { !hasOnboarded }, set: { if !$0 { hasOnboarded = true } })) {
            OnboardingView { hasOnboarded = true }
                .environment(environment)
                .interactiveDismissDisabled()
        }
        .fullScreenCover(item: Binding(get: { router.activeLink }, set: { router.activeLink = $0 })) { link in
            DeepLinkPresentationView(link: link)
        }
    }
}

private struct SharedSnapshot: Equatable {
    let region: String
    let stops: [SharedStore.SavedStop]
    let places: [SharedStore.SavedPlace]
}

extension RootView {
    /// Everything the app group mirrors - `onChange` rewrites it (and
    /// reloads widgets) only when this actually changes.
    private var sharedSnapshot: SharedSnapshot {
        SharedSnapshot(
            region: environment.region.slug,
            stops: favourites.map { SharedStore.SavedStop(query: $0.stopID, title: $0.displayName, colorHex: $0.colorHex) },
            places: places.map {
                SharedStore.SavedPlace(name: $0.name, latitude: $0.latitude, longitude: $0.longitude,
                                       systemImage: $0.placeIcon.systemImage, regionSlug: $0.regionSlug)
            }
        )
    }
}

#Preview {
    RootView()
        .environment(AppEnvironment())
        .environment(DeepLinkRouter())
}
