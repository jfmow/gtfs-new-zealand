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
                    Section {
                        NavigationLink {
                            StopsMapView()
                        } label: {
                            TransitCard {
                                HStack(spacing: 12) {
                                    CircularBadge(fill: Theme.accent(for: environment.region)) {
                                        Image(systemName: "map.fill").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                                    }
                                    Text("Browse all stops on the map").foregroundStyle(Theme.ink)
                                    Spacer()
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .cardListRow()
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.paper)
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
                Text("No stops found").foregroundStyle(Theme.steel)
            } else {
                ForEach(searchResults) { result in
                    NavigationLink(value: BoardDestination(stopQuery: result.name, title: result.name)) {
                        TransitCard { StopRow(name: result.name, subtitle: result.typeOfStop.capitalized, kind: result.typeOfStop) }
                    }
                    .buttonStyle(.plain)
                    .cardListRow()
                }
            }
        }
        .navigationDestination(for: BoardDestination.self) { destination in
            StopBoardView(stopQuery: destination.stopQuery, title: destination.title)
        }
    }

    private var favouritesSection: some View {
        Section("Favourites") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(favourites) { favourite in
                        NavigationLink(value: BoardDestination(stopQuery: favourite.stopID, title: favourite.displayName)) {
                            VStack(spacing: 8) {
                                CircularBadge(diameter: 52, fill: Color(hex: favourite.colorHex)) {
                                    Text(String(favourite.displayName.prefix(1)))
                                        .font(.system(size: 20, weight: .bold, design: .rounded))
                                        .foregroundStyle(.white)
                                }
                                Text(favourite.displayName)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(Theme.ink)
                                    .lineLimit(1)
                                    .frame(width: 68)
                            }
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Remove", role: .destructive) { modelContext.delete(favourite) }
                        }
                    }
                }
                .padding(.horizontal, 2)
                .padding(.vertical, 4)
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            .padding(.horizontal, 14)
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
                .cardListRow()
            } else if isLoadingNearby, nearbyStops.isEmpty {
                ProgressView()
            } else if let errorMessage {
                Text(errorMessage).foregroundStyle(Theme.steel)
            } else if nearbyStops.isEmpty {
                Text("No stops found nearby").foregroundStyle(Theme.steel)
            } else {
                ForEach(nearbyStops.prefix(6)) { stop in
                    NavigationLink(value: BoardDestination(stopQuery: stop.boardQuery, title: stop.stopName)) {
                        TransitCard { StopRow(name: stop.stopName, subtitle: stop.stopCode, kind: stop.stopType) }
                    }
                    .buttonStyle(.plain)
                    .cardListRow()
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
    var kind: String = "other"

    var body: some View {
        HStack(spacing: 12) {
            CircularBadge(fill: modeColor) {
                Image(systemName: modeIcon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(name).foregroundStyle(Theme.ink)
                Text(subtitle).font(.caption).foregroundStyle(Theme.steel)
            }
            Spacer()
        }
    }

    private var modeIcon: String {
        switch kind {
        case "train": return "tram.fill"
        case "ferry": return "ferry.fill"
        case "bus": return "bus.fill"
        default: return "mappin"
        }
    }

    private var modeColor: Color {
        switch kind {
        case "train": return Color(hex: "0073BD")
        case "ferry": return Color(hex: "2A286B")
        case "bus": return Color(hex: "D52923")
        default: return Theme.steel
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
