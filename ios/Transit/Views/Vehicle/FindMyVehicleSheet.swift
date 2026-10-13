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
    /// Route names and colours for the badges - the endpoint only gives ids.
    @State private var routes: [String: Route] = [:]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if isLoading {
                        VStack(spacing: 12) {
                            Image(systemName: "location.viewfinder")
                                .font(.system(size: 28, weight: .medium))
                                .foregroundStyle(Theme.mutedForeground)
                                .symbolEffect(.pulse, isActive: !reduceMotion)
                            Text("Finding vehicles near you...").font(.bodyText).foregroundStyle(Theme.mutedForeground)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    } else if let locationMessage {
                        Label(locationMessage, systemImage: "location.slash")
                            .font(.bodyText).foregroundStyle(Theme.danger)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading).mutedPanel()
                    } else if let loadError {
                        ErrorState(title: "Couldn't find vehicles", error: loadError) { Task { await find() } }
                    } else if vehicles.isEmpty {
                        EmptyState(systemImage: "location.slash", title: "No vehicles near you",
                                   message: "Try again once you're on board - it looks for buses, trains and ferries within a few hundred metres.")
                    } else {
                        Text("Tap the one you're on to follow it live.")
                            .font(.meta)
                            .foregroundStyle(Theme.mutedForeground)
                        VStack(spacing: 0) {
                            ForEach(Array(vehicles.enumerated()), id: \.element.tripID) { index, vehicle in
                                if index > 0 { RowDivider().padding(.leading, 62) }
                                NavigationLink {
                                    VehicleQuickLookView(tripID: vehicle.tripID)
                                } label: {
                                    VehicleRow(vehicle: vehicle, route: routes[vehicle.routeID], isClosest: index == 0)
                                }
                                .buttonStyle(DropdownRowStyle())
                            }
                        }
                        .shadCardBackground(radius: 14)
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
        environment.location.requestFix()
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
            async let found = environment.api.findMyVehicle(near: coordinate)
            async let allRoutes = try? environment.api.routes()
            vehicles = try await found
            if routes.isEmpty { routes = await allRoutes ?? [:] }
        } catch {
            loadError = error
        }
    }
}

/// One vehicle the rider might be on: mode, route badge, where it's going
/// and how far away it is.
private struct VehicleRow: View {
    let vehicle: NearbyVehicle
    let route: Route?
    let isClosest: Bool

    /// "INN-202" -> "INN" when the routes list hasn't loaded.
    private var routeName: String {
        route?.routeShortName ?? String(vehicle.routeID.split(separator: "-").first ?? Substring(vehicle.routeID))
    }

    private var glyph: String {
        switch route?.routeType {
        case 2: "tram.fill"
        case 4: "ferry.fill"
        default: "bus.fill"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Theme.muted)
                .overlay(Image(systemName: glyph).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.foreground))
                .frame(width: 36, height: 36)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    RouteBadge(name: routeName, colorHex: route?.routeColor ?? "", size: 12)
                    if isClosest {
                        Text("Closest").font(.metaMedium).foregroundStyle(Theme.live)
                    }
                }
                Text(TimeFormatting.niceLookingWords(vehicle.tripHeadsign))
                    .font(.bodyMedium)
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 8)
            Text(TimeFormatting.formatDistance(meters: vehicle.distanceFromVehicle))
                .font(.geistMono(13, medium: true, relativeTo: .footnote))
                .foregroundStyle(Theme.mutedForeground)
                .fixedSize()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.mutedForeground.opacity(0.6))
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(routeName) to \(TimeFormatting.niceLookingWords(vehicle.tripHeadsign)), \(TimeFormatting.formatDistance(meters: vehicle.distanceFromVehicle)) away\(isClosest ? ", closest" : "")")
    }
}
