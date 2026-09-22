import SwiftData
import SwiftUI
import TransitCore

/// The Schedule tab's landing screen - stop search, favourites rail, and
/// nearby stops. Mirrors `pages/index.tsx` (no stop selected state) +
/// `components/stops/favourites.tsx` + `components/home/nearby-stops.tsx`.
struct HomeView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \FavouriteStop.sortOrder) private var favourites: [FavouriteStop]

    @State private var searchText = ""
    @State private var searchResults: [StopSearchResult] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?

    @State private var nearbyStops: [Stop] = []
    @State private var isLoadingNearby = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if !searchText.isEmpty {
                    searchSection
                } else {
                    if !favourites.isEmpty { favouritesSection }
                    nearbySection
                    NavigationLink("Browse all stops on the map") {
                        StopsMapView()
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(environment.region.displayName)
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search stops")
            .onChange(of: searchText) { _, newValue in scheduleSearch(for: newValue) }
            .task { await loadNearby() }
            .refreshable { await loadNearby() }
        }
    }

    // MARK: - Sections

    private var searchSection: some View {
        Section {
            if isSearching, searchResults.isEmpty {
                ProgressView()
            } else if searchResults.isEmpty {
                Text("No stops found").foregroundStyle(.secondary)
            } else {
                ForEach(searchResults) { result in
                    NavigationLink(value: BoardDestination(stopQuery: result.name, title: result.name)) {
                        StopRow(name: result.name, subtitle: result.typeOfStop.capitalized)
                    }
                }
            }
        }
        .navigationDestination(for: BoardDestination.self) { destination in
            StopBoardView(stopQuery: destination.stopQuery, title: destination.title)
        }
    }

    private var favouritesSection: some View {
        Section("Favourites") {
            ForEach(favourites) { favourite in
                NavigationLink(value: BoardDestination(stopQuery: favourite.stopID, title: favourite.displayName)) {
                    HStack {
                        Circle().fill(Color(hex: favourite.colorHex)).frame(width: 10, height: 10)
                        Text(favourite.displayName)
                    }
                }
            }
            .onDelete { offsets in
                for index in offsets { modelContext.delete(favourites[index]) }
            }
        }
        .navigationDestination(for: BoardDestination.self) { destination in
            StopBoardView(stopQuery: destination.stopQuery, title: destination.title)
        }
    }

    @ViewBuilder
    private var nearbySection: some View {
        Section("Near you") {
            if !environment.location.isAuthorized {
                Button("Allow location to see nearby stops") {
                    environment.location.requestPermission()
                }
            } else if isLoadingNearby, nearbyStops.isEmpty {
                ProgressView()
            } else if let errorMessage {
                Text(errorMessage).foregroundStyle(.secondary)
            } else if nearbyStops.isEmpty {
                Text("No stops found nearby").foregroundStyle(.secondary)
            } else {
                ForEach(nearbyStops.prefix(6)) { stop in
                    NavigationLink(value: BoardDestination(stopQuery: stop.boardQuery, title: stop.stopName)) {
                        StopRow(name: stop.stopName, subtitle: stop.stopCode)
                    }
                }
            }
        }
        .navigationDestination(for: BoardDestination.self) { destination in
            StopBoardView(stopQuery: destination.stopQuery, title: destination.title)
        }
    }

    // MARK: - Data

    private func scheduleSearch(for query: String) {
        searchTask?.cancel()
        guard query.count >= 2 else {
            searchResults = []
            return
        }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            isSearching = true
            defer { isSearching = false }
            do {
                let results = try await environment.api.findStop(matching: query)
                guard !Task.isCancelled else { return }
                searchResults = results
            } catch {
                searchResults = []
            }
        }
    }

    private func loadNearby() async {
        environment.location.requestPermission()
        environment.location.startUpdating()
        guard let coordinate = environment.location.coordinate ?? fallbackCoordinate() else { return }
        isLoadingNearby = true
        defer { isLoadingNearby = false }
        do {
            nearbyStops = try await environment.api.closestStops(to: coordinate)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func fallbackCoordinate() -> Coordinate? {
        environment.location.isAuthorized ? nil : environment.region.defaultMapCenter
    }
}

/// A stop-board navigation target - carries the exact query string
/// `/services/{stop}` expects (see `Stop.boardQuery`) plus a display title,
/// since a `StopSearchResult`'s `name` already is that query string while a
/// `Stop`'s isn't.
struct BoardDestination: Hashable {
    let stopQuery: String
    let title: String
}

struct StopRow: View {
    let name: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name)
            Text(subtitle).font(.caption).foregroundStyle(.secondary)
        }
    }
}

extension Color {
    init(hex: String) {
        self.init(uiColor: UIColor(hex: hex))
    }
}

#Preview {
    HomeView()
        .environment(AppEnvironment())
        .modelContainer(for: [FavouriteStop.self, SavedTrip.self, ActiveJourney.self, RecentSearchEntry.self], inMemory: true)
}
