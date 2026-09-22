import SwiftUI
import TransitCore

/// A basic live view of one trip - map position + a plain stop list. This is
/// deliberately not the full service tracker (map-first bottom sheet with
/// phase/hysteresis logic, `tracker/panel.tsx`'s parity) - that's Phase 4.
/// This exists so a departures-board row has *somewhere* useful to go in the
/// meantime, and the polling/shape-fetching plumbing it sets up is reused
/// there.
struct VehicleQuickLookView: View {
    let tripID: String

    @Environment(AppEnvironment.self) private var environment
    @State private var vehicle: Vehicle?
    @State private var stopTimes: [StopTimeUpdate] = []
    @State private var shape: RouteShape?
    @State private var errorMessage: String?
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            TransitMapView(
                vehicles: vehicle.map { [VehicleAnnotation(vehicle: $0)] } ?? [],
                polylines: shape.map { [RoutePolylineData(id: tripID, coordinates: $0.geojson.geometry.lineCoordinates, colorHex: $0.color.isEmpty ? (vehicle?.route.color ?? "6b7280") : $0.color)] } ?? [],
                camera: vehicle.map { .region(center: $0.position.coordinate, radiusMeters: 1200) } ?? .none
            )
            .frame(height: 260)

            List {
                if let vehicle {
                    Section {
                        LabeledContent("Route", value: "\(vehicle.route.name) \(vehicle.trip?.headsign ?? "")")
                        if let state = vehicle.state {
                            LabeledContent("Status", value: state)
                        }
                        if vehicle.offCourse {
                            Label("This vehicle appears off course", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                        }
                    }
                }
                if !stopTimes.isEmpty {
                    Section("Stops") {
                        ForEach(stopTimes) { stopTime in
                            HStack {
                                Text(stopTime.parentStopID)
                                    .font(.subheadline)
                                    .strikethrough(stopTime.passed)
                                    .foregroundStyle(stopTime.passed ? .secondary : .primary)
                                Spacer()
                                if stopTime.skipped {
                                    Text("Skipped").font(.caption).foregroundStyle(.red)
                                } else {
                                    Text(stopTime.arrivalTime.date, style: .time).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                } else if let errorMessage {
                    Text(errorMessage).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Live tracking")
        .navigationBarTitleDisplayMode(.inline)
        .task { await start() }
        .onDisappear { pollTask?.cancel() }
    }

    private func start() async {
        async let shapeFetch: () = loadShape()
        await refresh()
        await shapeFetch
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled else { continue }
                await refresh()
            }
        }
    }

    private func refresh() async {
        do {
            async let vehicles = environment.api.liveVehicles(tripIDs: [tripID])
            async let times = environment.api.stopTimes(tripID: tripID)
            vehicle = try await vehicles.first
            stopTimes = try await times
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadShape() async {
        shape = try? await environment.api.routeShape(tripID: tripID)
    }
}
