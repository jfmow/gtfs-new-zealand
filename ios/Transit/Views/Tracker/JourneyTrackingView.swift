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
    @Environment(DeepLinkRouter.self) private var router
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

    // Turn-by-turn walking directions for whichever leg is currently a walk
    // - matches the web's `Navigate` component in `liveMode`
    // (`components/map/navigate.tsx` + `useNavigationTracker`), which this
    // is a straight port of. Fetched once per walking leg (`walkLegIndex`
    // tracks which one, so a re-fetch only happens when it changes) and
    // advanced by `walkTracker` on every location update.
    @State private var walkDirections: WalkingDirections?
    @State private var walkLegIndex: Int?
    @State private var walkStep: WalkNavigationTracker.Snapshot?
    private let walkTracker = WalkNavigationTracker()

    @State private var recenterTrigger = 0
    /// The itinerary drawer's own detent - previously a fixed
    /// `.safeAreaInset`, which meant it could neither be dragged to resize
    /// nor properly claim touches from whatever the map happened to be
    /// doing underneath it (that inconsistent hit-testing is what "the
    /// drawer can't be used" turned out to be, on top of the tab-bar
    /// z-order bug fixed earlier). A real `.sheet` with detents gives it
    /// native drag-to-resize and correct gesture ownership, same as the
    /// web's own map-first bottom sheet.
    @State private var sheetDetent: PresentationDetent = .height(340)
    /// Real, dismissible state - NOT `.constant(true)`. A constant binding
    /// can never tell the sheet it's going away, so when this whole view
    /// gets popped (back button or `endJourney()`'s `dismiss()`), SwiftUI's
    /// own pop transition and the "always presented" sheet fought each
    /// other: the sheet's last frame stayed ghosted on screen, composited
    /// over whatever view got pushed onto afterwards (reported as "the
    /// journey tracker UI is broken", screenshot showed the itinerary sheet
    /// bleeding through onto the Planner list behind it). Fixed 2026-09-23
    /// by giving it a real binding and explicitly clearing it before
    /// `dismiss()`.
    @State private var isTrackerSheetPresented = true

    // In-app get-on/off alerts - port of `use-journey-alerts.ts`. The
    // evaluator (a plain class) keeps its own fired-keys history across
    // ticks; `alertStack` is the SwiftUI-visible copy, refreshed after
    // every `evaluate()` call (same "class computes, @State mirrors"
    // pattern as `progressModel`/`snapshot` elsewhere in this view).
    private let alertCenter = JourneyAlertCenter()
    @State private var alertStack: [JourneyAlert] = []

    /// The web tracker's "live" blue for the current leg/step.
    private var accent: Color { Theme.live }

    init(plan: JourneyPlan) {
        self.plan = plan
        _displayPlan = State(initialValue: plan)
    }

    var body: some View {
        ZStack(alignment: .top) {
            TransitMapView(
                vehicles: vehiclesByTripID.values.map(VehicleAnnotation.init),
                waypoints: waypoints,
                polylines: polylines,
                camera: camera,
                showsUserLocation: true,
                centerOnUserLocationTrigger: recenterTrigger
            )
            .ignoresSafeArea()

            VStack(spacing: 8) {
                topBar
                JourneyAlertOverlay(alerts: alertStack) { id in
                    alertCenter.dismiss(id)
                    alertStack = alertCenter.stack
                }
                // Only the walking step card floats over the map - it's
                // the one thing genuinely useful to glance at *while*
                // looking where you're going. Everything else (status,
                // occupancy, itinerary) lives in the drawer below, matching
                // the web tracker's own layout (no separate floating
                // summary card over the map there).
                currentStepCard
            }
            .padding(.top, 8)

            RecenterButton(isAuthorized: environment.location.isAuthorized) { recenterTrigger += 1 }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .padding(.trailing, 16)
                .padding(.bottom, 8)
        }
        .sheet(isPresented: $isTrackerSheetPresented) {
            itinerarySheetContent
                .presentationDetents([.height(340), .medium, .large], selection: $sheetDetent)
                .presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                .presentationBackground(Theme.background)
                .presentationCornerRadius(20)
                .interactiveDismissDisabled()
        }
        .onChange(of: environment.location.coordinate) { _, newValue in
            guard let newValue, let steps = walkDirections?.steps else { return }
            walkStep = walkTracker.update(steps: steps, location: newValue)
        }
        .task { await start() }
        .onAppear { router.isTrackingVisible = true }
        .onDisappear {
            router.isTrackingVisible = false
            pollTask?.cancel()
            // Safety net if this view ever leaves the stack by some path
            // other than `endJourney()` - see `isTrackerSheetPresented`.
            isTrackerSheetPresented = false
        }
        .background(DisablesSwipeBack())
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        // The itinerary drawer needs the full screen height it's given -
        // with the tab bar still showing underneath (this view is pushed
        // inside the Planner tab's own NavigationStack, and a push doesn't
        // hide the tab bar on its own), the drawer's own bottom rows ended
        // up sitting behind opaque tab bar chrome: visible in outline but
        // untappable, which is what "the drawer can't be used" was.
        .toolbar(.hidden, for: .tabBar)
    }

    /// Floating pill button over the map, standing in for the hidden
    /// system navigation bar (its default buttons had poor contrast
    /// directly over map tiles) - just "End" now. This used to also offer a
    /// manual "set a reminder" menu here, but while a journey is actively
    /// being tracked, get-on/get-off alerts already fire automatically
    /// (`JourneyAlertCenter`, plus the Live Activity) - a manual reminder
    /// picker on top of that was redundant and confusing (removed
    /// 2026-09-23). The manual leave-by reminder still exists, but only
    /// pre-departure on `JourneyDetailView`, where nothing is being tracked
    /// yet and it's the only way to get notified.
    private var topBar: some View {
        HStack {
            // Step out without ending: the journey stays active (Live
            // Activity keeps updating, the resume pill brings you back) -
            // the web's tracker can be closed and resumed the same way.
            FloatingBarButton {
                Button {
                    leaveTracker()
                } label: {
                    Image(systemName: "chevron.down")
                }
                .accessibilityLabel("Minimise")
            }
            Spacer()
            FloatingBarButton {
                Button("End", role: .destructive) { endJourney() }
            }
        }
        .padding(.horizontal, 16)
    }

    /// Leaves the screen but keeps the journey running.
    private func leaveTracker() {
        pollTask?.cancel()
        isTrackerSheetPresented = false
        DispatchQueue.main.async { dismiss() }
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
                        .font(.geist(17, .semibold, relativeTo: .headline))
                    if let stopsAway = snapshot.trackedStopsAway {
                        Text(stopsAway == 0 ? "At the stop" : "\(stopsAway) stop\(stopsAway == 1 ? "" : "s") away")
                            .font(.subheadline)
                            .foregroundStyle(Theme.mutedForeground)
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

    /// Platform + occupancy (people icons + label) + "N stops away" -
    /// mirrors `route-detail-sheet.tsx`'s bordered strip below the phase
    /// header, shown only once a vehicle is actually being tracked live
    /// (matches the web's `journeyStarted && trackingLevel === "live"` gate
    /// - before that there's no real vehicle to report on).
    @ViewBuilder
    private var liveDetailStrip: some View {
        if let snapshot, snapshot.trackingLevel == .live,
           let tripID = snapshot.trackedTripID, let vehicle = vehiclesByTripID[tripID] {
            let platform = vehicle.trip?.nextStop?.platform
            HStack {
                HStack(spacing: 6) {
                    if let platform, !platform.isEmpty {
                        Text("Platform \(platform)")
                    }
                    if vehicle.occupancy >= 0 {
                        if platform?.isEmpty == false { Text("·").foregroundStyle(Theme.mutedForeground.opacity(0.5)) }
                        OccupancyIconsView(occupancy: vehicle.occupancy)
                        Text(OccupancyText.label(vehicle.occupancy))
                    }
                }
                .font(.caption)
                .foregroundStyle(Theme.mutedForeground)

                Spacer()

                if let stopsAway = snapshot.trackedStopsAway {
                    Label("\(stopsAway) \(stopsAway == 1 ? "stop" : "stops") away", systemImage: "chevron.left")
                        .font(.caption.weight(.medium))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal)
        }
    }

    /// The current walking step's own instruction, big and prominent - "Turn
    /// right onto Queen Street", distance to the next maneuver, and a
    /// recenter button - mirrors `navigate.tsx`'s live-mode "current step
    /// card" exactly, so it's obvious what to do next while actually
    /// walking rather than having to read a small map.
    @ViewBuilder
    private var currentStepCard: some View {
        if snapshot?.phase == .walking, let walkDirections, !walkDirections.steps.isEmpty {
            let index = walkStep?.currentStepIndex ?? 0
            let arrived = walkStep?.arrived ?? false
            let step = walkDirections.steps[min(index, walkDirections.steps.count - 1)]

            HStack(spacing: 12) {
                Image(systemName: arrived ? "checkmark.circle.fill" : stepIcon(step))
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(arrived ? Theme.success : accent, in: Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(arrived ? "You've arrived" : step.instruction.prefix(1).uppercased() + step.instruction.dropFirst())
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                    if !arrived, let distance = walkStep?.distanceToNextManeuver, distance > 0 {
                        Text(TimeFormatting.formatDistance(meters: distance))
                            .font(.subheadline)
                            .foregroundStyle(Theme.mutedForeground)
                    }
                }

                Spacer()
            }
            .padding(12)
            .background(arrived ? AnyShapeStyle(Theme.success.opacity(0.12)) : AnyShapeStyle(.ultraThinMaterial), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.horizontal)
        }
    }

    private func stepIcon(_ step: DirectionStep) -> String {
        switch step.type {
        case "depart": return "mappin.circle.fill"
        case "arrive": return "flag.checkered"
        default:
            if step.modifier.contains("right") { return "arrow.turn.up.right" }
            if step.modifier.contains("left") { return "arrow.turn.up.left" }
            return "arrow.up"
        }
    }

    private func trackingLevelBadge(_ level: JourneyProgressModel.TrackingLevel) -> some View {
        Text(level == .live ? "Live" : level == .predicted ? "Predicted" : "Scheduled")
            .font(.caption.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(level == .live ? Theme.success.opacity(0.15) : Theme.mutedForeground.opacity(0.15))
            .foregroundStyle(level == .live ? Theme.success : Theme.mutedForeground)
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

    /// Matches `route-detail-sheet.tsx`'s exact status-line copy ("Walking
    /// to X" / "Waiting for the 70" / "Boarding the 70" / "On the 70 →
    /// Y") rather than a generic "Walking"/"Waiting" - this is the one line
    /// a rider glances at most, so it should say where/what, not just which
    /// phase.
    private func phaseLabel(_ snapshot: JourneyProgressModel.Snapshot) -> String {
        if snapshot.journeyArrived { return "You've arrived" }
        let legIndex = max(0, min(snapshot.progressLegIndex, displayPlan.legs.count - 1))
        guard displayPlan.legs.indices.contains(legIndex) else { return "Tracking" }
        let leg = displayPlan.legs[legIndex]
        let isLastLeg = legIndex == displayPlan.legs.count - 1
        let nextTransit = displayPlan.legs[legIndex...].first { $0.mode == "transit" }

        func routeName(_ leg: JourneyLeg?) -> String {
            guard let leg else { return "service" }
            return leg.route?.routeShortName.isEmpty == false ? leg.route!.routeShortName : (leg.routeID.isEmpty ? "service" : leg.routeID)
        }

        switch snapshot.phase {
        case .walking:
            if let toStop = leg.toStop { return "Walking to \(toStop.stopName)" }
            return isLastLeg ? "Almost there" : "Walking"
        case .waiting:
            return leg.mode == "transit" ? "Waiting for the \(routeName(leg))" : "Waiting for the \(routeName(nextTransit))"
        case .boarding:
            return "Boarding the \(routeName(leg.mode == "transit" ? leg : nextTransit))"
        case .onboard:
            if let toStop = leg.toStop { return "On the \(routeName(leg)) → \(toStop.stopName)" }
            return "On the \(routeName(leg))"
        case nil:
            return "Tracking"
        }
    }

    // MARK: - Itinerary sheet

    /// A real, native bottom sheet (see `sheetDetent`) rather than a fixed
    /// `.safeAreaInset` - drag the indicator to resize between a compact
    /// summary, half-screen and full-screen itinerary, and everything below
    /// the header scrolls properly at any size.
    private var itinerarySheetContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                sheetHeader
                liveDetailStrip
                legProgressStrip
                findBetterRouteButton

                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(displayPlan.legs.enumerated()), id: \.offset) { index, leg in
                        TrackedLegRow(
                            leg: leg,
                            isLast: index == displayPlan.legs.count - 1,
                            status: legStatus(index),
                            currentLabel: legStatus(index) == .current ? snapshot.map(phaseLabel) : nil,
                            accent: accent,
                            progress: legProgress(index),
                            liveInfo: legLiveInfo(index),
                            waitMinutes: waitMinutes(after: index)
                        )
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .background(legStatus(index) == .current ? accent.opacity(0.06) : Color.clear)
                    }
                }
                .padding(.vertical, 8)
            }
            .padding(.top, 4)
        }
        .scrollContentBackground(.hidden)
    }

    /// Route badge + status line + subtitle, remaining time + scheduled
    /// range - matches `route-detail-sheet.tsx`'s own header exactly
    /// (right down to reusing `phaseLabel`'s "Walking to X"/"On the 70 →
    /// Y" copy for the title, not a generic "Walking").
    private var sheetHeader: some View {
        HStack(alignment: .top, spacing: 10) {
            if let badgeLeg = currentOrNextTransitLeg, let route = badgeLeg.route {
                Text(route.routeShortName.isEmpty ? badgeLeg.routeID : route.routeShortName)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(Color(hex: route.routeColor.isEmpty ? "424242" : route.routeColor), in: RoundedRectangle(cornerRadius: 6))
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(snapshot.map(phaseLabel) ?? "Your journey")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                if let snapshot, snapshot.trackingLevel != .live {
                    Label(
                        snapshot.trackingLevel == .predicted ? "No live vehicle - times are predicted" : "No realtime - times are scheduled",
                        systemImage: "exclamationmark.triangle"
                    )
                    .font(.caption2)
                    .foregroundStyle(Theme.warning)
                } else {
                    Text(itinerarySubtitle).font(.caption).foregroundStyle(Theme.mutedForeground)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(remainingLabel).font(.system(size: 17, weight: .bold, design: .rounded))
                HStack(spacing: 3) {
                    Text(displayPlan.departureTime.date ?? Date(), style: .time)
                    Text("-")
                    Text(displayPlan.arrivalTime.date ?? Date(), style: .time)
                }
                .font(.caption2)
                .foregroundStyle(Theme.mutedForeground)
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 8)
    }

    private var currentOrNextTransitLeg: JourneyLeg? {
        let legIndex = snapshot?.progressLegIndex ?? 0
        if displayPlan.legs.indices.contains(legIndex), displayPlan.legs[legIndex].mode == "transit" {
            return displayPlan.legs[legIndex]
        }
        return displayPlan.legs[max(0, legIndex)...].first { $0.mode == "transit" } ?? displayPlan.legs.first { $0.mode == "transit" }
    }

    private var itinerarySubtitle: String {
        let stops = displayPlan.legs.compactMap { $0.mode == "transit" ? 1 : 0 }.reduce(0, +)
        if stops > 0 { return "\(displayPlan.legs.count) leg\(displayPlan.legs.count == 1 ? "" : "s")" }
        return "\(displayPlan.transfers) transfer\(displayPlan.transfers == 1 ? "" : "s")"
    }

    private var remainingLabel: String {
        guard let arrival = displayPlan.arrivalTime.date else { return "" }
        let remaining = arrival.timeIntervalSinceNow
        if remaining <= 30 { return "Arrived" }
        return TimeFormatting.formatDuration(GoDuration(nanoseconds: Int64(remaining * 1_000_000_000)))
    }

    // MARK: - Per-leg tracker helpers

    private func legStatus(_ index: Int) -> TrackedLegRow.Status {
        guard let current = snapshot?.progressLegIndex, current >= 0 else { return .upcoming }
        if index < current { return .done }
        if index == current { return .current }
        return .upcoming
    }

    private func legProgress(_ index: Int) -> Double? {
        guard let snapshot, snapshot.trackedTripID != nil,
              legStatus(index) == .current, displayPlan.legs[index].mode != "walk",
              let tripID = snapshot.trackedTripID, tripID == displayPlan.legs[index].tripID else { return nil }
        let leg = displayPlan.legs[index]
        guard let start = leg.departureTime.date, let end = leg.arrivalTime.date, end > start else { return nil }
        return max(0, min(1, Date().timeIntervalSince(start) / end.timeIntervalSince(start)))
    }

    private func legLiveInfo(_ index: Int) -> TrackedLegRow.LiveInfo? {
        guard legStatus(index) == .current, snapshot?.trackingLevel == .live,
              let tripID = snapshot?.trackedTripID, let vehicle = vehiclesByTripID[tripID] else { return nil }
        return TrackedLegRow.LiveInfo(
            stopsAway: snapshot?.trackedStopsAway,
            occupancy: vehicle.occupancy >= 0 ? vehicle.occupancy : nil,
            platform: vehicle.trip?.nextStop?.platform
        )
    }

    private func waitMinutes(after index: Int) -> Int? {
        guard index + 1 < displayPlan.legs.count,
              let end = displayPlan.legs[index].arrivalTime.date,
              let start = displayPlan.legs[index + 1].departureTime.date else { return nil }
        return max(0, Int((start.timeIntervalSince(end) / 60).rounded()))
    }

    /// Mode-icon-per-leg + total duration + share action, matching
    /// `route-detail-sheet.tsx`'s bordered strip above the itinerary list.
    private var legProgressStrip: some View {
        HStack(spacing: 4) {
            ForEach(Array(displayPlan.legs.enumerated()), id: \.offset) { _, leg in
                Image(systemName: leg.mode == "walk" ? "figure.walk" : "bus")
                    .font(.caption)
                    .foregroundStyle(Theme.mutedForeground)
            }
            Text("\(TimeFormatting.formatDuration(displayPlan.totalDuration)) total")
                .font(.caption)
                .foregroundStyle(Theme.mutedForeground)
                .lineLimit(1)

            Spacer()

            // No manual "remind me" control here any more - get-on/get-off
            // alerts already fire automatically while a journey is being
            // tracked (see `topBar`'s doc comment). Share is still useful
            // on its own (sending the journey link isn't a notification).
            ShareLink(item: shareURL) {
                Image(systemName: "square.and.arrow.up")
            }
        }
        .font(.subheadline)
        .foregroundStyle(Theme.foreground)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    /// "Find a better route from here" - the web's re-plan popover: the
    /// choices that make sense for where the rider is, handed to the
    /// Planner, which re-plans and offers "Keep the route I was on". Red
    /// when a later connection can no longer be made.
    @ViewBuilder
    private var findBetterRouteButton: some View {
        let choices = replanChoices
        if !choices.isEmpty {
            Menu {
                Section("Re-plan from…") {
                    ForEach(choices) { choice in
                        Button { startReplan(choice) } label: {
                            Text(choice.label)
                            Text(choice.detail)
                        }
                    }
                }
            } label: {
                Label("Find a better route from here", systemImage: "arrow.triangle.2.circlepath")
            }
            .buttonStyle(.shad(replanUrgent ? .destructive : .outline, size: .default, fullWidth: true))
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
    }

    private var replanChoices: [ReplanChoice] {
        guard let snapshot else { return [] }
        let vehicle = snapshot.trackedTripID.flatMap { vehiclesByTripID[$0] }
        let next = vehicle?.trip?.nextStop
        let eta: Date? = {
            guard let next, let tripID = snapshot.trackedTripID else { return nil }
            let times = stopTimesByTripID[tripID] ?? []
            return (times.first { $0.childStopID == next.childStopID } ?? times.first { $0.parentStopID == next.parentStopID })?.arrivalTime.date
        }()
        return JourneyReplan.choices(
            legs: displayPlan.legs,
            progressLegIndex: snapshot.progressLegIndex,
            phase: snapshot.phase?.rawValue,
            vehicleNextStop: next.map { ($0.name, $0.coordinate) },
            vehicleNextStopETA: eta,
            userLocation: environment.location.coordinate
        )
    }

    private var replanUrgent: Bool {
        guard let snapshot else { return false }
        return displayPlan.legs.indices.contains { index in
            index > snapshot.progressLegIndex && JourneyTracking.connectionRisk(displayPlan.legs, at: index)?.level == .missed
        }
    }

    private func startReplan(_ choice: ReplanChoice) {
        let last = plan.legs.last
        let destination = PlannerLocation(
            label: last?.toStop?.stopName ?? "Destination",
            coordinate: last?.toStop?.coordinate ?? Coordinate(latitude: plan.endLat, longitude: plan.endLon)
        )
        router.replan(.init(
            origin: PlannerLocation(label: choice.originLabel, coordinate: choice.origin),
            destination: destination,
            departAt: choice.departAt,
            planID: plan.id,
            regionSlug: environment.region.slug,
            arrivalTime: displayPlan.arrivalTime.date
        ))
        leaveTracker()
    }

    /// The web's share link: opens (and starts tracking) this exact journey
    /// for whoever it's sent to.
    private var shareURL: URL {
        URL(string: "https://trains.suddsy.dev/journey?id=\(plan.id)&region=\(environment.region.slug)&track=1") ?? URL(string: "https://trains.suddsy.dev")!
    }

    // MARK: - Map

    /// "Start"/"End" pill bubbles at the journey's first and last stop -
    /// matches the web live map's markers.
    private var waypoints: [WaypointAnnotation] {
        var result: [WaypointAnnotation] = []
        if let first = plan.legs.first?.fromStop {
            result.append(WaypointAnnotation(id: "start", coordinate: first.coordinate, label: "Start", isDestination: false))
        }
        if let last = plan.legs.last?.toStop {
            result.append(WaypointAnnotation(id: "end", coordinate: last.coordinate, label: "End", isDestination: true))
        }
        return result
    }

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
            // If the upcoming service is already broadcasting a live
            // position while still walking there, frame the rider *and*
            // the vehicle together - seeing it approach while still on the
            // way to the stop (not just once it's arrived) is the whole
            // point of putting it on the map at all.
            if let vehicle = nextTransitLegVehicle {
                let vehicleCoordinate = vehicle.position.coordinate
                return .region(
                    center: midpoint(location, vehicleCoordinate),
                    radiusMeters: max(700, Geo.haversineDistanceMeters(location, vehicleCoordinate) * 1.4)
                )
            }
            return .region(center: location, radiusMeters: 500)
        }
        return .fitAll
    }

    /// The vehicle for whichever transit leg comes next (from the rider's
    /// current position in the plan onward) - `nil` until it's actually
    /// broadcasting a live position, same set `vehiclesByTripID` already
    /// holds for every transit leg regardless of tracking phase.
    private var nextTransitLegVehicle: Vehicle? {
        guard let legIndex = snapshot?.progressLegIndex, displayPlan.legs.indices.contains(legIndex) else { return nil }
        guard let tripID = displayPlan.legs[legIndex...].first(where: { $0.mode == "transit" })?.tripID else { return nil }
        return vehiclesByTripID[tripID]
    }

    private func midpoint(_ a: Coordinate, _ b: Coordinate) -> Coordinate {
        Coordinate(latitude: (a.latitude + b.latitude) / 2, longitude: (a.longitude + b.longitude) / 2)
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

        await loadWalkDirectionsIfNeeded(legIndex: newSnapshot.progressLegIndex)
        evaluateJourneyAlerts(with: newSnapshot)
        await updateLiveActivity(with: newSnapshot)
    }

    /// Fetches turn-by-turn directions for the current leg exactly once per
    /// walking leg (tracked by `walkLegIndex`, not re-fetched on every 10s
    /// poll) - uses the rider's live location as the start once known, so
    /// direction-following still works even if they've drifted off the
    /// plan's original as-the-crow-flies start point.
    private func loadWalkDirectionsIfNeeded(legIndex: Int) async {
        guard displayPlan.legs.indices.contains(legIndex), displayPlan.legs[legIndex].mode == "walk" else {
            if walkLegIndex != nil {
                walkLegIndex = nil
                walkDirections = nil
                walkStep = nil
            }
            return
        }
        guard walkLegIndex != legIndex else { return }

        let leg = displayPlan.legs[legIndex]
        guard let toStop = leg.toStop else { return }
        let start = environment.location.coordinate ?? leg.fromStop?.coordinate
        guard let start else { return }

        walkLegIndex = legIndex
        walkTracker.reset()
        walkStep = nil
        walkDirections = try? await environment.api.walkingDirections(from: start, to: toStop.coordinate)
    }

    // MARK: - In-app alerts

    private func evaluateJourneyAlerts(with snapshot: JourneyProgressModel.Snapshot) {
        let trackedLeg = snapshot.trackedTripID.flatMap { tripID in displayPlan.legs.first { $0.tripID == tripID } }
        let trackedVehicle = snapshot.trackedTripID.flatMap { vehiclesByTripID[$0] }
        let risk = displayPlan.legs.indices.contains(snapshot.progressLegIndex)
            ? JourneyTracking.connectionRisk(displayPlan.legs, at: snapshot.progressLegIndex)
            : nil

        alertCenter.evaluate(
            plan: displayPlan,
            trackedLeg: trackedLeg,
            trackedVehicle: trackedVehicle,
            trackedStops: trackedStops,
            boarded: snapshot.boarded,
            journeyArrived: snapshot.journeyArrived,
            connectionRisk: risk,
            endLabel: plan.legs.last?.toStop?.stopName ?? "your destination"
        )
        alertStack = alertCenter.stack
    }

    // MARK: - Live Activity

    private func updateLiveActivity(with snapshot: JourneyProgressModel.Snapshot) async {
        let state = contentState(for: snapshot)
        if environment.liveActivity.isActive {
            await environment.liveActivity.update(state)
        } else if !snapshot.journeyArrived {
            let destination = plan.legs.last?.toStop?.stopName ?? "Destination"
            await environment.liveActivity.start(planID: plan.id, destinationLabel: destination, region: environment.region, initialState: state)
        }
        if let activityID = environment.liveActivity.activity?.id {
            try? await environment.api.reportLiveActivityLeg(activityID: activityID, legIndex: snapshot.progressLegIndex, phase: snapshot.phase?.rawValue ?? "onboard")
        }
    }

    /// Built by TransitCore's `LiveActivityContentBuilder` - the same rules
    /// and wording the backend uses for its background pushes - so the
    /// Lock Screen doesn't change style when the app closes and the server
    /// takes over.
    private func contentState(for snapshot: JourneyProgressModel.Snapshot) -> JourneyActivityAttributes.ContentState {
        let trackedVehicle = snapshot.trackedTripID.flatMap { vehiclesByTripID[$0] }
        let progress = LiveActivityProgress(
            legIndex: max(0, min(snapshot.progressLegIndex, displayPlan.legs.count - 1)),
            phase: snapshot.phase?.rawValue ?? "walking",
            arrived: snapshot.journeyArrived,
            stopsAway: snapshot.trackedStopsAway,
            nextStopName: trackedVehicle?.trip?.nextStop?.name,
            isRealtime: snapshot.trackingLevel != .scheduled
        )
        let content = LiveActivityContentBuilder.build(legs: displayPlan.legs, progress: progress)
        return JourneyActivityAttributes.ContentState(content)
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
        let finalState = snapshot.map { contentState(for: $0) }
        Task { await environment.liveActivity.end(finalState: finalState) }
        // Dismiss the sheet on its own turn of the run loop first, so it's
        // fully torn down before the pop transition starts - doing both at
        // once is exactly the race that left the sheet's last frame ghosted
        // on screen (see `isTrackerSheetPresented`'s doc comment).
        isTrackerSheetPresented = false
        DispatchQueue.main.async { dismiss() }
    }
}

/// Disables the system edge-swipe-to-go-back gesture while this view is on
/// screen. The tracker hides its nav bar and back button entirely - "End"
/// is the one designated way out, so it can tear down the itinerary sheet
/// and Live Activity in order first. Without this, the edge-swipe gesture
/// still worked underneath the hidden bar and popped the view without ever
/// routing through `endJourney()`, which is what actually caused the
/// itinerary sheet to ghost on screen over whatever got pushed to next
/// (reported as "the journey tracker UI is broken", fixed 2026-09-23).
private struct DisablesSwipeBack: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController { UIViewController() }

    func updateUIViewController(_ controller: UIViewController, context: Context) {
        DispatchQueue.main.async {
            controller.parent?.navigationController?.interactivePopGestureRecognizer?.isEnabled = false
        }
    }

    static func dismantleUIViewController(_ controller: UIViewController, coordinator: ()) {
        controller.navigationController?.interactivePopGestureRecognizer?.isEnabled = true
    }
}
