import MapKit
import SwiftUI
import TransitCore

/// All stops on a map, filterable by mode - `pages/stops.tsx`.
struct StopsMapView: View {
    /// Shown inside another screen (Home) rather than as its own tab: no
    /// nav title of its own.
    var embedded = false
    /// Opens a stop's board. The owning screen pushes it onto its own
    /// stack by value - a push from here via `navigationDestination(item:)`
    /// mixed with the board's own value-based pushes made the service
    /// tracker render *behind* the board.
    var onOpenStop: (BoardDestination) -> Void = { _ in }
    /// A tapped stop opens straight away rather than previewing in a card -
    /// set when the board shows in a side panel beside the map (iPad).
    var opensStopDirectly = false
    /// Room kept clear on the leading edge (an open side panel).
    var leadingInset: CGFloat = 0

    @Environment(AppEnvironment.self) private var environment
    @State private var stops: [Stop] = []
    @State private var typeFilter: StopType = .all
    @State private var errorMessage: String?
    /// Tapped stop, previewed in a card over the map (next departures) -
    /// tap the card to open its board.
    @State private var previewStop: Stop?
    // Captured once (on first real GPS fix, or the region's default centre
    // if location never becomes available) rather than read live from
    // environment.location.coordinate on every render - GPS updates every
    // few seconds, and re-centring the camera on each one would fight any
    // panning/zooming the person is doing (TransitMapView's own dedupe only
    // catches *identical* repeats, not GPS jitter between fixes).
    // Once set, the map opens zoomed in on it (~800 m across - a few stops
    // either side) rather than the region-wide default view.
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
                camera: mapCenter.map { .region(center: $0, radiusMeters: 800) }
                    ?? .region(center: environment.region.defaultMapCenter, radiusMeters: 6000),
                showsUserLocation: environment.location.isAuthorized,
                onSelectStop: { id in
                    guard let stop = stops.first(where: { $0.stopID == id }) else { return }
                    if opensStopDirectly {
                        previewStop = nil
                        onOpenStop(BoardDestination(stopQuery: stop.boardQuery, title: stop.stopName))
                    } else {
                        withAnimation(.spring(duration: 0.3)) { previewStop = stop }
                    }
                },
                onVisibleRegionChange: { visibleRegion = $0 },
                centerOnUserLocationTrigger: recenterTrigger
            )
            .ignoresSafeArea(edges: .bottom)

            // Not an overlay on the map: the map runs under the bottom safe
            // area (tab bar, resume pill), and these must sit above it.
            VStack(alignment: .trailing, spacing: 12) {
                RecenterButton(isAuthorized: environment.location.isAuthorized) {
                    recenterTrigger += 1
                }
                if let previewStop {
                    previewCard(previewStop)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)

            // Mode filters float on the map as pills, as on the web.
            MapModeFilterBar(modes: StopType.filterCases, label: \.label, selection: $typeFilter)
                .padding(.leading, leadingInset)

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
        .onChange(of: typeFilter) { _, _ in Task { await load() } }
        // `initial: true` - the fix is often already in hand (Home asked
        // for location first), and then it never "changes" after appear.
        .onChange(of: environment.location.coordinate, initial: true) { _, newValue in
            guard mapCenter == nil, let newValue else { return }
            mapCenter = newValue
        }
    }

    private func previewCard(_ stop: Stop) -> some View {
        HStack(alignment: .top, spacing: 0) {
            Button {
                onOpenStop(BoardDestination(stopQuery: stop.boardQuery, title: stop.stopName))
            } label: {
                HomeStopRow(stopQuery: stop.boardQuery, title: stop.stopName, detail: stop.stopCode.isEmpty ? nil : "Stop \(stop.stopCode)") {
                    StopModeTile(stopType: stop.stopType)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("stop-preview")
            .accessibilityHint("Opens departures")

            // Inside the card (not hanging off its corner) so it's always
            // tappable.
            Button {
                withAnimation(.spring(duration: 0.3)) { previewStop = nil }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.mutedForeground)
                    .frame(width: 26, height: 26)
                    .background(Theme.muted, in: Circle())
                    .frame(width: 40, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 2)
            .accessibilityLabel("Close")
        }
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusXL, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusXL, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.25), radius: 12, y: 4)
    }

    /// A hard ceiling on live annotations, independent of the viewport
    /// filter below - a wide zoom-out over a dense metro area can still put
    /// thousands of stops inside the padded region, and SwiftUI's TabView
    /// constructs every tab's content eagerly (confirmed: the accessibility
    /// hang reproduced *before* the Map tab was ever selected, because
    /// `regionDidChangeAnimated` hadn't fired yet for an off-screen map, so
    /// the old `visibleRegion == nil` fallback returned the full list).
    /// On-screen stops first if over cap (see `visibleStops`); never the
    /// unfiltered list.
    private let maxAnnotatedStops = 400

    /// The stops to hand the map: everything actually on screen first, then
    /// a margin around it (the region's span again on each side, so a
    /// short pan doesn't reveal an empty edge before the next region
    /// report), capped at `maxAnnotatedStops`.
    ///
    /// Two past bugs live here: the cap used to keep the stops nearest the
    /// map's *starting* centre, so after panning, the stops on screen were
    /// the ones dropped; and zoomed out, "nearest to the centre" left the
    /// screen's edges empty. Now anything on screen wins over the margin,
    /// and when even the on-screen stops are over the cap they're thinned
    /// evenly across the screen (`spreadEvenly`).
    ///
    /// Before the map has reported a region at all (an off-screen tab that
    /// hasn't laid out), the nearest stops to the map centre - never the
    /// unfiltered list; see `maxAnnotatedStops`.
    private var visibleStops: [Stop] {
        guard let visibleRegion else {
            let center = mapCenter ?? environment.region.defaultMapCenter
            return nearest(stops, to: center, limit: maxAnnotatedStops)
        }

        let center = Coordinate(latitude: visibleRegion.center.latitude, longitude: visibleRegion.center.longitude)
        let span = visibleRegion.span
        func contains(_ stop: Stop, scale: Double) -> Bool {
            abs(stop.stopLat - center.latitude) <= span.latitudeDelta * scale
                && abs(stop.stopLon - center.longitude) <= span.longitudeDelta * scale
        }

        var onScreen: [Stop] = []
        var margin: [Stop] = []
        for stop in stops {
            // 0.55, not 0.5: a stop just past the edge still has half its
            // marker on screen.
            if contains(stop, scale: 0.55) {
                onScreen.append(stop)
            } else if contains(stop, scale: 1) {
                margin.append(stop)
            }
        }

        guard onScreen.count < maxAnnotatedStops else {
            return spreadEvenly(onScreen, span: span, limit: maxAnnotatedStops)
        }
        return onScreen + nearest(margin, to: center, limit: maxAnnotatedStops - onScreen.count)
    }

    private func nearest(_ stops: [Stop], to center: Coordinate, limit: Int) -> [Stop] {
        guard stops.count > limit else { return stops }
        return Array(stops.sorted { squaredDistance($0.coordinate, center) < squaredDistance($1.coordinate, center) }.prefix(limit))
    }

    /// Up to `limit` stops spread across the screen: bucketed into a grid
    /// about 16 cells across, then taken one per cell in turn. The grid is
    /// anchored to fixed coordinates (a power-of-two cell size), so at one
    /// zoom level panning keeps picking the same stops instead of
    /// reshuffling markers on every region report.
    private func spreadEvenly(_ stops: [Stop], span: MKCoordinateSpan, limit: Int) -> [Stop] {
        func cellSize(_ delta: Double) -> Double { pow(2, (log2(max(delta, 1e-6) / 16)).rounded(.down)) }
        let latCell = cellSize(span.latitudeDelta)
        let lonCell = cellSize(span.longitudeDelta)

        struct Cell: Hashable { let x: Int; let y: Int }
        var buckets: [Cell: [Stop]] = [:]
        for stop in stops {
            let cell = Cell(x: Int((stop.stopLon / lonCell).rounded(.down)), y: Int((stop.stopLat / latCell).rounded(.down)))
            buckets[cell, default: []].append(stop)
        }
        // Stable orders, so the same stops win each time.
        let cells = buckets.keys.sorted { ($0.y, $0.x) < ($1.y, $1.x) }
        let queues = cells.map { buckets[$0]!.sorted { $0.stopID < $1.stopID } }

        var picked: [Stop] = []
        picked.reserveCapacity(limit)
        var round = 0
        while picked.count < limit {
            var tookAny = false
            for index in queues.indices where round < queues[index].count {
                picked.append(queues[index][round])
                tookAny = true
                if picked.count == limit { break }
            }
            if !tookAny { break }
            round += 1
        }
        return picked
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
