import SwiftUI

/// A placeholder for a tab whose real screen hasn't been built yet - keeps
/// the 5-tab shell honest about what exists versus what's still planned,
/// rather than hiding unbuilt tabs.
struct ComingSoonView: View {
    let title: String
    let systemImage: String
    let phase: String

    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                title,
                systemImage: systemImage,
                description: Text("Coming in \(phase) of the SwiftUI rewrite.")
            )
            .navigationTitle(title)
        }
    }
}

#Preview {
    ComingSoonView(title: "Planner", systemImage: "point.topleft.down.curvedto.point.bottomright.up", phase: "Phase 4")
}
