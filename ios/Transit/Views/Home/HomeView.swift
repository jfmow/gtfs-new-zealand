import SwiftData
import SwiftUI
import TransitCore

/// The Home tab's landing screen - `pages/index.tsx` with no stop
/// selected: stop search, then saved places (one tap to plan a trip
/// there), saved stops, saved trips and the stops near you, stops with live
/// next departures. The map lives on the Stops tab (a
/// map inside this scroll view fought the scroll gesture and duplicated
/// that tab).
struct HomeView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \FavouriteStop.sortOrder) private var favourites: [FavouriteStop]
    @Query(sort: \SavedTrip.sortOrder) private var savedTrips: [SavedTrip]
    @Query(sort: \SavedPlace.sortOrder) private var allPlaces: [SavedPlace]

    @State private var path = NavigationPath()
    @State private var nearbyStops: [Stop] = []
    @State private var isLoadingNearby = false
    @State private var nearbyError: String?
    @State private var showsMoreNearby = false
    @State private var isManagingFavourites = false
    @State private var isManagingTrips = false
    @State private var isManagingPlaces = false
    @State private var placeEditor: PlaceEditorTarget?
    @State private var renaming: FavouriteStop?
    @State private var draftName = ""

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                StopSearchField { query in
                    path.append(BoardDestination(stopQuery: query, title: query))
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)
                .zIndex(1)

                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        if !environment.network.isConnected {
                            StaleDataBanner(isOffline: true, lastUpdated: nil)
                                .padding(.horizontal, 16)
                        }
                        placesSection
                        savedStopsSection
                        savedTripsSection
                        nearbySection
                    }
                    .padding(.top, 4)
                    .padding(.bottom, 24)
                }
                .scrollDismissesKeyboard(.immediately)
                .refreshable { await loadNearby() }
            }
            .groupedPageBackground()
            .navigationTitle(environment.region.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .appToolbar()
            .task { await loadNearby() }
            .onChange(of: environment.location.coordinate == nil) { _, _ in Task { await loadNearby() } }
            // A single registration for the whole stack - registering the
            // same type's navigationDestination more than once per stack is
            // undefined behaviour in SwiftUI.
            .navigationDestination(for: BoardDestination.self) { destination in
                StopBoardView(stopQuery: destination.stopQuery, title: destination.title)
            }
            .sheet(isPresented: $isManagingFavourites) {
                ManageFavouritesSheet().shadSheet(detents: [.medium, .large])
            }
            .sheet(isPresented: $isManagingPlaces) {
                ManagePlacesSheet().shadSheet(detents: [.medium, .large])
            }
            .sheet(item: $placeEditor) { target in
                switch target {
                case .edit(let place):
                    SavedPlaceEditorSheet(place: place).shadSheet(detents: [.large])
                case .add(let name, let icon):
                    SavedPlaceEditorSheet(presetName: name, presetIcon: icon).shadSheet(detents: [.large])
                }
            }
            .sheet(isPresented: $isManagingTrips) {
                ManageTripsSheet { planTrip($0) }.shadSheet(detents: [.large])
            }
            .alert("Rename saved stop", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Display name", text: $draftName)
                Button("Save") {
                    let trimmed = draftName.trimmingCharacters(in: .whitespaces)
                    if !trimmed.isEmpty { renaming?.displayName = trimmed }
                    renaming = nil
                }
                Button("Cancel", role: .cancel) { renaming = nil }
            }
        }
    }

    // MARK: - Places

    private var places: [SavedPlace] { allPlaces.filter { $0.regionSlug == environment.region.slug } }

    private var placesSection: some View {
        HomeSection(title: "Places", count: places.count) {
            if !places.isEmpty {
                Button("Edit") { isManagingPlaces = true }
            }
        } content: {
            SavedPlacesRow(
                places: places,
                onGo: { router.plan(to: $0.plannerLocation) },
                onEdit: { placeEditor = .edit($0) },
                onAdd: { placeEditor = .add(name: $0, icon: $1) }
            )
        }
    }

    // MARK: - Saved stops

    private var savedStopsSection: some View {
        HomeSection(title: "Saved stops", count: favourites.count) {
            if !favourites.isEmpty {
                Button("Edit") { isManagingFavourites = true }
            }
        } content: {
            if favourites.isEmpty {
                HomeHint(systemImage: "star", text: "Tap the star on any stop to keep its departures here.")
                    .padding(.horizontal, 16)
            } else {
                VStack(spacing: 10) {
                    ForEach(favourites, id: \.persistentModelID) { favourite in
                        NavigationLink(value: BoardDestination(stopQuery: favourite.stopID, title: favourite.displayName)) {
                            HomeStopRow(stopQuery: favourite.stopID, title: favourite.displayName) {
                                FavouriteTile(colorHex: favourite.colorHex)
                            }
                            .shadCardBackground()
                        }
                        .buttonStyle(.plain)
                        .contextMenu { favouriteMenu(favourite) }
                        .accessibilityHint("Opens departures. Touch and hold for options.")
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    @ViewBuilder
    private func favouriteMenu(_ favourite: FavouriteStop) -> some View {
        Button {
            draftName = favourite.displayName
            renaming = favourite
        } label: { Label("Rename", systemImage: "pencil") }
        SwatchMenu(selectedHex: favourite.colorHex) { favourite.colorHex = $0 }
        Button { isManagingFavourites = true } label: { Label("Reorder", systemImage: "arrow.up.arrow.down") }
        Divider()
        Button(role: .destructive) { remove(favourite) } label: { Label("Remove from saved", systemImage: "trash") }
    }

    private func remove(_ favourite: FavouriteStop) {
        modelContext.delete(favourite)
        environment.toasts.show("Removed from saved stops")
    }

    // MARK: - Saved trips

    private var savedTripsSection: some View {
        HomeSection(title: "Saved trips", count: savedTrips.count) {
            if !savedTrips.isEmpty {
                Button("Manage") { isManagingTrips = true }
            }
        } content: {
            if savedTrips.isEmpty {
                HomeHint(systemImage: "bookmark", text: "Plan a journey and tap the bookmark to plan it again in one tap.") {
                    Button("Plan a journey") { router.selectedTab = .planner }
                        .buttonStyle(.shad(.outline, size: .sm))
                }
                .padding(.horizontal, 16)
            } else {
                SavedTripsCarousel(trips: savedTrips, onPlan: planTrip, onManage: { isManagingTrips = true })
            }
        }
    }

    private func planTrip(_ trip: SavedTrip) {
        router.plan(savedTrip: trip.persistentModelID)
    }

    // MARK: - Nearby

    private var nearbySection: some View {
        HomeSection(title: "Nearby", liveDot: environment.location.isAuthorized) {
            Button {
                router.mapMode = .stops
                router.selectedTab = .map
            } label: {
                Label("Map", systemImage: "map").labelStyle(.titleAndIcon)
            }
        } content: {
            nearby.padding(.horizontal, 16)
        }
    }

    /// The nearest stops, one per name - a station's platforms come back as
    /// separate stops.
    private var nearestDistinct: [Stop] {
        var seen = Set<String>()
        return nearbyStops.filter { seen.insert($0.stopName).inserted }
    }

    @ViewBuilder
    private var nearby: some View {
        let stops = nearestDistinct
        if !environment.location.isAuthorized {
            HomeHint(systemImage: "location", text: "See live departures from the stops around you.") {
                // Once refused, iOS won't ask again - only Settings can.
                if environment.location.authorizationStatus == .notDetermined {
                    Button("Enable location") { environment.location.requestPermission() }
                        .buttonStyle(.shad(.outline, size: .sm))
                } else if let url = URL(string: UIApplication.openSettingsURLString) {
                    Button("Turn on in Settings") { UIApplication.shared.open(url) }
                        .buttonStyle(.shad(.outline, size: .sm))
                }
            }
        } else if !stops.isEmpty {
            VStack(spacing: 10) {
                ForEach(stops.prefix(showsMoreNearby ? 6 : 3), id: \.stopID) { stop in
                    NavigationLink(value: BoardDestination(stopQuery: stop.boardQuery, title: stop.stopName)) {
                        HomeStopRow(stopQuery: stop.boardQuery, title: stop.stopName, detail: distanceLabel(to: stop)) {
                            StopModeTile(stopType: stop.stopType)
                        }
                        .shadCardBackground()
                    }
                    .buttonStyle(.plain)
                }
                if stops.count > 3 {
                    Button {
                        withAnimation(.snappy) { showsMoreNearby.toggle() }
                    } label: {
                        Label(showsMoreNearby ? "Show fewer" : "Show more nearby stops",
                              systemImage: showsMoreNearby ? "chevron.up" : "chevron.down")
                    }
                    .buttonStyle(.shad(.ghost, size: .sm, fullWidth: true))
                }
            }
        } else if isLoadingNearby || environment.location.coordinate == nil {
            HomeHint(systemImage: "location.magnifyingglass", text: "Finding stops near you...")
        } else if let nearbyError {
            HomeHint(systemImage: "exclamationmark.triangle", text: nearbyError)
        } else {
            HomeHint(systemImage: "mappin.slash", text: "No stops found nearby.")
        }
    }

    private func distanceLabel(to stop: Stop) -> String? {
        guard let here = environment.location.coordinate else { return nil }
        return TimeFormatting.formatDistance(meters: Geo.haversineDistanceMeters(here, stop.coordinate))
    }

    /// Doesn't ask for location itself - first launch explains and asks,
    /// and the "Enable location" hint asks again.
    private func loadNearby() async {
        environment.location.startUpdating()
        guard let coordinate = environment.location.coordinate else { return }
        isLoadingNearby = true
        defer { isLoadingNearby = false }
        do {
            nearbyStops = try await environment.api.closestStops(to: coordinate)
            nearbyError = nil
        } catch {
            nearbyError = error.localizedDescription
        }
    }
}

/// What the place editor sheet is open for.
private enum PlaceEditorTarget: Identifiable {
    case edit(SavedPlace)
    case add(name: String, icon: SavedPlaceIcon)

    var id: String {
        switch self {
        case .edit(let place): "edit-\(place.persistentModelID.hashValue)"
        case .add(let name, let icon): "add-\(name)-\(icon.rawValue)"
        }
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

#Preview {
    HomeView()
        .environment(AppEnvironment())
        .environment(DeepLinkRouter())
        .modelContainer(for: [FavouriteStop.self, SavedTrip.self, SavedPlace.self, ActiveJourney.self, RecentSearchEntry.self], inMemory: true)
}
