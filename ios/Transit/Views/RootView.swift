import SwiftUI

/// The 5-tab shell matching the web app's nav (`components/nav.tsx`):
/// Schedule ("/"), Planner ("/plan"), Map ("/stops" + "/vehicles" merged),
/// Alerts ("/alerts"), Settings ("/settings").
struct RootView: View {
    @AppStorage("appearanceMode") private var appearanceModeRaw = AppearanceMode.system.rawValue

    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Schedule", systemImage: "clock") }

            ComingSoonView(title: "Planner", systemImage: "point.topleft.down.curvedto.point.bottomright.up", phase: "Phase 4")
                .tabItem { Label("Planner", systemImage: "point.topleft.down.curvedto.point.bottomright.up") }

            MapTabView()
                .tabItem { Label("Map", systemImage: "map") }

            AlertsTabView()
                .tabItem { Label("Alerts", systemImage: "exclamationmark.bubble") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .preferredColorScheme((AppearanceMode(rawValue: appearanceModeRaw) ?? .system).colorScheme)
    }
}

#Preview {
    RootView()
        .environment(AppEnvironment())
}
