import SwiftData
import SwiftUI
import TransitCore

/// The live-tracking view for an in-progress journey - map-first, with a
/// phase banner and itinerary below. Renders `JourneyTrackingSession`,
/// which does the actual tracking (app-wide, so it carries on when this is
/// minimised, the app is in the background, or there's no connection).
/// This is what `JourneyDetailView`'s "Start this journey" opens - Phase 4's
/// static detail view stays as the pre-departure preview.
struct JourneyTrackingView: View {
    let plan: JourneyPlan

    @Environment(AppEnvironment.self) private var environment
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext

    @Query private var activeJourneys: [ActiveJourney]

    private var session: JourneyTrackingSession { environment.journey }
    /// Only this journey's state - another may still be winding down as
    /// this one opens.
    private var isCurrent: Bool { session.isTracking(plan.id) }
    private var displayPlan: JourneyPlan { isCurrent ? session.displayPlan ?? plan : plan }
    private var snapshot: JourneyProgressModel.Snapshot? { isCurrent ? session.snapshot : nil }
    private var vehiclesByTripID: [String: Vehicle] { isCurrent ? session.vehiclesByTripID : [:] }
    private var stopTimesByTripID: [String: [StopTimeUpdate]] { isCurrent ? session.stopTimesByTripID : [:] }
    /// Full route shapes of the rides, by trip id - the ride you're on (or
    /// about to catch) shows the vehicle's whole route, greyed outside your part.
    private var rideShapes: [String: RouteShape] { isCurrent ? session.rideShapes : [:] }
    /// Turn-by-turn walking directions for whichever leg is currently a
    /// walk - matches the web's `Navigate` component in `liveMode`.
    private var walkDirections: WalkingDirections? { isCurrent ? session.walkDirections : nil }
    private var walkStep: WalkNavigationTracker.Snapshot? { isCurrent ? session.walkStep : nil }
    private var alertStack: [JourneyAlert] { isCurrent ? session.alertStack : [] }

    @State private var recenterTrigger = 0
    /// The camera follows the journey (see `camera`) until the rider pans or
    /// pinches the map themselves; the recentre button hands it back.
    @State private var autoFollow = true
    @State private var cameraResetToken = 0
    /// The itinerary drawer's own detent - previously a fixed
    /// `.safeAreaInset`, which meant it could neither be dragged to resize
    /// nor properly claim touches from whatever the map happened to be
    /// doing underneath it (that inconsistent hit-testing is what "the
    /// drawer can't be used" turned out to be, on top of the tab-bar
    /// z-order bug fixed earlier). A real `.sheet` with detents gives it
    /// native drag-to-resize and correct gesture ownership, same as the
    /// web's own map-first bottom sheet.
    @State private var sheetDetent: PresentationDetent = .height(JourneyTrackingView.compactDrawerHeight)
    static let compactDrawerHeight: CGFloat = 320
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

    /// The web tracker's "live" blue for the current leg/step.
    private var accent: Color { Theme.live }

    /// Opened from a link (resume pill, Live Activity, share link) in a
    /// full-screen cover, rather than pushed from the Planner tab.
    var presentedFromLink = false

