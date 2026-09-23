import MapKit
import SwiftUI
import TransitCore

/// All stops on a map, filterable by mode - `pages/stops.tsx`.
struct StopsMapView: View {
    /// Shown inside another screen (Home) rather than as its own tab: no
    /// nav title of its own.
    var embedded = false

    @Environment(AppEnvironment.self) private var environment
    @State private var stops: [Stop] = []
    @State private var typeFilter: StopType = .all
    @State private var selectedStopID: String?
    @State private var errorMessage: String?
    // Captured once (on first real GPS fix, or the region's default centre
    // if location never becomes available) rather than read live from
    // environment.location.coordinate on every render - GPS updates every
    // few seconds, and re-centring the camera on each one would fight any
    // panning/zooming the person is doing (TransitMapView's own dedupe only
    // catches *identical* repeats, not GPS jitter between fixes).
    @State private var mapCenter: Coordinate?
    // The map's current visible region, from TransitMapView's
    // onVisibleRegionChange. `stops` (below) holds every stop for the
    // region from the API - fine to fetch/hold, but handing the *whole*
    // list to MKMapView as annotations makes MapKit's own accessibility
    // tree walk (VoiceOver, or any other accessibility client) O(thousands)
    // and can hang the main thread for 60s+ regardless of visual
    // clustering, since that walk covers `mapView.annotations`, not just
    // what's rendered on screen. Only stops within/near this get passed
    // down as annotations. See `ios-swiftui-rewrite` memory.
    @State private var visibleRegion: MKCoordinateRegion?
    @State private var recenterTrigger = 0

    var body: some View {
        ZStack(alignment: .top) {
            TransitMapView(
                stops: visibleStops.map(StopAnnotation.init),
                camera: .region(center: mapCenter ?? environment.region.defaultMapCenter, radiusMeters: 6000),
                showsUserLocation: environment.location.isAuthorized,
                onSelectStop: { selectedStopID = $0 },
                onVisibleRegionChange: { visibleRegion = $0 },
                centerOnUserLocationTrigger: recenterTrigger
            )
            .ignoresSafeArea(edges: .bottom)
            .overlay(alignment: .bottomTrailing) {
                RecenterButton(isAuthorized: environment.location.isAuthorized) {
                    recenterTrigger += 1
                }
                .padding(.trailing, 16)
                .padding(.bottom, 24)
            }

            // Mode filters float on the map as pills, as on the web.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(StopType.filterCases, id: \.self) { type in
                        FilterChip(title: type.label, isSelected: typeFilter == type) {
                            typeFilter = type
                        }
                        .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .padding(8)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .padding(.top, 44)
            }
        }
        .if(!embedded) { view in
            view.navigationTitle("Stops").navigationBarTitleDisplayMode(.inline)
        }
        .task { await load() }
        .task { environment.location.requestPermission() }
        .onChange(of: typeFilter) { _, _ in Task { await load() } }
        .onChange(of: environment.location.coordinate) { _, newValue in
            guard mapCenter == nil, let newValue else { return }
            mapCenter = newValue
        }
        .navigationDestination(item: Binding(get: { selectedStop }, set: { selectedStopID = $0?.stopID })) { stop in
            StopBoardView(stopQuery: stop.boardQuery, title: stop.stopName)
        }
    }

    private var selectedStop: Stop? {
        stops.first { $0.stopID == selectedStopID }
    }

    /// A hard ceiling on live annotations, independent of the viewport
    /// filter below - a wide zoom-out over a dense metro area can still put
    /// thousands of stops inside the padded region, and SwiftUI's TabView
    /// constructs every tab's content eagerly (confirmed: the accessibility
    /// hang reproduced *before* the Map tab was ever selected, because
    /// `regionDidChangeAnimated` hadn't fired yet for an off-screen map, so
    /// the old `visibleRegion == nil` fallback returned the full list).
    /// Nearest-N to the map centre if over cap; never the unfiltered list.
    private let maxAnnotatedStops = 400

    /// `stops` filtered to a padded version of `visibleRegion` (2x span, so
    /// panning a little doesn't immediately reveal an empty edge before the
    /// next `regionDidChangeAnimated` callback lands), then capped at
    /// `maxAnnotatedStops`. Before the map has reported a region at all
    /// (including while an off-screen tab hasn't laid out yet), this starts
    /// from the nearest stops to the map centre rather than the full list -
    /// see `maxAnnotatedStops`'s comment for why that matters.
    private var visibleStops: [Stop] {
        let center = mapCenter ?? environment.region.defaultMapCenter

        let candidates: [Stop]
        if let visibleRegion {
            let latPad = visibleRegion.span.latitudeDelta
            let lonPad = visibleRegion.span.longitudeDelta
            let minLat = visibleRegion.center.latitude - latPad
            let maxLat = visibleRegion.center.latitude + latPad
            let minLon = visibleRegion.center.longitude - lonPad
            let maxLon = visibleRegion.center.longitude + lonPad

            candidates = stops.filter {
                $0.stopLat >= minLat && $0.stopLat <= maxLat
                    && $0.stopLon >= minLon && $0.stopLon <= maxLon
            }
        } else {
            candidates = stops
        }

        guard candidates.count > maxAnnotatedStops else { return candidates }

        return candidates
            .sorted { squaredDistance($0.coordinate, center) < squaredDistance($1.coordinate, center) }
            .prefix(maxAnnotatedStops)
            .map { $0 }
    }

    /// Not true distance (no cos-latitude correction) - only used to rank
    /// "nearest to centre" for the annotation cap above, where exactness
    /// doesn't matter.
    private func squaredDistance(_ a: Coordinate, _ b: Coordinate) -> Double {
        let dLat = a.latitude - b.latitude
        let dLon = a.longitude - b.longitude
        return dLat * dLat + dLon * dLon
    }

    private func load() async {
        do {
            stops = try await environment.api.stops(includeChildren: false, type: typeFilter)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// StopType already conforms to Equatable/Hashable/CaseIterable via Swift's
// automatic synthesis (a raw-value enum with no associated values) - only
// the display label is added here.
extension StopType {
    static var filterCases: [StopType] { [.all, .bus, .train, .ferry] }

    var label: String {
        switch self {
        case .all: return "All"
        case .bus: return "Bus"
        case .train: return "Train"
        case .ferry: return "Ferry"
        }
    }
}
