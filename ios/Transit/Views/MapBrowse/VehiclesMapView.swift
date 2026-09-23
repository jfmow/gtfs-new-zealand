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
    @State private var selectedVehicleID: String?
    @State private var pollTask: Task<Void, Never>?
    @State private var recenterTrigger = 0
    @AppStorage("vehicles.showStops") private var showStops = false
    @State private var allStops: [Stop] = []

    var body: some View {
        ZStack(alignment: .top) {
            TransitMapView(
                stops: showStops ? nearbyStops.map(StopAnnotation.init) : [],
                vehicles: vehicles.map(VehicleAnnotation.init),
                camera: .region(center: environment.region.defaultMapCenter, radiusMeters: 15000),
                showsUserLocation: environment.location.isAuthorized,
                onSelectVehicle: { selectedVehicleID = $0 },
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

            // The web's filter bar: mode buttons, then "Show stops".
            HStack(spacing: 8) {
                // Scrolls rather than truncating on narrow phones.
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach([VehicleFilterType.all, .bus, .train, .ferry], id: \.self) { type in
                            let label = type.rawValue.isEmpty ? "All" : type.rawValue
                            Button {
                                typeFilter = type
                            } label: {
                                Text(label.uppercased())
                                    .font(.geist(12, .semibold, relativeTo: .caption))
                                    .tracking(0.6)
                                    .fixedSize()
                            }
                            .buttonStyle(.shad(typeFilter == type ? .default : .secondary, size: .sm))
                            .accessibilityLabel(label)
                            .accessibilityAddTraits(typeFilter == type ? .isSelected : [])
                        }
                    }
                }
                Toggle(isOn: $showStops) {
                    Text("Stops").font(.meta).foregroundStyle(Theme.mutedForeground).fixedSize()
                }
                .toggleStyle(.switch)
                .tint(Theme.primary)
                .fixedSize()
                .accessibilityLabel("Show stops")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.background.opacity(0.92))
        }
        .navigationTitle("Vehicles")
        .navigationBarTitleDisplayMode(.inline)
        .task { await start() }
        .task { environment.location.requestPermission() }
        .onDisappear { pollTask?.cancel() }
        .onChange(of: typeFilter) { _, _ in Task { await refresh() } }
        .task(id: showStops) {
            if showStops, allStops.isEmpty { allStops = (try? await environment.api.stops()) ?? [] }
        }
        .navigationDestination(item: Binding(get: { selectedVehicleID }, set: { selectedVehicleID = $0 })) { tripID in
            VehicleQuickLookView(tripID: tripID)
        }
    }

    private func start() async {
        await refresh()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled, selectedVehicleID == nil else { continue }
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