    init(plan: JourneyPlan, presentedFromLink: Bool = false) {
        self.plan = plan
        self.presentedFromLink = presentedFromLink
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                TransitMapView(
                    // Only the vehicle for the ride you're on or about to
                    // take - never the others in the plan.
                    vehicles: activeRideVehicle.map { [VehicleAnnotation(vehicle: $0)] } ?? [],
                    waypoints: waypoints,
                    polylines: polylines,
                    camera: autoFollow ? camera : .none,
                    showsUserLocation: true,
                    centerOnUserLocationTrigger: recenterTrigger,
                    cameraInsets: cameraInsets(in: proxy),
                    onUserInteraction: { if autoFollow { autoFollow = false } },
                    cameraResetToken: cameraResetToken
                )
                .ignoresSafeArea()

                VStack(spacing: 8) {
                    topBar
                    JourneyAlertOverlay(alerts: alertStack) { id in
                        session.dismissAlert(id)
                    }
                    // Only the walking step card floats over the map - it's
                    // the one thing genuinely useful to glance at *while*
                    // looking where you're going. Everything else lives in
                    // the drawer below, matching the web tracker's layout.
                    currentStepCard
                }
                .padding(.top, 8)
            }
        }
        .sheet(isPresented: $isTrackerSheetPresented) {
            itinerarySheetContent
                .presentationDetents([.height(Self.compactDrawerHeight), .medium, .large], selection: $sheetDetent)
                .presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                .presentationBackground(Theme.background)
                .presentationCornerRadius(24)
                .interactiveDismissDisabled()
        }
        .task { start() }
        .onAppear {
            router.isTrackingVisible = true
            router.openTracker = (planID: plan.id, inLink: presentedFromLink)
        }
        .onDisappear {
            router.isTrackingVisible = false
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
            // Up here rather than the map's bottom corner, which the
            // drawer covers.
            RecenterButton(isAuthorized: environment.location.isAuthorized) { recenter() }
            FloatingBarButton {
                Button("End", role: .destructive) { endJourney() }
                    .padding(.horizontal, 12)
            }
        }
        .padding(.horizontal, 16)
    }

    /// First tap hands the camera back to the journey (after the rider
    /// panned away); a second tap, with it already following, jumps to the
    /// rider's own position.
    private func recenter() {
        if autoFollow {
            recenterTrigger += 1
        } else {
            autoFollow = true
            cameraResetToken += 1
        }
    }

    /// Leaves the screen but keeps the journey running.
    private func leaveTracker() {
        router.openTracker = nil
        isTrackerSheetPresented = false
        DispatchQueue.main.async { dismiss() }
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

    // MARK: - Drawer

    /// The tracker's bottom drawer: what you're doing now (hero), live
    /// facts (chips), what you can do about it (actions), then the whole
    /// trip as a timeline. The compact detent shows everything down to the
    /// actions; drag up for the timeline. A real sheet with detents so it
    /// gets native drag-to-resize and gesture ownership over the map.
    private var itinerarySheetContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                heroHeader
                statusChips
                actionsRow

                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        SectionLabel(text: "Your trip")
                        Spacer()
                        Text("\(TimeFormatting.formatDuration(displayPlan.totalDuration)) total")
                            .font(.meta)
                            .foregroundStyle(Theme.mutedForeground)
                    }
                    JourneyTimeline(
                        legs: displayPlan.legs,
                        status: legStatus,
                        progress: legProgress,
                        waitMinutes: { waitMinutes(after: $0) },
                        destinationName: destinationName,
                        accent: accent
                    )
                }
            }
            .padding(.horizontal, 16)
            // Clear of the sheet's grab handle.
            .padding(.top, 28)
            .padding(.bottom, 24)
        }
        .scrollContentBackground(.hidden)
    }

    /// Mode tile, the one-line status ("Waiting for the 70"), a detail line
    /// and the countdown that matters right now - to departure while
    /// walking or waiting, to your stop while riding.
    private var heroHeader: some View {
        HStack(alignment: .center, spacing: 14) {
            heroTile

            VStack(alignment: .leading, spacing: 3) {
                Text(snapshot.map(phaseLabel) ?? "Your journey")
                    .font(.geist(19, .semibold, relativeTo: .title3))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                if let heroDetail {
                    Text(heroDetail)
                        .font(.meta)
                        .foregroundStyle(Theme.mutedForeground)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let countdown = heroCountdown {
                TimelineView(.periodic(from: .now, by: 15)) { context in
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(Self.minutesText(until: countdown.target, now: context.date))
                            .font(.number(26))
                            .foregroundStyle(countdown.urgent ? Theme.warning : Theme.foreground)
                        Text(countdown.caption)
                            .font(.geist(12, relativeTo: .caption))
                            .foregroundStyle(Theme.mutedForeground)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder
    private var heroTile: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        if snapshot?.journeyArrived == true {
            Image(systemName: "checkmark")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(Theme.success, in: shape)
                .accessibilityHidden(true)
        } else if snapshot?.phase == .walking || currentOrNextTransitLeg == nil {
            Image(systemName: "figure.walk")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Theme.foreground)
                .frame(width: 52, height: 52)
                .background(Theme.muted, in: shape)
                .overlay(shape.strokeBorder(Theme.border, lineWidth: 1))
                .accessibilityHidden(true)
        } else if let leg = currentOrNextTransitLeg {
            let hex = leg.route?.routeColor.isEmpty == false ? leg.route!.routeColor : "525252"
            Text(routeName(leg))
                .font(.geist(18, .bold, relativeTo: .title3))
                .foregroundStyle(RouteColors.text(onHex: hex))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .padding(.horizontal, 4)
                .frame(width: 52, height: 52)
                .background(Color(hex: hex), in: shape)
                .accessibilityHidden(true)
        }
    }

    private func routeName(_ leg: JourneyLeg) -> String {
        if let name = leg.route?.routeShortName, !name.isEmpty { return name }
        return leg.routeID.isEmpty ? "Bus" : leg.routeID
    }

    /// The last stop's name, else the place the rider searched for (a
    /// final walk to an address has no stop).
    private var destinationName: String {
        if let name = displayPlan.legs.last?.toStop?.stopName, !name.isEmpty { return name }
        if let label = activeJourneys.first(where: { $0.planID == plan.id })?.endLabel, !label.isEmpty { return label }
        return "your destination"
    }

    private var currentLeg: JourneyLeg? {
        guard let index = snapshot?.progressLegIndex, displayPlan.legs.indices.contains(index) else { return nil }
        return displayPlan.legs[index]
    }

    private var trackedVehicle: Vehicle? {
        snapshot?.trackedTripID.flatMap { vehiclesByTripID[$0] }
    }

    private func clock(_ date: Date?) -> String {
        date?.formatted(date: .omitted, time: .shortened) ?? ""
    }

    /// The line under the status - the next thing to know, not a repeat of
    /// the status itself.
    private var heroDetail: String? {
        guard let snapshot else { return nil }
        if snapshot.journeyArrived { return "at \(destinationName)" }
        switch snapshot.phase {
        case .walking:
            if let ride = currentOrNextTransitLeg, currentLeg?.mode == "walk" {
                var text = "Then the \(routeName(ride)) at \(clock(ride.departureTime.date))"
                if let platform = ride.fromStop?.platformNumber, !platform.isEmpty { text += ", platform \(platform)" }
                return text
            }
            return "Arrive around \(clock(displayPlan.arrivalTime.date))"
        case .waiting, .boarding:
            guard let ride = currentOrNextTransitLeg else { return nil }
            var text = "Departs \(ride.fromStop?.stopName ?? "") at \(clock(ride.departureTime.date))"
            if let platform = ride.fromStop?.platformNumber, !platform.isEmpty { text += ", platform \(platform)" }
            return text
        case .onboard:
            if let next = trackedVehicle?.trip?.nextStop?.name, !next.isEmpty { return "Next stop: \(next)" }
            return currentLeg.map { "Get off at \($0.toStop?.stopName ?? "your stop") at \(clock($0.arrivalTime.date))" }
        case nil:
            return "Starts at \(clock(displayPlan.departureTime.date))"
        }
    }

    private struct Countdown {
        let target: Date
        let caption: String
        let urgent: Bool
    }

    private var heroCountdown: Countdown? {
        guard let snapshot, !snapshot.journeyArrived else { return nil }
        switch snapshot.phase {
        case .onboard:
            guard let arrival = currentLeg?.arrivalTime.date else { return nil }
            let isLast = snapshot.progressLegIndex >= displayPlan.legs.count - 1
                || !displayPlan.legs[(snapshot.progressLegIndex + 1)...].contains { $0.mode == "transit" }
            return Countdown(target: arrival, caption: isLast ? "to your stop" : "to get off", urgent: false)
        case .walking, .waiting, .boarding:
            if let ride = currentOrNextTransitLeg, let departure = ride.departureTime.date, currentLeg?.mode == "walk" || currentLeg?.tripID == ride.tripID {
                return Countdown(target: departure, caption: "to departure", urgent: departure.timeIntervalSinceNow < 120)
            }
            return displayPlan.arrivalTime.date.map { Countdown(target: $0, caption: "to arrive", urgent: false) }
        case nil:
            return displayPlan.departureTime.date.map { Countdown(target: $0, caption: "to start", urgent: false) }
        }
    }

    static func minutesText(until target: Date, now: Date) -> String {
        let minutes = Int((target.timeIntervalSince(now) / 60).rounded(.up))
        if minutes <= 0 { return "Now" }
        if minutes >= 60 { return "\(minutes / 60)h \(minutes % 60)m" }
        return "\(minutes) min"
    }

    /// Live/predicted, how far away, how full, running late - the facts the
    /// web shows in its bordered strip under the header, as chips.
    @ViewBuilder
    private var statusChips: some View {
        if let snapshot, !snapshot.journeyArrived, snapshot.phase != nil {
            let now = Date()
            FlowLayout(spacing: 6, lineSpacing: 6) {
                if isCurrent, session.isOffline {
                    Label("Offline", systemImage: "wifi.slash")
                        .modifier(StatusChipStyle(tint: Theme.warning))
                } else if isCurrent, session.isOfflineReady, !hasBoardedFirstRide(snapshot) {
                    // Reassurance before setting off without data: the
                    // journey will carry on if the connection goes.
                    Label("Saved for offline", systemImage: "arrow.down.circle")
                        .modifier(StatusChipStyle())
                }

                switch snapshot.trackingLevel {
                case .live:
                    HStack(spacing: 5) {
                        if isLiveDataStale(now: now) {
                            ProgressView().controlSize(.mini)
                            Text("Updating")
                        } else {
                            LiveDot(color: Theme.success)
                            Text("Live")
                        }
                    }
                    .modifier(StatusChipStyle())
                case .estimated:
                    Label("On board · from GPS", systemImage: "location.fill")
                        .modifier(StatusChipStyle())
                case .predicted:
                    if let asOf = predictionsAsOf(now: now) {
                        Label("Times as of \(clock(asOf))", systemImage: "clock.arrow.circlepath")
                            .modifier(StatusChipStyle())
                    } else {
                        Label("Predicted", systemImage: "waveform.path.ecg")
                            .modifier(StatusChipStyle())
                    }
                case .scheduled:
                    Label("Timetable only", systemImage: "calendar")
                        .modifier(StatusChipStyle())
                }

                if let away = snapshot.trackedStopsAway, let toGo = snapshot.trackedStopsToGo {
                    Text(stopsAwayText(away, atStop: toGo == 0, onboard: snapshot.phase == .onboard))
                        .modifier(StatusChipStyle())
                }

                if let vehicle = trackedVehicle, vehicle.occupancy >= 0 {
                    HStack(spacing: 4) {
                        OccupancyIconsView(occupancy: vehicle.occupancy)
                        Text(OccupancyText.label(vehicle.occupancy))
                    }
                    .modifier(StatusChipStyle())
                }

                if let ride = currentOrNextTransitLeg {
                    if !ride.tripUsable {
                        Label("Not running", systemImage: "exclamationmark.triangle.fill")
                            .modifier(StatusChipStyle(tint: Theme.danger))
                    } else if let delay = ride.delaySeconds, abs(delay) >= 60 {
                        Text(delay > 0 ? "\(delay / 60) min late" : "\(-delay / 60) min early")
                            .modifier(StatusChipStyle(tint: delay > 0 ? Theme.warning : Theme.success))
                    }
                }

                if let risk = upcomingConnectionRisk {
                    Label(risk.level == .missed ? "Connection missed" : "Tight connection",
                          systemImage: risk.level == .missed ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                        .modifier(StatusChipStyle(tint: risk.level == .missed ? Theme.danger : Theme.warning))
                }
            }
        }
    }

    private func hasBoardedFirstRide(_ snapshot: JourneyProgressModel.Snapshot) -> Bool {
        guard let first = displayPlan.legs.firstIndex(where: { $0.mode == "transit" }) else { return true }
        return snapshot.progressLegIndex > first || (snapshot.progressLegIndex == first && snapshot.phase == .onboard)
    }

    /// `away` is the Live Activity's count - stops *between* the vehicle
    /// and yours (0 = yours is its next stop). `atStop` is only true once
    /// the feed says it's stopped there. Counting your own stop too (the
    /// old `trackedStopsToGo`) read "1 stop away" while the bus was pulling
    /// in, since AT often reports "Arriving" rather than "AtStop".
    private func stopsAwayText(_ away: Int, atStop: Bool, onboard: Bool) -> String {
        if onboard {
            if atStop { return "At your stop - get off" }
            return away == 0 ? "Get off at the next stop" : "\(away + 1) stops to go"
        }
        let name = currentOrNextTransitLeg.map(routeName) ?? "Service"
        if atStop { return "\(name) at your stop" }
        return away == 0 ? "\(name) arriving" : away == 1 ? "\(name) 1 stop away" : "\(name) \(away) stops away"
    }

    private var upcomingConnectionRisk: JourneyTracking.ConnectionRisk? {
        guard let snapshot else { return nil }
        return displayPlan.legs.indices
            .filter { $0 > snapshot.progressLegIndex }
            .lazy
            .compactMap { JourneyTracking.connectionRisk(displayPlan.legs, at: $0) }
            .first
    }

    /// "Find a better route" (the web's re-plan popover) beside Share.
    private var actionsRow: some View {
        HStack(spacing: 8) {
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
                    Label("Find a better route", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.shad(replanUrgent ? .destructive : .outline, size: .default, fullWidth: true))
            }

            ShareLink(item: shareURL, subject: Text("My journey"), message: Text("Follow my journey")) {
                if choices.isEmpty {
                    Label("Share journey", systemImage: "square.and.arrow.up")
                } else {
                    Image(systemName: "square.and.arrow.up")
                }
            }
            .buttonStyle(.shad(.outline, size: choices.isEmpty ? .default : .icon, fullWidth: choices.isEmpty))
            .accessibilityLabel("Share journey")
        }
    }

    private var currentOrNextTransitLeg: JourneyLeg? {
        let legIndex = snapshot?.progressLegIndex ?? 0
        if displayPlan.legs.indices.contains(legIndex), displayPlan.legs[legIndex].mode == "transit" {
            return displayPlan.legs[legIndex]
        }
        return displayPlan.legs[max(0, legIndex)...].first { $0.mode == "transit" } ?? displayPlan.legs.first { $0.mode == "transit" }
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

    private func waitMinutes(after index: Int) -> Int? {
        guard index + 1 < displayPlan.legs.count,
              let end = displayPlan.legs[index].arrivalTime.date,
              let start = displayPlan.legs[index + 1].departureTime.date else { return nil }
        return max(0, Int((start.timeIntervalSince(end) / 60).rounded()))
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

    /// Each ride in its own route colour, walks in grey - same as the
    /// journey preview. The ride you're on (or about to catch) is drawn from
    /// the vehicle's full route shape instead, with the parts before you
    /// board and after you get off greyed out - like the web tracker.
    private var polylines: [RoutePolylineData] {
        guard let features = plan.routeGeoJSON?.features else { return [] }
        let transitLegs = plan.legs.filter { $0.mode == "transit" }
        let activeRide = activeRideLeg
        var transitIndex = 0
        return features.enumerated().flatMap { index, feature -> [RoutePolylineData] in
            let mode = feature.properties?["mode"]?.stringValue ?? "walk"
            guard mode != "walk" else {
                return [RoutePolylineData(id: "leg-\(index)", coordinates: feature.geometry.lineCoordinates, colorHex: "9CA3AF", isWalk: true)]
            }
            let leg = transitIndex < transitLegs.count ? transitLegs[transitIndex] : nil
            transitIndex += 1
            let routeColor = leg?.route?.routeColor ?? ""
            let color = routeColor.isEmpty ? environment.region.brandColorHex : routeColor
            if let leg, leg.tripID == activeRide?.tripID,
               let shape = rideShapes[leg.tripID]?.geojson.geometry.lineCoordinates,
               let board = leg.fromStop?.coordinate, let alight = leg.toStop?.coordinate {
                let split = RoutePolylineData.splitRide(id: "leg-\(index)", shape: shape, board: board, alight: alight, colorHex: color)
                if !split.isEmpty { return split }
            }
            return [RoutePolylineData(id: "leg-\(index)", coordinates: feature.geometry.lineCoordinates, colorHex: color)]
        }
    }

    /// Where the map looks at each stage of the journey:
    /// - walking (to a stop, a transfer, or the destination): follow you,
    ///   like turn-by-turn - or, without your location, the walk's start
    ///   and end
    /// - waiting / boarding (including between rides): you and the vehicle
    ///   you're about to catch (the stop, until it's live)
    /// - on board: follow the vehicle
    /// - before starting, and once arrived: the whole route
    private var camera: MapCamera {
        guard let snapshot, let phase = snapshot.phase, !snapshot.journeyArrived else { return .fitAll }
        let rider = environment.location.coordinate
        let legs = displayPlan.legs
        let index = snapshot.progressLegIndex
        let leg: JourneyLeg? = legs.indices.contains(index) ? legs[index] : nil

        switch phase {
        case .onboard:
            if let vehicle = activeRideVehicle {
                return .follow(annotationID: vehicle.tripID, spanMeters: 1600)
            }
            // No live position: the ride's two ends (and you, if known).
            let points = [activeRideLeg?.fromStop?.coordinate, activeRideLeg?.toStop?.coordinate, rider].compactMap { $0 }
            return points.isEmpty ? .fitAll : .frame(points: points, minSpanMeters: 800)

        case .walking:
            if rider != nil {
                return .followUser(spanMeters: 350)
            }
            let target: Coordinate? = {
                if let leg, leg.mode == "walk" {
                    if let stop = leg.toStop?.coordinate { return stop }
                    return index == legs.count - 1 ? Coordinate(latitude: plan.endLat, longitude: plan.endLon) : nil
                }
                return activeRideLeg?.fromStop?.coordinate
            }()
            let origin: Coordinate? = {
                if let from = leg?.fromStop?.coordinate { return from }
                if index > 0, let previous = legs[index - 1].toStop?.coordinate { return previous }
                return Coordinate(latitude: plan.startLat, longitude: plan.startLon)
            }()
            let points = [origin, target].compactMap { $0 }
            return points.isEmpty ? .fitAll : .frame(points: points, minSpanMeters: 300)

        case .waiting, .boarding:
            let stop = activeRideLeg?.fromStop?.coordinate
            let vehicle = activeRideVehicle?.position.coordinate
            // You (or the stop you're waiting at) and the vehicle coming;
            // until it's live, you and the stop.
            let points = [rider ?? stop, vehicle ?? (rider != nil ? stop : nil)].compactMap { $0 }
            return points.isEmpty ? .fitAll : .frame(points: points, minSpanMeters: 400)
        }
    }

    /// The part of the map not covered by the top controls or the drawer,
    /// in the map's own (full-screen) coordinates.
    private func cameraInsets(in proxy: GeometryProxy) -> UIEdgeInsets {
        let fullHeight = proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom
        let hasStepCard = snapshot?.phase == .walking && walkDirections?.steps.isEmpty == false
        let top = proxy.safeAreaInsets.top + 8 + 48 + (hasStepCard ? 76 : 0)
        let drawer: CGFloat = sheetDetent == .height(Self.compactDrawerHeight) ? Self.compactDrawerHeight : fullHeight / 2
        return UIEdgeInsets(top: top, left: 0, bottom: min(drawer, fullHeight - top - 120), right: 0)
    }

    /// The ride you're on, or the next one you'll take - nil on the final
    /// walk (nothing left to catch).
    private var activeRideLeg: JourneyLeg? {
        let index = max(0, snapshot?.progressLegIndex ?? 0)
        guard displayPlan.legs.indices.contains(index) else { return nil }
        return displayPlan.legs[index...].first { $0.mode == "transit" }
    }

    /// That ride's vehicle, once it's sending a live position.
    private var activeRideVehicle: Vehicle? {
        activeRideLeg.flatMap { vehiclesByTripID[$0.tripID] }
    }

    // MARK: - Data

    private func start() {
        session.begin(plan: plan, region: environment.region, modelContext: modelContext)
    }

    /// Live data hasn't refreshed for a while (poll failing) - shown as an
    /// "Updating" chip rather than dropping straight to "no live vehicle".
    private func isLiveDataStale(now: Date) -> Bool {
        guard let lastLiveFetch = session.lastLiveFetch else { return false }
        return now.timeIntervalSince(lastLiveFetch) > 25
    }

    /// The predictions shown are from a while ago (no connection) - when
    /// they were current.
    private func predictionsAsOf(now: Date) -> Date? {
        guard let fetched = session.lastStopTimesFetch, now.timeIntervalSince(fetched) > 60 else { return nil }
        return fetched
    }

    private func endJourney() {
        router.openTracker = nil
        if isCurrent {
            session.end()
        } else {
            if let active = try? modelContext.fetch(FetchDescriptor<ActiveJourney>()).first(where: { $0.planID == plan.id }) {
                modelContext.delete(active)
            }
            Task { await environment.liveActivity.endAll() }
        }
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
