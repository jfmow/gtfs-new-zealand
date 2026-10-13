import SwiftData
import SwiftUI
import TransitCore

/// The Home tab's landing screen: stop search, then one row of shortcuts
/// (saved places and trips - one tap plans a journey), then your saved stops
/// and the stops near you, each with its next departures. The map lives on
/// the Map tab (a map inside this scroll view fought the scroll gesture).
struct HomeView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.modelContext) private var modelContext
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
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
    @State private var isFindingVehicle = false
    @State private var placeEditor: PlaceEditorTarget?
    @State private var renaming: FavouriteStop?
    @State private var draftName = ""

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                StopSearchField(onSelect: { query in
                    path.append(BoardDestination(stopQuery: query, title: query))
                }, focusRequest: router.stopSearchFocusRequest)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)
                .readableContentWidth(contentWidth)
                .zIndex(1)

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if !environment.network.isConnected {
                            StaleDataBanner(isOffline: true, lastUpdated: nil)
                                .padding(.horizontal, 16)
                        }
                        if usesColumns {
                            // Now + go on the left, the stop lists on the right.
                            HStack(alignment: .top, spacing: 8) {
                                VStack(alignment: .leading, spacing: 20) {
                                    shortcutsSection
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                VStack(alignment: .leading, spacing: 24) {
                                    yourStopsSection
                                    nearYouSection
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        } else {
                            shortcutsSection
                            yourStopsSection
                            nearYouSection
                        }
                    }
                    .padding(.top, 4)
                    .padding(.bottom, 24)
                    .readableContentWidth(contentWidth)
                }
                .scrollDismissesKeyboard(.immediately)
                .refreshable { await loadNearby() }
            }
            .groupedPageBackground()
            .navigationTitle(environment.region.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .appToolbar()
            .task {
                #if DEBUG
                seedDemoIfAsked()
                #endif
                await loadNearby()
            }
            .onChange(of: router.stopSearchFocusRequest) { _, _ in path = NavigationPath() }
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
            .sheet(isPresented: $isFindingVehicle) {
                FindMyVehicleSheet().shadSheet(detents: [.medium, .large])
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

    // MARK: - Sections

    private var isNew: Bool { favourites.isEmpty && places.isEmpty && savedTrips.isEmpty }

    @ViewBuilder
    private var shortcutsSection: some View {
        if isNew {
            VStack(alignment: .leading, spacing: 16) {
                if environment.region.hasRealtime {
                    HomeFindVehicleChip { isFindingVehicle = true }
                        .padding(.horizontal, 16)
                }
                setupCard
            }
        } else {
            HomeShortcutsRow(
                places: places,
                trips: savedTrips,
                onFindVehicle: environment.region.hasRealtime ? { isFindingVehicle = true } : nil,
                onGo: { router.plan(to: $0.plannerLocation) },
                onEditPlace: { placeEditor = .edit($0) },
                onManagePlaces: { isManagingPlaces = true },
                onAddPlace: { placeEditor = .add(name: $0, icon: $1) },
                onPlanTrip: planTrip,
                onManageTrips: { isManagingTrips = true }
            )
        }
    }

    private var setupCard: some View {
        HomeSetupCard {
            Button { placeEditor = .add(name: "Home", icon: .home) } label: {
                Label("Add home", systemImage: "house")
            }
            .buttonStyle(.shad(.outline, size: .sm, fullWidth: true))
            if !environment.location.isAuthorized {
                locationButton.buttonStyle(.shad(.outline, size: .sm, fullWidth: true))
            }
            Button {
                router.mapMode = .stops
                router.selectedTab = .map
            } label: {
                Label("Find a stop on the map", systemImage: "map")
            }
            .buttonStyle(.shad(.outline, size: .sm, fullWidth: true))
        }
    }

    @ViewBuilder
    private var locationButton: some View {
        // Once refused, iOS won't ask again - only Settings can.
        if environment.location.authorizationStatus == .notDetermined {
            Button { environment.location.requestPermission() } label: { Label("Turn on location", systemImage: "location") }
        } else if let url = URL(string: UIApplication.openSettingsURLString) {
            Button { UIApplication.shared.open(url) } label: { Label("Turn on location in Settings", systemImage: "location") }
        }
    }

    @ViewBuilder
    private var yourStopsSection: some View {
        if !favourites.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HomeHeading(title: "Your stops") {
                    Button("Edit") { isManagingFavourites = true }
                }
                HomeGroup(items: favourites) { favourite in
                    NavigationLink(value: BoardDestination(stopQuery: favourite.stopID, title: favourite.displayName)) {
                        HomeCompactStopRow(stopQuery: favourite.stopID, title: favourite.displayName) {
                            HomeSavedTile(colorHex: favourite.colorHex)
                        }
                    }
                    .buttonStyle(.plain)
                    .contextMenu { favouriteMenu(favourite) }
                    .accessibilityHint("Opens departures. Touch and hold for options.")
                }
            }
        }
    }

    @ViewBuilder
    private var nearYouSection: some View {
        let stops = nearestDistinct.filter { stop in
            !favourites.contains { $0.stopID == stop.boardQuery }
        }
        if !environment.location.isAuthorized {
            if !isNew {
                VStack(alignment: .leading, spacing: 10) {
                    HomeHeading(title: "Near you") { EmptyView() }
                    HStack(spacing: 12) {
                        Text("See live departures from the stops around you.")
                            .font(.meta)
                            .foregroundStyle(Theme.mutedForeground)
                        Spacer(minLength: 8)
                        locationButton.buttonStyle(.shad(.outline, size: .sm))
                    }
                    .padding(.horizontal, 16)
                }
            }
        } else if !stops.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HomeHeading(title: "Near you", liveDot: true) {
                    Button {
                        router.mapMode = .stops
                        router.selectedTab = .map
                    } label: {
                        Label("Map", systemImage: "map").labelStyle(.titleAndIcon)
                    }
                }
                HomeGroup(items: Array(stops.prefix(showsMoreNearby ? 6 : 3))) { stop in
                    NavigationLink(value: BoardDestination(stopQuery: stop.boardQuery, title: stop.stopName)) {
                        HomeCompactStopRow(stopQuery: stop.boardQuery, title: stop.stopName, detail: distanceLabel(to: stop)) {
                            HomeModeTile(stopType: stop.stopType)
                        }
                    }
                    .buttonStyle(.plain)
                    .contextMenu { nearbyMenu(stop) }
                }
                if stops.count > 3 {
                    Button(showsMoreNearby ? "Show fewer" : "Show more") {
                        withAnimation(.snappy) { showsMoreNearby.toggle() }
                    }
                    .font(.metaMedium)
                    .foregroundStyle(Theme.mutedForeground)
                    .padding(.horizontal, 16)
                }
            }
        } else if isLoadingNearby || environment.location.coordinate == nil {
            nearYouNote("Finding stops near you...")
        } else if let nearbyError {
            nearYouNote(nearbyError)
        } else if nearestDistinct.isEmpty {
            nearYouNote("No stops found nearby.")
        }
    }

    private func nearYouNote(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HomeHeading(title: "Near you") { EmptyView() }
            Text(text).font(.meta).foregroundStyle(Theme.mutedForeground).padding(.horizontal, 16)
        }
    }

    // MARK: - Layout

    /// Regular width (iPad): the sections in two columns across a wider
    /// page, rather than one phone-width column.
    private var usesColumns: Bool { horizontalSizeClass == .regular }
    private var contentWidth: CGFloat { usesColumns ? 1100 : 720 }

    private var places: [SavedPlace] { allPlaces.filter { $0.regionSlug == environment.region.slug } }

    // MARK: - Menus

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

    private func nearbyMenu(_ stop: Stop) -> some View {
        Group {
            if !favourites.contains(where: { $0.stopID == stop.boardQuery }) {
                Button {
                    let order = favourites.count
                    modelContext.insert(FavouriteStop(stopID: stop.boardQuery, displayName: stop.stopName,
                                                      colorHex: Swatches.color(at: order), sortOrder: order))
                    environment.toasts.show("Saved to Home")
                } label: { Label("Save stop", systemImage: "star") }
            }
            Button {
                router.plan(to: PlannerLocation(label: stop.stopName, coordinate: stop.coordinate))
            } label: { Label("Plan a journey here", systemImage: "point.topleft.down.to.point.bottomright.curvepath") }
        }
    }

    private func remove(_ favourite: FavouriteStop) {
        modelContext.delete(favourite)
        environment.toasts.show("Removed from saved stops")
    }

    private func planTrip(_ trip: SavedTrip) {
        router.plan(savedTrip: trip.persistentModelID)
    }

    // MARK: - Nearby

    /// The nearest stops, one per name - a station's platforms come back as
    /// separate stops.
    private var nearestDistinct: [Stop] {
        var seen = Set<String>()
        return nearbyStops.filter { seen.insert($0.stopName).inserted }
    }

    private func distanceLabel(to stop: Stop) -> String? {
        guard let here = environment.location.coordinate else { return nil }
        return TimeFormatting.formatDistance(meters: Geo.haversineDistanceMeters(here, stop.coordinate))
    }

    #if DEBUG
    /// `-seedHomeDemo YES`: Auckland saved stops, places and a trip, for
    /// looking at Home in the simulator.
    private func seedDemoIfAsked() {
        guard UserDefaults.standard.bool(forKey: "seedHomeDemo"), favourites.isEmpty else { return }
        let stops = [("Waitemata Train Station 133", "Britomart"), ("Maungawhau Train Station 136", "Mt Eden station"), ("AUT 7039", "AUT")]
        for (i, stop) in stops.enumerated() {
            modelContext.insert(FavouriteStop(stopID: stop.0, displayName: stop.1, colorHex: Swatches.color(at: i), sortOrder: i))
        }
        let home = Coordinate(latitude: -36.8780, longitude: 174.7610)
        let work = Coordinate(latitude: -36.8485, longitude: 174.7633)
        modelContext.insert(SavedPlace(name: "Home", address: "Mt Eden", coordinate: home, icon: "home", regionSlug: environment.region.slug, sortOrder: 0))
        modelContext.insert(SavedPlace(name: "Work", address: "Queen Street", coordinate: work, icon: "work", regionSlug: environment.region.slug, sortOrder: 1))
        modelContext.insert(SavedTrip(name: "Netball", startLabel: "Home", startCoordinate: home,
                                      endLabel: "Auckland Netball Centre", endCoordinate: Coordinate(latitude: -36.8710, longitude: 174.7430),
                                      colorHex: Swatches.color(at: 4)))
    }
    #endif

    /// Doesn't ask for location itself - first launch explains and asks,
    /// and the "Enable location" hint asks again.
    private func loadNearby() async {
        environment.location.requestFix()
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
        .modelContainer(try! TransitStore.makeContainer(.inMemory))
}
