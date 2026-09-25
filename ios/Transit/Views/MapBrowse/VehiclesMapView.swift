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
    @State private var pollTask: Task<Void, Never>?
    @State private var recenterTrigger = 0
    @AppStorage("vehicles.showStops") private var showStops = false
    @State private var allStops: [Stop] = []
    /// "Where's my 70?" - only these routes' vehicles, when set.
    @State private var routeFilter: [RouteSearchResult] = []
    @State private var isPickingRoutes = false

    private var shownVehicles: [Vehicle] {
        guard !routeFilter.isEmpty else { return vehicles }
        let ids = Set(routeFilter.map(\.routeID))
        let names = Set(routeFilter.map { $0.name.lowercased() })
        return vehicles.filter { ids.contains($0.route.id) || names.contains($0.route.name.lowercased()) }
    }

    var body: some View {
        ZStack(alignment: .top) {
            TransitMapView(
                stops: showStops ? nearbyStops.map(StopAnnotation.init) : [],
                vehicles: shownVehicles.map(VehicleAnnotation.init),
                camera: .region(center: environment.region.defaultMapCenter, radiusMeters: 15000),
                showsUserLocation: environment.location.isAuthorized,
                onSelectVehicle: { onOpenVehicle($0) },
                centerOnUserLocationTrigger: recenterTrigger
            )
            .ignoresSafeArea(edges: .bottom)

            // Above the bottom safe area (tab bar, resume pill), not in it.
            RecenterButton(isAuthorized: environment.location.isAuthorized) {
                recenterTrigger += 1
            }
            .padding(.trailing, 16)
            .padding(.bottom, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)

            // Same floating pills as the Stops map, then the route search
            // and "Stops" as chips of their own.
            MapModeFilterBar(modes: VehicleFilterType.filterCases, label: \.label, selection: $typeFilter) {
                Rectangle().fill(Theme.border).frame(width: 1, height: 20).padding(.horizontal, 2)
                routeFilterChips
                Chip(label: "Stops", isActive: showStops, systemImage: "mappin") { showStops.toggle() }
                    .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
                    .accessibilityLabel("Show stops")
            }
        }
        .overlay {
            if !routeFilter.isEmpty, shownVehicles.isEmpty, !vehicles.isEmpty {
                Text("None of these routes are running right now")
                    .font(.meta)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Theme.popover, in: Capsule())
                    .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
            }
        }
        .sheet(isPresented: $isPickingRoutes) {
            RouteSearchSheet(title: "Show routes", selected: $routeFilter)
                .shadSheet(detents: [.medium, .large])
        }
        .navigationTitle("Vehicles")
        .navigationBarTitleDisplayMode(.inline)
        .task { await start() }
        .onDisappear { pollTask?.cancel() }
        .onChange(of: typeFilter) { _, _ in Task { await refresh() } }
        .task(id: showStops) {
            if showStops, allStops.isEmpty { allStops = (try? await environment.api.stops()) ?? [] }
        }
    }

    /// "Route" until routes are picked, then their names and a clear chip.
    @ViewBuilder
    private var routeFilterChips: some View {
        Chip(label: routeFilterLabel, isActive: !routeFilter.isEmpty, systemImage: "magnifyingglass") {
            isPickingRoutes = true
        }
        .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
        .accessibilityLabel(routeFilter.isEmpty ? "Find a route" : "Routes: \(routeFilterLabel)")
        if !routeFilter.isEmpty {
            Chip(label: "Clear", isActive: false, systemImage: "xmark") { routeFilter = [] }
                .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
                .accessibilityLabel("Show all routes")
        }
    }

    private var routeFilterLabel: String {
        switch routeFilter.count {
        case 0: return "Route"
        case 1...3: return routeFilter.map(\.name).joined(separator: ", ")
        default: return "\(routeFilter.count) routes"
        }
    }

    private func start() async {
        await refresh()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled else { continue }
                await refresh()
            }
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
}
