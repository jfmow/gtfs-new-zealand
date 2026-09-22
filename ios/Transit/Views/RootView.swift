import SwiftUI

/// The 5-tab shell matching the web app's nav (`components/nav.tsx`):
/// Schedule ("/"), Planner ("/plan"), Map ("/stops" + "/vehicles" merged),
/// Alerts ("/alerts"), Settings ("/settings").
struct RootView: View {
    @AppStorage("appearanceMode") private var appearanceModeRaw = AppearanceMode.system.rawValue
    @Environment(DeepLinkRouter.self) private var router

    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Schedule", systemImage: "clock") }

            PlannerView()
                .tabItem { Label("Planner", systemImage: "point.topleft.down.curvedto.point.bottomright.up") }

            MapTabView()
                .tabItem { Label("Map", systemImage: "map") }

            AlertsTabView()
                .tabItem { Label("Alerts", systemImage: "exclamationmark.bubble") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .preferredColorScheme((AppearanceMode(rawValue: appearanceModeRaw) ?? .system).colorScheme)
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
