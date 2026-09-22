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

    var body: some View {
        ZStack(alignment: .top) {
            TransitMapView(
                vehicles: vehicles.map(VehicleAnnotation.init),
                camera: .region(center: environment.region.defaultMapCenter, radiusMeters: 15000),
                onSelectVehicle: { selectedVehicleID = $0 }
            )
            .ignoresSafeArea(edges: .bottom)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach([VehicleFilterType.all, .bus, .train, .ferry], id: \.self) { type in
                        FilterChip(title: type.rawValue.isEmpty ? "All" : type.rawValue, isSelected: typeFilter == type) {
                            typeFilter = type
                        }
                    }
                }
                .padding()
            }
            .background(.ultraThinMaterial)
        }
        .navigationTitle("Vehicles")
        .navigationBarTitleDisplayMode(.inline)
        .task { await start() }
        .onDisappear { pollTask?.cancel() }
        .onChange(of: typeFilter) { _, _ in Task { await refresh() } }
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

    private func refresh() async {
        vehicles = (try? await environment.api.liveVehicles(type: typeFilter)) ?? vehicles
    }
}
