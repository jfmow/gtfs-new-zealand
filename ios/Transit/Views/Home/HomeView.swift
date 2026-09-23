import SwiftData
import SwiftUI
import TransitCore

/// The Schedule tab's landing screen - `pages/index.tsx` with no stop
/// selected: stop search, the favourites rail, the nearest stop's next
/// departures ("Near you"), and the stops map filling the rest.
struct HomeView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \FavouriteStop.sortOrder) private var favourites: [FavouriteStop]

    @State private var path = NavigationPath()
    @State private var nearbyStops: [Stop] = []
    @State private var isLoadingNearby = false
    @State private var nearbyError: String?

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
                    VStack(alignment: .leading, spacing: 18) {
                        if !favourites.isEmpty { favouritesRail }

                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: "Near you", liveDot: true)
                            nearYou
                        }
                        .padding(.horizontal, 16)

                        StopsMapView(embedded: true, onOpenStop: { path.append($0) })
                            .frame(height: 420)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
                            .padding(.horizontal, 16)
                            .padding(.bottom, 16)
                    }
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
        }
    }

    // MARK: - Favourites

    private var favouritesRail: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Favourites").padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(favourites.enumerated()), id: \.element.persistentModelID) { index, favourite in
                        NavigationLink(value: BoardDestination(stopQuery: favourite.stopID, title: favourite.displayName)) {
                            FavouriteCard(
                                favourite: favourite,
                                canMoveLeft: index > 0,
                                canMoveRight: index < favourites.count - 1,
                                onMove: { move(from: index, by: $0) },
                                onRemove: { remove(favourite) }
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 2)
            }
        }
    }

    private func move(from index: Int, by offset: Int) {
        var ordered = favourites
        let target = index + offset
        guard ordered.indices.contains(target) else { return }
        ordered.swapAt(index, target)
        for (i, favourite) in ordered.enumerated() { favourite.sortOrder = i }
    }

    private func remove(_ favourite: FavouriteStop) {
        modelContext.delete(favourite)
        environment.toasts.show("Removed from favourites")
    }

    // MARK: - Near you

    @ViewBuilder
    private var nearYou: some View {
        if !environment.location.isAuthorized {
            Button("Enable location to see stops near you") {
                environment.location.requestPermission()
            }
            .buttonStyle(.shad(.outline, size: .sm))
        } else if let nearest = nearbyStops.first {
            NavigationLink(value: BoardDestination(stopQuery: nearest.boardQuery, title: nearest.stopName)) {
                StopPreviewCard(
                    stopQuery: nearest.boardQuery,
                    label: nearest.stopName,
                    code: nearbyStops.dropFirst().contains { $0.stopName == nearest.stopName } ? nearest.stopCode : nil,
                    meta: distanceLabel(to: nearest)
                )
            }
            .buttonStyle(.plain)
        } else if isLoadingNearby {
            Text("Finding stops near you...").font(.meta).foregroundStyle(Theme.mutedForeground)
        } else if let nearbyError {
            Text(nearbyError).font(.meta).foregroundStyle(Theme.mutedForeground)
        } else {
            Text("No stops found nearby.").font(.meta).foregroundStyle(Theme.mutedForeground)
        }
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
