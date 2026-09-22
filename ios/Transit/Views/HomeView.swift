import SwiftUI
import TransitCore

/// Phase 2's proof that the whole stack (Region -> APIClient -> Codable
/// models -> SwiftUI) works end-to-end against the live backend. This is
/// deliberately not the real departures-board home screen - that's Phase 3
/// (`components/services/index.tsx`'s parity), including favourites,
/// nearby stops and the stop map.
struct HomeView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var stops: [Stop] = []
    @State private var errorMessage: String?
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(environment.region.displayName)
                .task { await loadStops() }
                .refreshable { await loadStops() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading, stops.isEmpty {
            ProgressView("Loading train stations…")
        } else if let errorMessage {
            ContentUnavailableView(
                "Couldn't load stops",
                systemImage: "wifi.slash",
                description: Text(errorMessage)
            )
        } else {
            List(stops) { stop in
                VStack(alignment: .leading, spacing: 2) {
                    Text(stop.stopName).font(.headline)
                    Text(stop.stopCode).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func loadStops() async {
        isLoading = true
        defer { isLoading = false }
        do {
            stops = try await environment.api.stops(includeChildren: false, type: .train)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    HomeView()
        .environment(AppEnvironment())
}
