import SwiftData
import SwiftUI
import TransitCore

/// The Schedule tab's landing screen - `pages/index.tsx` with no stop
/// selected: stop search, favourites and the stops near you, each with
/// live next departures. The map lives on the Stops tab (a map inside this
/// scroll view fought the scroll gesture and duplicated that tab).
struct HomeView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \FavouriteStop.sortOrder) private var favourites: [FavouriteStop]

    @State private var path = NavigationPath()
    @State private var nearbyStops: [Stop] = []
    @State private var isLoadingNearby = false
    @State private var nearbyError: String?
    @State private var isManagingFavourites = false
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
                    VStack(alignment: .leading, spacing: 24) {
                        favouritesSection
                        nearYouSection
                        mapLink
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .scrollDismissesKeyboard(.immediately)
                .refreshable { await loadNearby() }
            }
            .pageBackground()
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
            .alert("Rename favourite", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
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

    // MARK: - Favourites

    private var favouritesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionLabel(text: "Favourites")
                Spacer()
                if !favourites.isEmpty {
                    Button("Edit") { isManagingFavourites = true }
                        .font(.metaMedium)
                        .foregroundStyle(Theme.mutedForeground)
                }
            }
            if favourites.isEmpty {
                Label("Tap the star on any stop to pin it here.", systemImage: "star")
                    .font(.meta)
                    .foregroundStyle(Theme.mutedForeground)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .shadCardBackground()
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(favourites.enumerated()), id: \.element.persistentModelID) { index, favourite in
                        if index > 0 { RowDivider() }
                        NavigationLink(value: BoardDestination(stopQuery: favourite.stopID, title: favourite.displayName)) {
                            HomeStopRow(stopQuery: favourite.stopID, title: favourite.displayName) {
                                FavouriteTile(colorHex: favourite.colorHex)
                            }
                        }
                        .buttonStyle(.plain)
                        .contextMenu { favouriteMenu(favourite) }
                        .accessibilityHint("Opens departures. Touch and hold for options.")
                    }
                }
                .shadCardBackground()
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
        Button(role: .destructive) { remove(favourite) } label: { Label("Remove from favourites", systemImage: "trash") }
    }

    private func remove(_ favourite: FavouriteStop) {
        modelContext.delete(favourite)
        environment.toasts.show("Removed from favourites")
    }

    // MARK: - Near you

    private var nearYouSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Near you", liveDot: true)
            nearYou
        }
    }

    /// Up to three nearest stops, one per name - a station's platforms come
    /// back as separate stops.
    private var nearestDistinct: [Stop] {
        var seen = Set<String>()
        return nearbyStops.filter { seen.insert($0.stopName).inserted }.prefix(3).map { $0 }
    }

    @ViewBuilder
    private var nearYou: some View {
        if !environment.location.isAuthorized {
            Button("Enable location to see stops near you") {
                environment.location.requestPermission()
            }
            .buttonStyle(.shad(.outline, size: .default, fullWidth: true))
        } else if !nearestDistinct.isEmpty {
            VStack(spacing: 0) {
                ForEach(Array(nearestDistinct.enumerated()), id: \.element.stopID) { index, stop in
                    if index > 0 { RowDivider() }
                    NavigationLink(value: BoardDestination(stopQuery: stop.boardQuery, title: stop.stopName)) {
                        HomeStopRow(stopQuery: stop.boardQuery, title: stop.stopName, detail: distanceLabel(to: stop)) {
                            StopModeTile(stopType: stop.stopType)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .shadCardBackground()
        } else if isLoadingNearby {
            Text("Finding stops near you...").font(.meta).foregroundStyle(Theme.mutedForeground)
        } else if let nearbyError {
            Text(nearbyError).font(.meta).foregroundStyle(Theme.mutedForeground)
        } else {
            Text("No stops found nearby.").font(.meta).foregroundStyle(Theme.mutedForeground)
        }
    }

    private var mapLink: some View {
        Button {
            router.selectedTab = .stops
        } label: {
            Label("See stops on the map", systemImage: "map")
        }
        .buttonStyle(.shad(.outline, size: .default, fullWidth: true))
    }

    private func distanceLabel(to stop: Stop) -> String? {
        guard let here = environment.location.coordinate else { return nil }
        return TimeFormatting.formatDistance(meters: Geo.haversineDistanceMeters(here, stop.coordinate))
    }

    private func loadNearby() async {
        environment.location.requestPermission()
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
        .modelContainer(for: [FavouriteStop.self, SavedTrip.self, ActiveJourney.self, RecentSearchEntry.self], inMemory: true)
}
