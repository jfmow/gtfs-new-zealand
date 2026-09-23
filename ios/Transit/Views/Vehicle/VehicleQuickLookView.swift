import SwiftUI
import TransitCore

/// Live view of one trip - the web's service tracker (`services/tracker`):
/// the vehicle on its route, a summary, the current/next stop, and every
/// stop with its live time. Stop reminders and route alerts hang off it.
struct VehicleQuickLookView: View {
    let tripID: String

    @Environment(AppEnvironment.self) private var environment
    @State private var vehicle: Vehicle?
    @State private var stopTimes: [StopTimeUpdate] = []
    // The realtime `stopTimes` response only carries stop *ids* (see
    // `StopTimeUpdate` - no name field exists there at all), so the list
    // used to print raw ids like "7034-7b36cf5b". This is the static list
    // of this trip's actual stops (name, platform, sequence) fetched once
    // and joined against `stopTimes` by parent stop id, same as the web
    // app's `fetchStopsForTrip` + `getStopTime` pairing in
    // `tracker/stops-list.tsx`.
    @State private var tripStops: [TripStopRef] = []
    @State private var shape: RouteShape?
    @State private var errorMessage: String?
    @State private var pollTask: Task<Void, Never>?

    // MARK: - One-shot reminders (get off / arriving / N stops away)
    // Mirrors `tracker/stops-list.tsx`'s reminder flow: pick a type from the
    // bell menu, then tap the stop it applies to. "leave" (the fourth web
    // type) isn't offered here - that one needs a full journey plan (origin,
    // walk time) to compute against, which this trip-only view doesn't have;
    // it's covered by the Planner's "Remind me when to leave" instead.
    // `ReminderKind`/`ReminderStatus` live in `TripReminders.swift` - shared
    // with `JourneyTrackingView`, which offers the same menu for whichever
    // leg it's currently tracking.
    @State private var isSelectingReminder = false
    @State private var reminderType: ReminderKind?
    @State private var nStopsAway = 1
    @State private var reminderStatus: ReminderStatus?
    @State private var isSavingReminder = false
    @State private var isShowingReminderPicker = false
    @State private var isShowingRouteAlerts = false

    // Web's collapse rule in `tracker/stops-list.tsx`: 1 stop behind the
    // current/next one stays visible, 6 ahead stay visible, the rest
    // collapse behind "Show N more stops" - only when the list is long
    // enough that collapsing is worth it (> KEEP_BEHIND + KEEP_AHEAD + 5).
    private static let keepBehind = 1
    private static let keepAhead = 6
    @State private var showCollapsedStops = false
    /// The map follows the vehicle until the rider pans it; the recentre
    /// button hands it back (same as the journey tracker).
    @State private var autoFollow = true
    @State private var cameraResetToken = 0

    /// This trip's current/next stop, from the vehicle feed
    /// (`vehicle.trip.current_stop`/`next_stop`) - same fields the web
    /// tracker uses for its "Current Stop"/"Next" banner and row
    /// highlighting.
    private var currentStopID: String? { vehicle?.trip?.currentStop?.parentStopID }
    private var nextStopID: String? { vehicle?.trip?.nextStop?.parentStopID }
    private var currentSequence: Int? { vehicle?.trip?.currentStop?.sequence }
    private var nextSequence: Int? { vehicle?.trip?.nextStop?.sequence }

    typealias StopRowData = (parentStopID: String, sequence: Int, name: String, platform: String, stopTime: StopTimeUpdate?)

    /// `tripStops` (which has names, and the correct stop order via
    /// `sequence`) as the row source, with each `stopTimes` entry attached
    /// by parent stop id for its live time/passed/skipped state. Falls back
    /// to `stopTimes` order/id if the static stop list hasn't loaded yet
    /// (or failed) rather than showing nothing.
    ///
    /// Joined by platform (child stop) first: a trip can call at the same
    /// station twice (Southern line trains at Newmarket, via the CRL), and
    /// a parent-station join gave both visits the first one's time.
    private var rows: [StopRowData] {
        guard !tripStops.isEmpty else {
            return stopTimes.enumerated().map { (parentStopID: $1.parentStopID, sequence: $0 + 1, name: $1.parentStopID, platform: "", stopTime: $1) }
        }
        let timesByChild = Dictionary(stopTimes.map { ($0.childStopID, $0) }, uniquingKeysWith: { first, _ in first })
        let timesByParent = Dictionary(stopTimes.map { ($0.parentStopID, $0) }, uniquingKeysWith: { first, _ in first })
        return tripStops
            .sorted { $0.sequence < $1.sequence }
            .map { stop in
                (parentStopID: stop.parentStopID, sequence: stop.sequence, name: stop.name, platform: stop.platform,
                 stopTime: timesByChild[stop.childStopID] ?? timesByParent[stop.parentStopID])
            }
    }

