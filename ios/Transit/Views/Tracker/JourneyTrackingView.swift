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
    @Environment(\.scenePhase) private var scenePhase

    @Query private var activeJourneys: [ActiveJourney]
    @State private var progressModel = JourneyProgressModel()
    @State private var displayPlan: JourneyPlan
    @State private var vehiclesByTripID: [String: Vehicle] = [:]
    @State private var stopTimesByTripID: [String: [StopTimeUpdate]] = [:]
    @State private var trackedStops: [TripStopRef] = []
    @State private var snapshot: JourneyProgressModel.Snapshot?
    @State private var pollTask: Task<Void, Never>?
    @State private var lastTrackedTripID: String?
    /// When live vehicle positions last loaded. A failed poll (typically the
    /// first one after coming back from the background, while the network
    /// wakes up) keeps the last good data rather than wiping it - it only
    /// counts as lost once it's older than `liveDataMaxAge`.
    @State private var lastLiveFetch: Date?
    @State private var isTicking = false
    private static let liveDataMaxAge: TimeInterval = 120

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

    // In-app get-on/off alerts - port of `use-journey-alerts.ts`. The
    // evaluator (a plain class) keeps its own fired-keys history across
    // ticks; `alertStack` is the SwiftUI-visible copy, refreshed after
    // every `evaluate()` call (same "class computes, @State mirrors"
    // pattern as `progressModel`/`snapshot` elsewhere in this view).
    private let alertCenter = JourneyAlertCenter()
    @State private var alertStack: [JourneyAlert] = []

    /// The web tracker's "live" blue for the current leg/step.
    private var accent: Color { Theme.live }

    /// Opened from a link (resume pill, Live Activity, share link) in a
    /// full-screen cover, rather than pushed from the Planner tab.
    var presentedFromLink = false

    init(plan: JourneyPlan, presentedFromLink: Bool = false) {
        self.plan = plan
        self.presentedFromLink = presentedFromLink
        _displayPlan = State(initialValue: plan)
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                TransitMapView(
                    vehicles: vehiclesByTripID.values.map(VehicleAnnotation.init),
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
                        alertCenter.dismiss(id)
                        alertStack = alertCenter.stack
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
        .onChange(of: environment.location.coordinate) { _, newValue in
            guard let newValue, let steps = walkDirections?.steps else { return }
            walkStep = walkTracker.update(steps: steps, location: newValue)
        }
        .task { await start() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: startPolling()
            case .background: pollTask?.cancel()  // the Live Activity is server-driven meanwhile
            default: break
            }
        }
        .onAppear {
            router.isTrackingVisible = true
            router.openTracker = (planID: plan.id, inLink: presentedFromLink)
        }
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
        pollTask?.cancel()
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
            Text(routeName(leg))
                .font(.geist(18, .bold, relativeTo: .title3))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .padding(.horizontal, 4)
                .frame(width: 52, height: 52)
                .background(Color(hex: leg.route?.routeColor.isEmpty == false ? leg.route!.routeColor : "525252"), in: shape)
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
            FlowLayout(spacing: 6, lineSpacing: 6) {
                switch snapshot.trackingLevel {
                case .live:
                    HStack(spacing: 5) {
                        if isLiveDataStale {
                            ProgressView().controlSize(.mini)
                            Text("Updating")
                        } else {
                            LiveDot(color: Theme.success)
                            Text("Live")
                        }
                    }
                    .modifier(StatusChipStyle())
                case .predicted:
                    Label("Predicted", systemImage: "waveform.path.ecg")
                        .modifier(StatusChipStyle())
                case .scheduled:
                    Label("Timetable only", systemImage: "calendar")
                        .modifier(StatusChipStyle())
                }

                if let away = snapshot.trackedStopsAway {
                    Text(stopsAwayText(away, onboard: snapshot.phase == .onboard))
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

    private func stopsAwayText(_ away: Int, onboard: Bool) -> String {
        if onboard {
            return away <= 1 ? "Get off next stop" : "\(away) stops to go"
        }
        let name = currentOrNextTransitLeg.map(routeName) ?? "Service"
        return away == 0 ? "\(name) at your stop" : "\(name) \(away) stop\(away == 1 ? "" : "s") away"
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
    /// journey preview.
    private var polylines: [RoutePolylineData] {
        guard let features = plan.routeGeoJSON?.features else { return [] }
        let transitColors = plan.legs.filter { $0.mode == "transit" }.map { $0.route?.routeColor ?? "" }
        var transitIndex = 0
        return features.enumerated().map { index, feature in
            let mode = feature.properties?["mode"]?.stringValue ?? "walk"
            var color = "9CA3AF"
            if mode != "walk" {
                let routeColor = transitIndex < transitColors.count ? transitColors[transitIndex] : ""
                color = routeColor.isEmpty ? environment.region.brandColorHex : routeColor
                transitIndex += 1
            }
            return RoutePolylineData(id: "leg-\(index)", coordinates: feature.geometry.lineCoordinates, colorHex: color, isWalk: mode == "walk")
        }
    }

    /// Where the map looks at each stage - the web's live map
    /// (`followUser` / `followFitWith` / `followMarkerId`), tuned for a
    /// phone with a drawer over half the screen:
    /// - before starting, and once arrived: the whole route
    /// - walking: on the rider; once the ride's vehicle is live, the rider,
    ///   the stop and the vehicle together, so you can see it coming
    /// - waiting: the vehicle and your stop together
    /// - riding: follow the vehicle at street level
    private var camera: MapCamera {
        guard let snapshot, snapshot.phase != nil, !snapshot.journeyArrived else { return .fitAll }
        let rider = environment.location.coordinate
        let boardStop = currentOrNextTransitLeg?.fromStop?.coordinate

        if snapshot.phase == .onboard, let tripID = snapshot.trackedTripID, vehiclesByTripID[tripID] != nil {
            return .follow(annotationID: tripID, spanMeters: 1600)
        }

        if snapshot.riderWalking {
            guard let rider else { return .fitAll }
            if let vehicle = nextTransitLegVehicle {
                let points = [rider, vehicle.position.coordinate] + (boardStop.map { [$0] } ?? [])
                return .frame(points: points, minSpanMeters: 600)
            }
            return .region(center: rider, radiusMeters: 600)
        }

        // Waiting or boarding.
        if let tripID = snapshot.trackedTripID, let vehicle = vehiclesByTripID[tripID] {
            let stop = snapshot.followFitWithStop ?? boardStop
            return .frame(points: [vehicle.position.coordinate] + (stop.map { [$0] } ?? []), minSpanMeters: 500)
        }
        if let boardStop {
            return .frame(points: [boardStop] + (rider.map { [$0] } ?? []), minSpanMeters: 500)
        }
        return .fitAll
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

    /// The vehicle for whichever transit leg comes next (from the rider's
    /// current position in the plan onward) - `nil` until it's actually
    /// broadcasting a live position, same set `vehiclesByTripID` already
    /// holds for every transit leg regardless of tracking phase.
    private var nextTransitLegVehicle: Vehicle? {
        guard let legIndex = snapshot?.progressLegIndex, displayPlan.legs.indices.contains(legIndex) else { return nil }
        guard let tripID = displayPlan.legs[legIndex...].first(where: { $0.mode == "transit" })?.tripID else { return nil }
        return vehiclesByTripID[tripID]
    }

    // MARK: - Data

    private func start() async {
        environment.location.requestPermission()
        environment.location.startUpdating()
        if let saved = activeJourneys.first(where: { $0.planID == plan.id }) {
            progressModel.restore(alightedThroughLeg: saved.alightedThroughLeg)
        }
        startPolling()
    }

    /// Refreshes now, then every 10s. Also called when the app comes back
    /// to the foreground, so the tracker catches up immediately instead of
    /// waiting out the rest of an interval.
    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                await tick()
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }

    private func tick() async {
        guard !isTicking else { return }
        isTicking = true
        defer { isTicking = false }

        let tripIDs = plan.transitLegs.map(\.tripID)
        async let vehicles = try? environment.api.liveVehicles(tripIDs: tripIDs)
        async let times = fetchStopTimes(tripIDs: tripIDs)
        if let fresh = await vehicles {
            vehiclesByTripID = Dictionary(uniqueKeysWithValues: fresh.map { ($0.tripID, $0) })
            lastLiveFetch = Date()
        } else if let last = lastLiveFetch, Date().timeIntervalSince(last) > Self.liveDataMaxAge {
            vehiclesByTripID = [:]
        }
        // Only trips that actually loaded replace what we had.
        stopTimesByTripID.merge(await times) { _, new in new }

        displayPlan = JourneyPlanLiveAdjuster.buildLiveJourney(plan, stopTimesByTripID: stopTimesByTripID)

        var newSnapshot = computeSnapshot()
        if let tripID = newSnapshot.trackedTripID, tripID != lastTrackedTripID,
           let stops = try? await environment.api.stopsForTrip(tripID: tripID) {
            lastTrackedTripID = tripID
            trackedStops = stops
            // Recompute with the stops: without them "boarded" and stops-away
            // can't be worked out, so a resumed tracker would briefly show
            // the rider as still waiting.
            newSnapshot = computeSnapshot()
        }
        snapshot = newSnapshot
        saveProgress()

        await loadWalkDirectionsIfNeeded(legIndex: newSnapshot.progressLegIndex)
        evaluateJourneyAlerts(with: newSnapshot)
        await updateLiveActivity(with: newSnapshot)
    }

    private func computeSnapshot() -> JourneyProgressModel.Snapshot {
        progressModel.update(
            plan: plan, displayPlan: displayPlan, now: Date(), vehiclesByTripID: vehiclesByTripID,
            stopTimesByTripID: stopTimesByTripID, journeyStarted: true, trackedStops: trackedStops,
            userLocation: environment.location.coordinate
        )
    }

    private func saveProgress() {
        guard let saved = activeJourneys.first(where: { $0.planID == plan.id }),
              saved.alightedThroughLeg != progressModel.alightedThroughLeg else { return }
        saved.alightedThroughLeg = progressModel.alightedThroughLeg
    }

    /// Live data hasn't refreshed for a while (poll failing) - shown as an
    /// "Updating" chip rather than dropping straight to "no live vehicle".
    private var isLiveDataStale: Bool {
        guard let lastLiveFetch else { return false }
        return Date().timeIntervalSince(lastLiveFetch) > 25
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
            endLabel: destinationName
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
        router.openTracker = nil
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
