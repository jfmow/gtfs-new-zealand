import SwiftUI
import TransitCore

/// "Find your current vehicle" - `find-closest-vehicle.tsx`: uses the
/// rider's location to list the vehicles they might be on; tapping one opens
/// its live tracker.
struct FindMyVehicleSheet: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss

    @State private var vehicles: [NearbyVehicle] = []
    @State private var isLoading = true
    @State private var loadError: Error?
    @State private var locationMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("We'll use your location to find nearby vehicles you might be on.")
                        .font(.bodyText)
                        .foregroundStyle(Theme.mutedForeground)

                    if isLoading {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Finding nearby vehicles...").font(.bodyText)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                    } else if let locationMessage {
                        Label(locationMessage, systemImage: "location.slash")
                            .font(.bodyText).foregroundStyle(Theme.danger)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading).mutedPanel()
                    } else if let loadError {
                        ErrorState(title: "Couldn't find vehicles", error: loadError) { Task { await find() } }
                    } else if vehicles.isEmpty {
                        EmptyState(systemImage: "mappin.slash", title: "No vehicles found nearby")
                    } else {
                        Text("Are you on one of these vehicles?").font(.bodyMedium)
                        VStack(spacing: 0) {
                            ForEach(Array(vehicles.enumerated()), id: \.element.tripID) { index, vehicle in
                                if index > 0 { RowDivider() }
                                NavigationLink {
                                    VehicleQuickLookView(tripID: vehicle.tripID)
                                } label: {
                                    HStack(spacing: 10) {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(vehicle.routeID).font(.bodyMedium)
                                            Text(TimeFormatting.niceLookingWords(vehicle.tripHeadsign)).font(.meta).foregroundStyle(Theme.mutedForeground)
                                        }
                                        Spacer(minLength: 8)
                                        Label(TimeFormatting.formatDistance(meters: vehicle.distanceFromVehicle), systemImage: "mappin")
                                            .font(.meta).foregroundStyle(Theme.mutedForeground)
                                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
                                    }
                                    .padding(14)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(DropdownRowStyle())
                            }
                        }
                        .shadCardBackground()
                    }
                }
                .padding(16)
            }
            .pageBackground()
            .navigationTitle("Find my vehicle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { await find() }
            .refreshable { await find() }
        }
    }

    private func find() async {
        isLoading = true
        defer { isLoading = false }
        locationMessage = nil
        loadError = nil
        environment.location.requestPermission()
        environment.location.startUpdating()
        var coordinate = environment.location.coordinate
        for _ in 0..<20 where coordinate == nil {
            try? await Task.sleep(for: .milliseconds(500))
            coordinate = environment.location.coordinate
        }
        guard let coordinate else {
            locationMessage = environment.location.isAuthorized
                ? "Location request timed out."
                : "Location access denied. Please enable location permissions."
            return
        }
        do {
            vehicles = try await environment.api.findMyVehicle(near: coordinate)
        } catch {
            loadError = error
        }
    }
}
