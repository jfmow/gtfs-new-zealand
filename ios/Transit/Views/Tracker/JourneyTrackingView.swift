import SwiftData
import SwiftUI
import TransitCore

/// The live-tracking view for an in-progress journey - map-first, with a
/// phase banner and itinerary below. Wires `JourneyProgressModel` (the
/// ported state machine) to live polling. This is what `JourneyDetailView`'s
/// "Start this journey" opens - Phase 4's static detail view stays as the
/// pre-departure preview.
struct JourneyTrackingView: View {
    let plan: JourneyPlan

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext

    @State private var progressModel = JourneyProgressModel()
    @State private var displayPlan: JourneyPlan
    @State private var vehiclesByTripID: [String: Vehicle] = [:]
    @State private var stopTimesByTripID: [String: [StopTimeUpdate]] = [:]
    @State private var trackedStops: [TripStopRef] = []
    @State private var snapshot: JourneyProgressModel.Snapshot?
    @State private var pollTask: Task<Void, Never>?
    @State private var lastTrackedTripID: String?

    private var accent: Color { Theme.accent(for: environment.region) }

    init(plan: JourneyPlan) {
        self.plan = plan
        _displayPlan = State(initialValue: plan)
    }

    var body: some View {
        ZStack(alignment: .top) {
            TransitMapView(
                vehicles: vehiclesByTripID.values.map(VehicleAnnotation.init),
                polylines: polylines,
                camera: camera
            )
            .ignoresSafeArea()

            phaseBanner
                .padding(.top, 8)
        }
        .safeAreaInset(edge: .bottom) {
            itinerarySheet
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("End", role: .destructive) { endJourney() }
            }
        }
        .task { await start() }
        .onDisappear { pollTask?.cancel() }
        .navigationBarBackButtonHidden()
    }

    // MARK: - Phase banner (the hero of the screen)

    @ViewBuilder
    private var phaseBanner: some View {
        if let snapshot {
            HStack(spacing: 12) {
                Image(systemName: phaseIcon(snapshot.phase))
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(accent, in: Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(phaseLabel(snapshot))
                        .font(.sectionHeading(17))
                    if let stopsAway = snapshot.trackedStopsAway {
                        Text(stopsAway == 0 ? "At the stop" : "\(stopsAway) stop\(stopsAway == 1 ? "" : "s") away")
                            .font(.subheadline)
                            .foregroundStyle(Theme.steel)
                    }
                }

                Spacer()

                trackingLevelBadge(snapshot.trackingLevel)
            }
            .padding(12)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.horizontal)
        }
    }

    private func trackingLevelBadge(_ level: JourneyProgressModel.TrackingLevel) -> some View {
        Text(level == .live ? "Live" : level == .predicted ? "Predicted" : "Scheduled")
            .font(.caption.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(level == .live ? Theme.onTime.opacity(0.15) : Theme.steel.opacity(0.15))
            .foregroundStyle(level == .live ? Theme.onTime : Theme.steel)
            .clipShape(Capsule())
    }

    private func phaseIcon(_ phase: JourneyProgressModel.Phase?) -> String {
        switch phase {
        case .walking: return "figure.walk"
        case .waiting: return "clock"
        case .boarding: return "figure.wave"
        case .onboard: return "tram.fill"
        case nil: return "checkmark"
        }
    }

    private func phaseLabel(_ snapshot: JourneyProgressModel.Snapshot) -> String {
        if snapshot.journeyArrived { return "You've arrived" }
        switch snapshot.phase {
        case .walking: return "Walking"
        case .waiting: return "Waiting"
        case .boarding: return "Boarding now"
        case .onboard: return "On board"
        case nil: return "Tracking"
        }
    }

    // MARK: - Itinerary sheet

    private var itinerarySheet: some View {
        VStack(spacing: 0) {
            Capsule().fill(Theme.hairline).frame(width: 36, height: 5).padding(.vertical, 8)
            List {
                ForEach(Array(displayPlan.legs.enumerated()), id: \.offset) { index, leg in
                    LegRow(leg: leg)
                        .boardRow()
                        .listRowBackground((snapshot?.progressLegIndex == index ? accent.opacity(0.08) : Theme.paper))
                }
            }
            .listStyle(.plain)
            .frame(height: 260)
            .scrollContentBackground(.hidden)
            .background(Theme.paper)
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 8)
    }

    // MARK: - Map

    private var polylines: [RoutePolylineData] {
        guard let features = plan.routeGeoJSON?.features else { return [] }
        return features.enumerated().map { index, feature in
            let mode = feature.properties?["mode"]?.stringValue ?? "walk"
            return RoutePolylineData(id: "leg-\(index)", coordinates: feature.geometry.lineCoordinates, colorHex: mode == "walk" ? "9CA3AF" : environment.region.brandColorHex)
        }
    }

    private var camera: MapCamera {
        guard let snapshot else { return .fitAll }
        if let followID = snapshot.followMarkerID, let tripID = snapshot.trackedTripID, vehiclesByTripID[tripID] != nil {
            return .follow(annotationID: followID)
        }
        if let location = environment.location.coordinate, snapshot.riderWalking {
            return .region(center: location, radiusMeters: 500)
        }
        return .fitAll
    }

    // MARK: - Data

    private func start() async {
        environment.location.requestPermission()
        environment.location.startUpdating()
        await tick()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled else { continue }
                await tick()
            }
        }
    }

    private func tick() async {
        let tripIDs = plan.transitLegs.map(\.tripID)
        async let vehicles = try? environment.api.liveVehicles(tripIDs: tripIDs)
        async let times = fetchStopTimes(tripIDs: tripIDs)
        vehiclesByTripID = Dictionary(uniqueKeysWithValues: (await vehicles ?? []).map { ($0.tripID, $0) })
        stopTimesByTripID = await times

        displayPlan = JourneyPlanLiveAdjuster.buildLiveJourney(plan, stopTimesByTripID: stopTimesByTripID)

        let newSnapshot = progressModel.update(
            plan: plan, displayPlan: displayPlan, now: Date(), vehiclesByTripID: vehiclesByTripID,
            stopTimesByTripID: stopTimesByTripID, journeyStarted: true, trackedStops: trackedStops,
            userLocation: environment.location.coordinate
        )
        snapshot = newSnapshot

        if let tripID = newSnapshot.trackedTripID, tripID != lastTrackedTripID {
            lastTrackedTripID = tripID
            trackedStops = (try? await environment.api.stopsForTrip(tripID: tripID)) ?? []
        }
    }

    private func fetchStopTimes(tripIDs: [String]) async -> [String: [StopTimeUpdate]] {
        var result: [String: [StopTimeUpdate]] = [:]
        for tripID in tripIDs {
            if let times = try? await environment.api.stopTimes(tripID: tripID) {
                result[tripID] = times
            }
        }
        return result
    }

    private func endJourney() {
        pollTask?.cancel()
        if let active = try? modelContext.fetch(FetchDescriptor<ActiveJourney>()).first(where: { $0.planID == plan.id }) {
            modelContext.delete(active)
        }
        dismiss()
    }
}
