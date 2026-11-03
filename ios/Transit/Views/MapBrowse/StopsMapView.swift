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
    /// The tab's Stops / Vehicles switch, drawn on the map with the other
    /// controls.
    var mode: Binding<DeepLinkRouter.MapMode>?

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
        floatingLayout
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

    private var map: some View {
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
            // Applied on the next turn: the map reports the region its
            // camera lands on during a SwiftUI update, and a state write
            // there is dropped - the list stayed on the starting region.
            onVisibleRegionChange: { region in Task { @MainActor in visibleRegion = region } },
            centerOnUserLocationTrigger: recenterTrigger
        )
    }

    // MARK: - Layout

    /// Mode filter as a menu on a round button.
    private var filterMenu: some View {
        Menu {
            Picker("Show", selection: $typeFilter) {
                ForEach(StopType.filterCases, id: \.self) { Text($0 == .all ? "All stops" : "\($0.label) stops").tag($0) }
            }
        } label: {
            Image(systemName: mapFilterIcon(active: typeFilter != .all))
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(typeFilter != .all ? Theme.primary : Theme.foreground)
                .frame(width: 40, height: 40)
                .background(.regularMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Theme.border, lineWidth: 1))
        }
        .accessibilityLabel(typeFilter == .all ? "Filter stops" : "Showing \(typeFilter.label) stops")
    }

    private var mapButtons: some View {
        VStack(spacing: 10) {
            Map3DButton()
            RecenterButton(isAuthorized: environment.location.isAuthorized) { recenterTrigger += 1 }
        }
    }

    /// The map full height with one floating bar on top (Stops / Vehicles,
    /// filter, Settings); a tapped stop's board card at the bottom
    /// (2026-11-03, replacing a top bar + a row of filter pills).
    private var floatingLayout: some View {
        ZStack(alignment: .top) {
            map.ignoresSafeArea()
            HStack(spacing: 8) {
                if let mode { MapModeSwitch(mode: mode) }
                Spacer()
                filterMenu
                MapSettingsButton()
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            // Clear of an open side panel (iPad).
            .padding(.leading, leadingInset)

            if let errorMessage {
                Text(errorMessage)
                    .font(.meta)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.top, 56)
            }

            VStack(alignment: .trailing, spacing: 12) {
                mapButtons
                if let previewStop {
                    boardCard(previewStop, lines: 3)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private func boardCard(_ stop: Stop, lines: Int, closable: Bool = true) -> some View {
        Button {
            onOpenStop(BoardDestination(stopQuery: stop.boardQuery, title: stop.stopName))
        } label: {
            HomeBoardCard(stopQuery: stop.boardQuery, title: stop.stopName, detail: walkLabel(to: stop), lines: lines) {
                HomeModeTile(stopType: stop.stopType)
            }
            .overlay(alignment: .topTrailing) {
                if closable {
                    Button {
                        withAnimation(.spring(duration: 0.3)) { previewStop = nil }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.foreground)
                            .frame(width: 28, height: 28)
                            .background(Theme.card, in: Circle())
                            .overlay(Circle().strokeBorder(Theme.border, lineWidth: 1))
                            .shadow(color: .black.opacity(0.15), radius: 4, y: 1)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .offset(x: 14, y: -14)
                    .accessibilityLabel("Close")
                }
            }
        }
        .buttonStyle(.plain)
        .shadow(color: .black.opacity(closable ? 0.18 : 0), radius: 12, y: 4)
        .accessibilityIdentifier("stop-preview")
    }

    private func walkLabel(to stop: Stop) -> String? {
        guard let here = environment.location.coordinate else { return nil }
        let minutes = max(1, Int((Geo.haversineDistanceMeters(here, stop.coordinate) / 80).rounded()))
        return "\(minutes) min walk"
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
            #if DEBUG
            // `-mapPreviewStop <name>`: open with that stop picked, for screenshots.
            if previewStop == nil, let name = UserDefaults.standard.string(forKey: "mapPreviewStop") {
                previewStop = stops.first { $0.stopName == name }
            }
            #endif
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