    /// Only stops not yet passed can sensibly be picked for a reminder -
    /// matches the web's `visibleStops` filter while `isSelectingReminder`.
    private var reminderCandidateRows: [StopRowData] {
        rows.filter { $0.stopTime?.passed != true }
    }

    var body: some View {
        VStack(spacing: 0) {
            TransitMapView(
                vehicles: vehicle.map { [VehicleAnnotation(vehicle: $0)] } ?? [],
                polylines: shape.map { [RoutePolylineData(id: tripID, coordinates: $0.geojson.geometry.lineCoordinates, colorHex: !$0.color.isEmpty ? $0.color : (vehicle?.route.color.isEmpty == false ? vehicle!.route.color : environment.region.brandColorHex))] } ?? [],
                camera: autoFollow && vehicle != nil ? .follow(annotationID: tripID, spanMeters: 1400) : .none,
                onUserInteraction: { if autoFollow { autoFollow = false } },
                cameraResetToken: cameraResetToken
            )
            .frame(height: 280)
            .overlay(alignment: .bottomTrailing) {
                if !autoFollow {
                    Button {
                        autoFollow = true
                        cameraResetToken += 1
                    } label: {
                        Image(systemName: "scope")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.foreground)
                            .frame(width: 40, height: 40)
                            .background(.ultraThinMaterial, in: Circle())
                            .overlay(Circle().strokeBorder(Theme.border, lineWidth: 1))
                    }
                    .padding(12)
                    .accessibilityLabel("Follow the vehicle")
                }
            }

            VStack(spacing: 10) {
                if let vehicle { summaryHeader(vehicle) }
                if isSelectingReminder, let reminderType {
                    ReminderBanner(kind: reminderType, nStopsAway: $nStopsAway)
                }
                if let reminderStatus {
                    ReminderStatusBanner(status: reminderStatus) {
                        if self.reminderStatus == reminderStatus { self.reminderStatus = nil }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)

            if !rows.isEmpty {
                ScrollViewReader { scrollProxy in
                    ScrollView {
                        VStack(spacing: 0) {
                            let indices = visibleRowIndices
                            ForEach(Array(indices.enumerated()), id: \.offset) { position, rowIndex in
                                let row = rows[rowIndex]
                                stopRow(row, isCurrent: row.sequence == currentSequence && vehicle?.state == "AtStop",
                                        isNext: row.sequence == nextSequence && vehicle?.state != "AtStop",
                                        isLast: position == indices.count - 1)
                                    .id(rowIndex)
                                    .contentShape(Rectangle())
                                    .onTapGesture {
                                        guard isSelectingReminder else { return }
                                        Task { await confirmReminder(for: row) }
                                    }
                            }
                            if !isSelectingReminder, collapsedCount > 0 {
                                RowDivider()
                                Button("Show \(collapsedCount) more stops") {
                                    withAnimation { showCollapsedStops = true }
                                }
                                .buttonStyle(.shad(.ghost, size: .sm))
                                .padding(.vertical, 6)
                            }
                        }
                        .padding(.vertical, 6)
                        .shadCardBackground()
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusXL, style: .continuous))
                        .padding(16)
                    }
                    // Keep the current/next stop in view as the vehicle
                    // moves, like the web's scroll-into-view.
                    .onChange(of: currentSequence ?? nextSequence) { _, _ in
                        scrollToTrackedStop(scrollProxy)
                    }
                    .task { scrollToTrackedStop(scrollProxy) }
                }
            } else if let errorMessage {
                Text(errorMessage).font(.bodyText).foregroundStyle(Theme.mutedForeground).padding(16)
                Spacer()
            } else {
                ProgressView().padding(24)
                Spacer()
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !isSelectingReminder {
                Button {
                    isShowingReminderPicker = true
                } label: {
                    Label("Set a reminder", systemImage: "bell")
                }
                .buttonStyle(.shad(.outline, size: .pill, fullWidth: true))
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Theme.background)
            }
        }
        .pageBackground()
        .navigationTitle("Live tracking")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isSelectingReminder {
                    Button("Cancel", action: cancelReminderSelection)
                } else if let vehicle {
                    // Reminders are the bottom button; this is the route's
                    // service alerts (one bell, not two).
                    Button { isShowingRouteAlerts = true } label: { Image(systemName: "exclamationmark.bubble") }
                        .accessibilityLabel("Alerts for route \(vehicle.route.name)")
                }
            }
        }
        .confirmationDialog("Set a reminder", isPresented: $isShowingReminderPicker, titleVisibility: .visible) {
            ForEach(ReminderKind.allCases) { kind in
                Button(kind.menuLabel) { beginSelectingReminder(kind) }
            }
        }
        .sheet(isPresented: $isShowingRouteAlerts) {
            if let vehicle {
                AlertSubscriptionSheet(target: .route(id: vehicle.route.id, title: "Route \(vehicle.route.name)"))
                    .shadSheet(detents: [.large])
            }
        }
        .task { await start() }
        .onDisappear { pollTask?.cancel() }
    }

    /// Route tile, where it's heading, the next stop, and a countdown to it;
    /// then live chips - the same header as the journey tracker's drawer.
    @ViewBuilder
    private func summaryHeader(_ vehicle: Vehicle) -> some View {
        let hex = vehicle.route.color.isEmpty ? "525252" : vehicle.route.color
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 14) {
                Text(vehicle.route.name)
                    .font(.geist(18, .bold, relativeTo: .title3))
                    .foregroundStyle(RouteColors.text(onHex: hex))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .padding(.horizontal, 4)
                    .frame(width: 52, height: 52)
                    .background(Color(hex: hex), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(vehicle.trip.map { TimeFormatting.niceLookingWords($0.headsign) } ?? vehicle.route.name)
                        .font(.geist(18, .semibold, relativeTo: .title3))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    if let line = nextStopLine {
                        Text(line).font(.meta).foregroundStyle(Theme.mutedForeground).lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let eta = nextStopETA {
                    TimelineView(.periodic(from: .now, by: 15)) { context in
                        VStack(alignment: .trailing, spacing: 0) {
                            Text(JourneyTrackingView.minutesText(until: eta, now: context.date)).font(.number(24))
                            Text(vehicle.state == "AtStop" ? "at stop" : "to next stop")
                                .font(.geist(12, relativeTo: .caption)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                }
            }
            FlowLayout(spacing: 6, lineSpacing: 6) {
                HStack(spacing: 5) {
                    LiveDot(color: Theme.success)
                    Text("Live")
                }
                .modifier(StatusChipStyle())
                if vehicle.occupancy >= 0 {
                    HStack(spacing: 4) {
                        OccupancyIconsView(occupancy: vehicle.occupancy)
                        Text(OccupancyText.label(vehicle.occupancy))
                    }
                    .modifier(StatusChipStyle())
                }
                if let platform = vehicle.trip?.nextStop?.platform, !platform.isEmpty {
                    Text("Platform \(platform)").modifier(StatusChipStyle())
                }
                if vehicle.offCourse {
                    Label("Off course", systemImage: "exclamationmark.triangle.fill").modifier(StatusChipStyle(tint: Theme.warning))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// "At Newmarket" / "Next: Newmarket, platform 2".
    private var nextStopLine: String? {
        if vehicle?.state == "AtStop", let currentSequence, let row = rows.first(where: { $0.sequence == currentSequence }) {
            return "At \(row.name)"
        }
        if let nextSequence, let row = rows.first(where: { $0.sequence == nextSequence }) {
            return "Next: \(row.name)"
        }
        return nil
    }

    private var nextStopETA: Date? {
        guard let next = vehicle?.trip?.nextStop,
              let stopTime = stopTimes.first(where: { $0.childStopID == next.childStopID }) ?? stopTimes.first(where: { $0.parentStopID == next.parentStopID })
        else { return nil }
        return stopTime.arrivalTime.date
    }

    /// Web's collapse rule: keep `keepBehind` stops before, and
    /// `keepAhead` stops after, the current/next stop expanded; collapse
    /// the rest behind "Show N more stops" - only when there's actually
    /// enough list to make collapsing worthwhile.
    private var trackedRowIndex: Int? {
        rows.firstIndex { $0.sequence == currentSequence || $0.sequence == nextSequence }
    }

    private var collapsingActive: Bool {
        !isSelectingReminder && trackedRowIndex != nil && rows.count > Self.keepBehind + Self.keepAhead + 5
    }

    private var visibleRowIndices: [Int] {
        let source = isSelectingReminder ? reminderCandidateRows : rows
        guard collapsingActive, !showCollapsedStops, let anchor = trackedRowIndex else {
            return Array(source.indices)
        }
        return source.indices.filter { index in
            let inCollapsedPastRange = index < anchor - Self.keepBehind
            let inCollapsedFutureRange = index > anchor + Self.keepAhead && index != source.count - 1
            return !inCollapsedPastRange && !inCollapsedFutureRange
        }
    }

    private var collapsedCount: Int {
        guard collapsingActive, !showCollapsedStops else { return 0 }
        return rows.count - visibleRowIndices.count
    }

    private func scrollToTrackedStop(_ proxy: ScrollViewProxy) {
        guard let index = trackedRowIndex, visibleRowIndices.contains(index) else { return }
        withAnimation { proxy.scrollTo(index, anchor: .center) }
    }

    /// A stop on the timeline: arrival time, the route-coloured line (dim
    /// once passed), and the current/next stop highlighted edge to edge.
    @ViewBuilder
    private func stopRow(_ row: StopRowData, isCurrent: Bool, isNext: Bool, isLast: Bool) -> some View {
        let passed = row.stopTime?.passed ?? false
        let hex = vehicle?.route.color.isEmpty == false ? vehicle!.route.color : "525252"
        TimelineRow(
            time: row.stopTime?.arrivalTime.date,
            rail: isLast ? .none : .solid(Color(hex: hex), dimmed: passed),
            marker: .stop(passed && !isCurrent ? Theme.border : Color(hex: hex)),
            highlighted: isCurrent || isNext,
            accent: isCurrent ? Theme.danger : Theme.live
        ) {
            HStack(spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.name)
                        .font(isCurrent || isNext ? .bodyMedium : .bodyText)
                        .foregroundStyle(passed ? Theme.mutedForeground : Theme.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                    if isCurrent || isNext {
                        Text(isCurrent ? "At this stop" : "Next stop")
                            .font(.geist(11, .medium, relativeTo: .caption2))
                            .foregroundStyle(isCurrent ? Theme.danger : Theme.live)
                    }
                }
                Spacer(minLength: 6)
                if row.stopTime?.skipped == true {
                    Text("Skipped").font(.metaMedium).foregroundStyle(Theme.danger)
                }
                if !row.platform.isEmpty {
                    ShadBadge(text: "Plat. \(row.platform)", variant: .outline)
                }
                if isSelectingReminder {
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
                }
            }
            .padding(.vertical, 10)
        }
        .opacity(passed && !isCurrent ? 0.55 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityValue(isCurrent ? "Current stop" : isNext ? "Next stop" : passed ? "Passed" : "")
    }

    private func start() async {
        async let shapeFetch: () = loadShape()
        async let stopsFetch: () = loadTripStops()
        await refresh()
        await shapeFetch
        await stopsFetch
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

    private func loadTripStops() async {
        tripStops = (try? await environment.api.stopsForTrip(tripID: tripID)) ?? []
    }

    // MARK: - Reminders

    private func beginSelectingReminder(_ kind: ReminderKind) {
        reminderType = kind
        nStopsAway = 1
        isSelectingReminder = true
    }

    private func cancelReminderSelection() {
        isSelectingReminder = false
        reminderType = nil
    }

    private func confirmReminder(for row: StopRowData) async {
        guard let reminderType, !isSavingReminder else { return }
        isSavingReminder = true
        defer { isSavingReminder = false }
        do {
            try await environment.api.addReminder(
                tripID: tripID,
                stopID: row.parentStopID,
                type: reminderType.rawValue,
                offset: reminderType == .nStopsAway ? nStopsAway : nil
            )
            reminderStatus = .success(reminderType.confirmationText(stopName: row.name, nStopsAway: nStopsAway))
        } catch {
            reminderStatus = .failure(error.localizedDescription)
        }
        isSelectingReminder = false
        self.reminderType = nil
    }
}
