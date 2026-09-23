import SwiftData
import SwiftUI
import TransitCore

/// The journey planner - `pages/plan.tsx`: search form, saved trips,
/// results.
struct PlannerView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.modelContext) private var modelContext
    @Environment(DeepLinkRouter.self) private var router
    @Query(sort: \SavedTrip.sortOrder) private var savedTrips: [SavedTrip]

    // Form
    @State private var start: PlannerLocation?
    @State private var end: PlannerLocation?
    @State private var timeType: JourneyPlanRequest.TimeType = .now
    @State private var date = Date()
    @State private var maxWalkKm: Double = 1.0
    @State private var walkSpeed: Double = 4.8
    @State private var maxTransfers: Int = 5
    @State private var minResults: Int = 3
    @State private var onlyRoutes: [RouteSearchResult] = []
    @State private var showsOptions = false

    // Results
    @State private var results: [JourneyPlan] = []
    @State private var isPlanning = false
    @State private var planError: String?
    /// The search that produced `results` - reminders use this, not the
    /// (possibly since edited) form.
    @State private var resultsContext: PlannerSearchContext?

    // Sheets
    @State private var isSaving = false
    @State private var justSaved = false
    @State private var isManaging = false
    @State private var isUpdatingAll = false
    @State private var reminderPlan: JourneyPlan?

    /// Taken when re-planning mid-journey, so the rider can go back to the
    /// route they were on - the web's `replanSnapshot`.
    @State private var replanSnapshot: ReplanSnapshot?

    private struct ReplanSnapshot {
        let results: [JourneyPlan]
        let resultsContext: PlannerSearchContext?
        let start: PlannerLocation?
        let end: PlannerLocation?
        let timeType: JourneyPlanRequest.TimeType
        let date: Date
        let planID: String
        let regionSlug: String
        let arrivalTime: Date?
    }

    @State private var path = NavigationPath()

    private var canPlan: Bool { start != nil && end != nil }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Above everything below it, so the From/To dropdowns
                    // draw over the saved trips and results rather than
                    // behind them.
                    form.zIndex(1)
                    // Saved trips fill the page until there are results.
                    if !savedTrips.isEmpty, results.isEmpty, !isPlanning {
                        SavedTripsList(trips: savedTrips, onLoad: { apply($0) }, onManage: { isManaging = true })
                    }
                    replanBanner
                    latestLeaveBanner
                    if let planError, !isPlanning {
                        Text(planError)
                            .font(.bodyText)
                            .foregroundStyle(Theme.danger)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.danger.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous).strokeBorder(Theme.danger.opacity(0.3), lineWidth: 1))
                    }
                    resultsList
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .pageBackground()
            .navigationTitle("Planner")
            .navigationBarTitleDisplayMode(.inline)
            .appToolbar()
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Button { isManaging = true } label: {
                            Label(savedTrips.isEmpty ? "Saved trips" : "Saved trips (\(savedTrips.count))", systemImage: "bookmark")
                        }
                        Button { isUpdatingAll = true } label: {
                            Label("Update all trips", systemImage: "slider.horizontal.3")
                        }
                        .disabled(savedTrips.isEmpty)
                    } label: {
                        Image(systemName: "bookmark")
                    }
                    .accessibilityLabel("Saved trips")
                }
            }
            .sheet(isPresented: $showsOptions) {
                PlannerOptionsSheet(
                    timeType: $timeType, date: $date, maxWalkKm: $maxWalkKm, walkSpeed: $walkSpeed,
                    maxTransfers: $maxTransfers, minResults: $minResults, onlyRoutes: $onlyRoutes
                )
                .shadSheet(detents: [.medium, .large])
            }
            .navigationDestination(for: JourneyPlan.self) { plan in
                JourneyDetailView(plan: plan, context: resultsContext)
            }
            .sheet(isPresented: $isSaving) {
                if let start, let end {
                    SaveTripSheet(start: start, end: end) { saveTrip(named: $0) }
                        .shadSheet(detents: [.medium])
                }
            }
            .sheet(isPresented: $isManaging) {
                ManageTripsSheet { apply($0) }.shadSheet(detents: [.large])
            }
            .sheet(isPresented: $isUpdatingAll) {
                GlobalTripSettingsSheet().shadSheet(detents: [.medium, .large])
            }
            .sheet(item: $reminderPlan) { plan in
                LeaveReminderSheet(plan: plan, context: resultsContext ?? currentContext)
                    .shadSheet(detents: [.large])
            }
        }
        .onChange(of: router.pendingReplan, initial: true) { _, request in
            guard let request else { return }
            router.pendingReplan = nil
            replan(request)
        }
        .onChange(of: router.pendingPlan, initial: true) { _, prefill in
            guard let prefill else { return }
            router.pendingPlan = nil
            apply(prefill)
        }
    }

    // MARK: - Form (search-form.tsx)

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 10) {
                VStack(spacing: 4) {
                    Circle().fill(Theme.primary).frame(width: 8, height: 8)
                    Rectangle().fill(Theme.border).frame(width: 1, height: 28)
                    Circle().fill(Theme.danger).frame(width: 8, height: 8)
                }
                .accessibilityHidden(true)

                VStack(spacing: 8) {
                    LocationField(placeholder: "From", storageKey: "recentStartLocations", location: $start)
                        .zIndex(2)
                    LocationField(placeholder: "To", storageKey: "recentEndLocations", location: $end)
                        .zIndex(1)
                }
                .zIndex(1)

                Button {
                    swap(&start, &end)
                } label: {
                    Image(systemName: "arrow.up.arrow.down").font(.system(size: 14, weight: .medium))
                }
                .buttonStyle(.shad(.ghost, size: .icon))
                .disabled(start == nil && end == nil)
                .accessibilityLabel("Swap locations")
            }
            .zIndex(1)

            optionsSection

            HStack(spacing: 8) {
                Button {
                    Task { await plan() }
                } label: {
                    HStack(spacing: 6) {
                        if isPlanning {
                            ProgressView().tint(Theme.primaryForeground)
                            Text("Planning")
                        } else {
                            Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .semibold))
                            Text("Plan journey")
                        }
                    }
                }
                .buttonStyle(.shad(.default, size: .pill, fullWidth: true))
                .disabled(!canPlan || isPlanning)
                .accessibilityLabel(isPlanning ? "Planning" : "Plan journey")

                Button {
                    isSaving = true
                } label: {
                    Image(systemName: justSaved ? "bookmark.fill" : "bookmark")
                        .foregroundStyle(justSaved ? Theme.success : Theme.foreground)
                }
                .buttonStyle(.shad(.outline, size: .pill))
                .frame(width: 44)
                .disabled(!canPlan)
                .accessibilityLabel("Save trip")
            }
        }
    }

    /// One row that always says what the search will use, and opens the
    /// options sheet - rather than a wall of pickers in the page.
    private var optionsSection: some View {
        Button {
            showsOptions = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "slider.horizontal.3").font(.system(size: 13, weight: .medium))
                Text(optionsSummary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
            }
            .font(.meta)
            .foregroundStyle(Theme.mutedForeground)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Options: \(optionsSummary)")
    }

    /// Every option in a few words - "Leave now · 1 km walk · Normal ·
    /// up to 5 transfers".
    private var optionsSummary: String {
        var parts: [String] = []
        switch timeType {
        case .now: parts.append("Leave now")
        case .departat: parts.append("Leave \(date.formatted(.dateTime.weekday(.abbreviated).hour().minute()))")
        case .arriveat: parts.append("Arrive by \(date.formatted(.dateTime.weekday(.abbreviated).hour().minute()))")
        }
        parts.append("\(maxWalkKm == maxWalkKm.rounded() ? String(Int(maxWalkKm)) : String(maxWalkKm)) km walk")
        parts.append(walkSpeedLabel(walkSpeed))
        parts.append(maxTransfers == 0 ? "Direct only" : "up to \(maxTransfers) transfer\(maxTransfers == 1 ? "" : "s")")
        if !onlyRoutes.isEmpty { parts.append("\(onlyRoutes.count) route\(onlyRoutes.count == 1 ? "" : "s") only") }
        return parts.joined(separator: " · ")
    }

    // MARK: - Re-plan mid-journey

    @ViewBuilder
    private var replanBanner: some View {
        if let replanSnapshot {
            Button {
                restoreReplan(replanSnapshot)
            } label: {
                HStack(spacing: 8) {
                    Label("Keep the route I was on", systemImage: "arrow.uturn.backward").font(.bodyMedium)
                    Spacer(minLength: 8)
                    if let arrival = replanSnapshot.arrivalTime {
                        Text("arrives \(arrival.formatted(date: .omitted, time: .shortened))").font(.meta).foregroundStyle(Theme.mutedForeground)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .mutedPanel()
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    /// From the tracker's "Find a better route from here": plan from the
    /// chosen stop and time to the same destination, remembering where we
    /// were so the rider can back out.
    private func replan(_ request: DeepLinkRouter.ReplanRequest) {
        path = NavigationPath()
        replanSnapshot = ReplanSnapshot(results: results, resultsContext: resultsContext, start: start, end: end,
                                        timeType: timeType, date: date, planID: request.planID,
                                        regionSlug: request.regionSlug, arrivalTime: request.arrivalTime)
        start = request.origin
        end = end ?? request.destination
        timeType = request.departAt > Date().addingTimeInterval(60) ? .departat : .now
        date = request.departAt
        Task { await plan(keepingReplanSnapshot: true) }
    }

    /// Back to the route they were on: restore the form/results and reopen
    /// its live tracking.
    private func restoreReplan(_ snapshot: ReplanSnapshot) {
        results = snapshot.results
        resultsContext = snapshot.resultsContext
        start = snapshot.start
        end = snapshot.end
        timeType = snapshot.timeType
        date = snapshot.date
        planError = nil
        replanSnapshot = nil
        router.resume(planID: snapshot.planID, regionSlug: snapshot.regionSlug)
    }

    // MARK: - Arrive-by "latest you can leave"

    @ViewBuilder
    private var latestLeaveBanner: some View {
        if resultsContext?.arriveBy == true, let latest = JourneyReminderMath.latestDeparture(results),
           let leave = latest.departureTime.date, leave > Date().addingTimeInterval(60) {
            HStack(spacing: 8) {
                (Text("Latest you can leave: ").foregroundColor(Theme.mutedForeground)
                    + Text(leave.formatted(date: .omitted, time: .shortened)).fontWeight(.semibold))
                    .font(.bodyText)
                Spacer(minLength: 8)
                Button {
                    reminderPlan = latest
                } label: {
                    Label("Remind me", systemImage: "alarm")
                }
                .buttonStyle(.shad(.outline, size: .sm))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .mutedPanel()
        }
    }

    // MARK: - Results (results-list.tsx)

    @ViewBuilder
    private var resultsList: some View {
        if !results.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("\(results.count) route\(results.count == 1 ? "" : "s") found")
                    .font(.metaMedium)
                    .foregroundStyle(Theme.mutedForeground)
                ForEach(results) { plan in
                    NavigationLink(value: plan) {
                        JourneyResultCard(plan: plan, onRemind: canRemind(plan) ? { reminderPlan = plan } : nil)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func canRemind(_ plan: JourneyPlan) -> Bool {
        guard plan.legs.contains(where: { $0.mode == "transit" }), let departure = plan.departureTime.date else { return false }
        return departure > Date().addingTimeInterval(60)
    }

    // MARK: - Actions

    private var currentContext: PlannerSearchContext {
        PlannerSearchContext(start: start, end: end, arriveBy: timeType == .arriveat, maxWalkKm: maxWalkKm,
                             walkSpeed: walkSpeed, maxTransfers: maxTransfers, onlyRoutes: onlyRoutes)
    }

    private func plan(keepingReplanSnapshot: Bool = false) async {
        guard let start, let end else { return }
        if timeType == .now { date = Date() }
        if !keepingReplanSnapshot { replanSnapshot = nil }
        isPlanning = true
        planError = nil
        results = []
        defer { isPlanning = false }
        let context = currentContext
        do {
            let request = JourneyPlanRequest(
                start: start.coordinate, end: end.coordinate, date: date, timeType: timeType,
                maxWalkKm: maxWalkKm, walkSpeed: walkSpeed, maxTransfers: maxTransfers,
                minResults: minResults, onlyRoutes: onlyRoutes.map(\.routeID)
            )
            let plans = JourneyPlanRanking.pruneDominatedPlans(try await environment.api.planJourney(request))
            results = plans
            resultsContext = context
            if plans.isEmpty { planError = "No journeys found. Try walking further or allowing more transfers." }
        } catch {
            planError = error.localizedDescription.isEmpty ? "Couldn't plan that journey." : error.localizedDescription
        }
    }

    private func saveTrip(named name: String) {
        guard let start, let end else { return }
        let trip = SavedTrip(
            name: name,
            startLabel: start.label, startCoordinate: start.coordinate,
            endLabel: end.label, endCoordinate: end.coordinate,
            maxWalkKm: maxWalkKm, walkSpeed: walkSpeed, maxTransfers: maxTransfers,
            colorHex: Swatches.color(at: savedTrips.count),
            onlyRouteIDs: onlyRoutes.map(\.routeID),
            sortOrder: savedTrips.count
        )
        trip.onlyRouteNames = onlyRoutes.map(\.name)
        trip.minResults = minResults
        modelContext.insert(trip)
        environment.toasts.show("Trip saved")
        justSaved = true
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            justSaved = false
        }
    }

    private func apply(_ trip: SavedTrip) {
        start = PlannerLocation(label: trip.startLabel, coordinate: trip.startCoordinate)
        end = PlannerLocation(label: trip.endLabel, coordinate: trip.endCoordinate)
        timeType = .now
        date = Date()
        maxWalkKm = trip.maxWalkKm
        walkSpeed = trip.walkSpeed
        maxTransfers = trip.maxTransfers
        minResults = trip.minResults
        onlyRoutes = trip.onlyRoutes
        Task { await plan() }
    }

    /// A `/plan?...` link - a recurring leave-by reminder's notification
    /// tap. Fills the form the way the web's shared-link effect does, then
    /// plans for now (the link carries no target time).
    private func apply(_ prefill: PlanPrefill) {
        start = PlannerLocation(label: prefill.startLabel, coordinate: Coordinate(latitude: prefill.startLat, longitude: prefill.startLon))
        end = PlannerLocation(label: prefill.endLabel, coordinate: Coordinate(latitude: prefill.endLat, longitude: prefill.endLon))
        if let value = prefill.maxWalkKm { maxWalkKm = value }
        if let value = prefill.walkSpeed { walkSpeed = value }
        if let value = prefill.maxTransfers { maxTransfers = value }
        if let value = prefill.minResults { minResults = value }
        if !prefill.onlyRoutes.isEmpty {
            onlyRoutes = prefill.onlyRoutes.map { RouteSearchResult(name: $0, routeID: $0) }
        }
        timeType = .now
        date = Date()
        Task { await plan() }
    }
}

// MARK: - Result card

/// One journey option - `ResultsList` row on the web: duration, leave →
/// arrive, Direct/transfers badge, an alarm button, the leg chain with
/// walk minutes and waits, a live dot on realtime-adjusted legs, and a
/// disruption banner when a ride can't be used.
struct JourneyResultCard: View {
    let plan: JourneyPlan
    var onRemind: (() -> Void)?

    private var hasDisruption: Bool {
        plan.legs.contains { $0.mode == "transit" && !$0.tripUsable }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if hasDisruption {
                Label("Service disruption on this route", systemImage: "exclamationmark.triangle")
                    .font(.geist(12, .medium, relativeTo: .caption))
                    .foregroundStyle(Theme.danger)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.danger.opacity(0.1))
            }

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(TimeFormatting.formatDuration(plan.totalDuration)).font(.number(19))
                        if let departure = plan.departureTime.date, let arrival = plan.arrivalTime.date {
                            HStack(spacing: 4) {
                                Text(departure, style: .time)
                                Image(systemName: "arrow.right").font(.system(size: 9, weight: .semibold))
                                Text(arrival, style: .time)
                            }
                            .font(.meta)
                            .foregroundStyle(Theme.mutedForeground)
                            .monospacedDigit()
                        }
                    }
                    Spacer(minLength: 8)
                    ShadBadge(text: plan.transfers == 0 ? "Direct" : "\(plan.transfers) transfer\(plan.transfers == 1 ? "" : "s")",
                              variant: plan.transfers == 0 ? .default : .secondary)
                    if let onRemind {
                        Button(action: onRemind) {
                            Image(systemName: "alarm").font(.system(size: 14))
                        }
                        .buttonStyle(.shad(.ghost, size: .iconSm))
                        .foregroundStyle(Theme.mutedForeground)
                        .accessibilityLabel("Remind me when to leave for this journey")
                    }
                }

                LegChain(legs: plan.legs)
            }
            .padding(14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusXL, style: .continuous))
        .shadCardBackground()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Options sheet

/// The planner's search options as a native form.
struct PlannerOptionsSheet: View {
    @Binding var timeType: JourneyPlanRequest.TimeType
    @Binding var date: Date
    @Binding var maxWalkKm: Double
    @Binding var walkSpeed: Double
    @Binding var maxTransfers: Int
    @Binding var minResults: Int
    @Binding var onlyRoutes: [RouteSearchResult]

    var body: some View {
        NavigationStack {
            Form {
                Section("When") {
                    Picker("When", selection: $timeType) {
                        Text("Leave now").tag(JourneyPlanRequest.TimeType.now)
                        Text("Leave at").tag(JourneyPlanRequest.TimeType.departat)
                        Text("Arrive by").tag(JourneyPlanRequest.TimeType.arriveat)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Theme.card)
                    if timeType != .now {
                        DatePicker(timeType == .arriveat ? "Arrive by" : "Leave at", selection: $date, displayedComponents: [.date, .hourAndMinute])
                            .listRowBackground(Theme.card)
                    }
                }
                Section("Walking") {
                    Picker("Max walk", selection: $maxWalkKm) {
                        ForEach(maxWalkChoices, id: \.value) { Text($0.title).tag($0.value) }
                    }
                    .listRowBackground(Theme.card)
                    Picker("Speed", selection: $walkSpeed) {
                        ForEach(walkSpeedChoices, id: \.value) { Text($0.title).tag($0.value) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Theme.card)
                }
                Section("Results") {
                    Picker("Transfers", selection: $maxTransfers) {
                        ForEach(transferChoices, id: \.value) { Text($0.title).tag($0.value) }
                    }
                    .listRowBackground(Theme.card)
                    Picker("Show", selection: $minResults) {
                        ForEach(resultCountChoices, id: \.value) { Text($0.title).tag($0.value) }
                    }
                    .listRowBackground(Theme.card)
                }
                Section {
                    RouteMultiSelect(selected: $onlyRoutes)
                        .listRowBackground(Theme.card)
                } footer: {
                    Text("Leave empty to use any route.")
                }
            }
            .scrollContentBackground(.hidden)
            .groupedPageBackground()
            .tint(Theme.primary)
            .navigationTitle("Options")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Reset") {
                        timeType = .now
                        date = Date()
                        maxWalkKm = 1
                        walkSpeed = 4.8
                        maxTransfers = 5
                        minResults = 3
                        onlyRoutes = []
                    }
                }
                DoneButton()
            }
        }
    }
}

// MARK: - Leg chain

/// A journey at a glance: start -> walk -> ride -> transfer -> ride -> end.
/// Each ride shows its mode (bus/train/ferry) with the route badge; a
/// change between rides gets a transfer marker with the wait.
struct LegChain: View {
    let legs: [JourneyLeg]

    private enum Item: Identifiable {
        case start, end
        case walk(minutes: Int, index: Int)
        case ride(JourneyLeg, index: Int)
        case transfer(waitMinutes: Int?, index: Int)

        var id: String {
            switch self {
            case .start: "start"
            case .end: "end"
            case .walk(_, let i): "walk-\(i)"
            case .ride(_, let i): "ride-\(i)"
            case .transfer(_, let i): "transfer-\(i)"
            }
        }
    }

    private var items: [Item] {
        var out: [Item] = [.start]
        var lastRideArrival: Date?
        for (index, leg) in legs.enumerated() {
            if leg.mode == "walk" {
                out.append(.walk(minutes: max(1, Int((leg.duration.timeInterval / 60).rounded())), index: index))
            } else {
                if let lastRideArrival {
                    let walkAfter = legs[..<index].reversed().prefix { $0.mode == "walk" }.reduce(0.0) { $0 + $1.duration.timeInterval }
                    let wait = leg.departureTime.date.map { Int((($0.timeIntervalSince(lastRideArrival) - walkAfter) / 60).rounded(.down)) }
                    out.append(.transfer(waitMinutes: wait.map { max(0, $0) }, index: index))
                }
                out.append(.ride(leg, index: index))
                lastRideArrival = leg.arrivalTime.date
            }
        }
        out.append(.end)
        return out
    }

    var body: some View {
        FlowLayout(spacing: 4, lineSpacing: 6) {
            let all = items
            ForEach(Array(all.enumerated()), id: \.element.id) { position, item in
                view(for: item)
                if position < all.count - 1 { connector }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var connector: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 8, weight: .semibold))
            .foregroundStyle(Theme.mutedForeground.opacity(0.7))
    }

    @ViewBuilder
    private func view(for item: Item) -> some View {
        switch item {
        case .start:
            Circle()
                .strokeBorder(Theme.foreground, lineWidth: 2)
                .frame(width: 10, height: 10)
                .padding(.horizontal, 1)
        case .end:
            Image(systemName: "flag.checkered")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.foreground)
        case .walk(let minutes, _):
            HStack(spacing: 2) {
                Image(systemName: "figure.walk").font(.system(size: 11, weight: .medium))
                Text("\(minutes)").monospacedDigit()
            }
            .font(.geist(12, relativeTo: .caption))
            .foregroundStyle(Theme.mutedForeground)
        case .ride(let leg, _):
            HStack(spacing: 4) {
                Image(systemName: leg.modeSymbol)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.foreground)
                RouteBadge(
                    name: leg.route?.routeShortName.isEmpty == false ? leg.route!.routeShortName : leg.routeID,
                    colorHex: leg.route?.routeColor ?? "",
                    dimmed: !leg.tripUsable,
                    size: 11
                )
                .overlay(alignment: .topTrailing) {
                    if let status = leg.realtimeStatus, status == "delayed" || status == "early" {
                        LiveDot(color: status == "delayed" ? Theme.warning : Theme.success)
                            .offset(x: 3, y: -3)
                    }
                }
            }
        case .transfer(let wait, _):
            HStack(spacing: 2) {
                Image(systemName: "arrow.left.arrow.right").font(.system(size: 10, weight: .semibold))
                if let wait, wait > 0 { Text("\(wait)m").monospacedDigit() }
            }
            .font(.geist(11, .medium, relativeTo: .caption))
            .foregroundStyle(Theme.mutedForeground)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(Theme.muted, in: Capsule())
        }
    }

    private var accessibilityText: String {
        items.compactMap { item in
            switch item {
            case .start: return nil
            case .end: return "arrive"
            case .walk(let minutes, _): return "walk \(minutes) minutes"
            case .ride(let leg, _):
                let name = leg.route?.routeShortName.isEmpty == false ? leg.route!.routeShortName : leg.routeID
                return "\(leg.modeName) \(name)"
            case .transfer(let wait, _): return wait.map { "transfer, \($0) minute wait" } ?? "transfer"
            }
        }
        .joined(separator: ", ")
    }
}

extension JourneyLeg {
    /// bus / train / ferry, from the route's vehicle type (or GTFS route
    /// type as a fallback).
    var modeName: String {
        let type = route?.vehicleType.lowercased() ?? ""
        if type.contains("train") || type.contains("rail") || route?.routeType == 2 { return "train" }
        if type.contains("ferry") || route?.routeType == 4 { return "ferry" }
        return "bus"
    }

    var modeSymbol: String {
        switch modeName {
        case "train": "tram.fill"
        case "ferry": "ferry.fill"
        default: "bus.fill"
        }
    }
}
