import SwiftUI

/// The 5-tab shell matching the web app's nav (`components/nav.tsx`):
/// Schedule ("/"), Planner ("/plan"), Map ("/stops" + "/vehicles" merged),
/// Alerts ("/alerts"), Settings ("/settings"). Each tab beyond Home is a
/// placeholder until its phase lands - see the parity table in the project
/// plan.
struct RootView: View {
    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Schedule", systemImage: "clock") }

            ComingSoonView(title: "Planner", systemImage: "point.topleft.down.curvedto.point.bottomright.up", phase: "Phase 4")
                .tabItem { Label("Planner", systemImage: "point.topleft.down.curvedto.point.bottomright.up") }

            ComingSoonView(title: "Map", systemImage: "map", phase: "Phase 3")
                .tabItem { Label("Map", systemImage: "map") }

            ComingSoonView(title: "Alerts", systemImage: "exclamationmark.bubble", phase: "Phase 3")
                .tabItem { Label("Alerts", systemImage: "exclamationmark.bubble") }

            ComingSoonView(title: "Settings", systemImage: "gearshape", phase: "Phase 6")
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}

#Preview {
    RootView()
        .environment(AppEnvironment())
}
