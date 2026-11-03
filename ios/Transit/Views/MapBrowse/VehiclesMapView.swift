import SwiftUI
import TransitCore

/// Every live vehicle on a map, filterable by mode - `pages/vehicles.tsx`.
/// Polls every 10s, paused while a vehicle is selected (same as the web
/// page - a moving marker under an open detail view is distracting and
/// wastes the poll).
struct VehiclesMapView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var vehicles: [Vehicle] = []
    @State private var typeFilter: VehicleFilterType = .all
    /// Opens a vehicle's tracker - pushed by value by the owning tab (see
    /// `StopsMapView.onOpenStop`).
    var onOpenVehicle: (String) -> Void = { _ in }
    @State private var recenterTrigger = 0
    @AppStorage("vehicles.showStops") private var showStops = false
    @State private var allStops: [Stop] = []
    /// "Where's my 70?" - only these routes' vehicles, when set.
    @State private var routeFilter: [RouteSearchResult] = []
    @State private var isPickingRoutes = false
    /// The tab's Stops / Vehicles switch, on the map in the new layouts.
    var mode: Binding<DeepLinkRouter.MapMode>?

    private var shownVehicles: [Vehicle] {
        guard !routeFilter.isEmpty else { return vehicles }
        let ids = Set(routeFilter.map(\.routeID))
        let names = Set(routeFilter.map { $0.name.lowercased() })
        return vehicles.filter { ids.contains($0.route.id) || names.contains($0.route.name.lowercased()) }
    }

    var body: some View {
        floatingLayout
        .sheet(isPresented: $isPickingRoutes) {
            RouteSearchSheet(title: "Show routes", selected: $routeFilter)
                .shadSheet(detents: [.medium, .large])
        }
        .navigationTitle("Vehicles")
        .navigationBarTitleDisplayMode(.inline)
        .foregroundPoll(every: .seconds(10), id: 0) { await refresh() }
        .onChange(of: typeFilter) { _, _ in Task { await refresh() } }
        .task(id: showStops) {
            if showStops, allStops.isEmpty { allStops = (try? await environment.api.stops()) ?? [] }
        }
    }

    private var map: some View {
        TransitMapView(
            stops: showStops ? nearbyStops.map(StopAnnotation.init) : [],
            vehicles: shownVehicles.map(VehicleAnnotation.init),
            camera: .region(center: environment.location.coordinate ?? environment.region.defaultMapCenter,
                            radiusMeters: environment.location.coordinate == nil ? 15000 : 3000),
            showsUserLocation: environment.location.isAuthorized,
            onSelectVehicle: { onOpenVehicle($0) },
            centerOnUserLocationTrigger: recenterTrigger
        )
    }

    // MARK: - Layout

    /// Mode, a route search and "show stops" in one menu.
    private var filterMenu: some View {
        let active = typeFilter != .all || !routeFilter.isEmpty || showStops
        return Menu {
            Picker("Show", selection: $typeFilter) {
                ForEach(VehicleFilterType.filterCases, id: \.self) { Text($0.pluralLabel).tag($0) }
            }
            Section {
                Button { isPickingRoutes = true } label: { Label(routeFilter.isEmpty ? "Find a route…" : "Routes: \(routeFilterLabel)", systemImage: "magnifyingglass") }
                if !routeFilter.isEmpty {
                    Button { routeFilter = [] } label: { Label("Show all routes", systemImage: "xmark") }
                }
                Toggle(isOn: $showStops) { Label("Show stops", systemImage: "mappin") }
            }
        } label: {
            Image(systemName: mapFilterIcon(active: active))
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(active ? Theme.primary : Theme.foreground)
                .frame(width: 40, height: 40)
                .background(.regularMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Theme.border, lineWidth: 1))
        }
        .accessibilityLabel("Filter vehicles")
    }

    /// "Routes: 70 ✕" under the bar while a route filter is on.
    @ViewBuilder
    private var routeChip: some View {
        if !routeFilter.isEmpty {
            Button { routeFilter = [] } label: {
                HStack(spacing: 6) {
                    Text("Routes: \(routeFilterLabel)")
                    Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                }
                .font(.metaMedium)
                .foregroundStyle(Theme.primaryForeground)
                .padding(.horizontal, 12)
                .frame(height: 30)
                .background(Theme.primary, in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Showing routes \(routeFilterLabel). Clear")
        }
    }

    private var mapButtons: some View {
        VStack(spacing: 10) {
            Map3DButton()
            RecenterButton(isAuthorized: environment.location.isAuthorized) { recenterTrigger += 1 }
        }
    }

    private var floatingLayout: some View {
        ZStack(alignment: .top) {
            map.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    if let mode { MapModeSwitch(mode: mode) }
                    Spacer()
                    filterMenu
                    MapSettingsButton()
                }
                routeChip
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            mapButtons
                .padding(.trailing, 16)
                .padding(.bottom, 12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            emptyRoutesNote
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    @ViewBuilder
    private var emptyRoutesNote: some View {
        if !routeFilter.isEmpty, shownVehicles.isEmpty, !vehicles.isEmpty {
            Text("None of these routes are running right now")
                .font(.meta)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Theme.popover, in: Capsule())
                .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
                .frame(maxHeight: .infinity)
        }
    }

    private var routeFilterLabel: String {
        switch routeFilter.count {
        case 0: return "Route"
        case 1...3: return routeFilter.map(\.name).joined(separator: ", ")
        default: return "\(routeFilter.count) routes"
        }
    }

    /// The closest 300 stops to the user (or the region's centre) - the
    /// whole network is too many annotations for MapKit to stay smooth.
    private var nearbyStops: [Stop] {
        let center = environment.location.coordinate ?? environment.region.defaultMapCenter
        return Array(allStops.sorted {
            Geo.haversineDistanceMeters($0.coordinate, center) < Geo.haversineDistanceMeters($1.coordinate, center)
        }.prefix(300))
    }

    private func refresh() async {
        vehicles = (try? await environment.api.liveVehicles(type: typeFilter)) ?? vehicles
    }
}

extension VehicleFilterType {
    static var filterCases: [VehicleFilterType] { [.all, .bus, .train, .ferry] }

    /// The same labels as the Stops map's filter.
    var label: String { self == .all ? "All" : rawValue }

    /// Plural label for the vehicle type menu.
    var pluralLabel: String {
        switch self {
        case .all: return "All vehicles"
        case .bus: return "Buses"
        case .train: return "Trains"
        case .ferry: return "Ferries"
        }
    }
}
