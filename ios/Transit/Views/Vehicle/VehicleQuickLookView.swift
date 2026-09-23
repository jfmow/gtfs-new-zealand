import SwiftUI
import TransitCore

/// Live view of one trip - the web's service tracker (`services/tracker`):
/// a full-screen map that follows the vehicle, with every stop marked by
/// progress (next, current, passed, your stop, end - the web's marker
/// icons), and a drawer over it holding the summary and the stop list.
/// Tap any upcoming stop to be reminded about it.
struct VehicleQuickLookView: View {
    let tripID: String
    /// The stop this was opened from (a board) - marked "your stop".
    var fromStopName: String?

    @Environment(AppEnvironment.self) private var environment
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var vehicle: Vehicle?
    @State private var stopTimes: [StopTimeUpdate] = []
    // The realtime `stopTimes` response only carries stop *ids*, so the
    // static list of this trip's stops (name, platform, sequence, position)
    // is fetched once and joined against it - the web's
    // `fetchStopsForTrip` + `getStopTime` pairing.
    @State private var tripStops: [TripStopRef] = []
    @State private var shape: RouteShape?
    @State private var hasLoaded = false
    @State private var pollTask: Task<Void, Never>?

    @State private var drawer: DrawerDetent = .medium
    @State private var headerHeight: CGFloat = 150
    /// The map follows the vehicle until the rider pans it; the follow
    /// button hands it back.
    @State private var autoFollow = true
    @State private var cameraResetToken = 0

    @State private var showEarlierStops = false
    @State private var reminderStop: StopRowData?
    /// Stops given a reminder while this screen was open (the API has no
    /// way to list existing one-shot reminders).
    @State private var remindedStops: Set<Int> = []
    @State private var isShowingRouteAlerts = false

    private var currentSequence: Int? { vehicle?.trip?.currentStop?.sequence }
    private var nextSequence: Int? { vehicle?.trip?.nextStop?.sequence }
    private var isAtStop: Bool { vehicle?.state == "AtStop" }
    private var routeHex: String {
        if let color = vehicle?.route.color, !color.isEmpty { return color }
        if let color = shape?.color, !color.isEmpty { return color }
        return environment.region.brandColorHex
    }

    struct StopRowData: Identifiable, Equatable {
        let parentStopID: String
        let sequence: Int
        let name: String
        let platform: String
        let coordinate: Coordinate?
        let stopTime: StopTimeUpdate?
        var id: Int { sequence }

        static func == (a: StopRowData, b: StopRowData) -> Bool { a.sequence == b.sequence && a.parentStopID == b.parentStopID }
    }

    /// `tripStops` (names, order) with each live stop time attached - joined
    /// by platform (child stop) first, since a trip can call at the same
    /// station twice (Southern line trains at Newmarket, via the CRL).
    private var rows: [StopRowData] {
        guard !tripStops.isEmpty else {
            return stopTimes.enumerated().map {
                StopRowData(parentStopID: $1.parentStopID, sequence: $0 + 1, name: $1.parentStopID, platform: "", coordinate: nil, stopTime: $1)
            }
        }
        let timesByChild = Dictionary(stopTimes.map { ($0.childStopID, $0) }, uniquingKeysWith: { first, _ in first })
        let timesByParent = Dictionary(stopTimes.map { ($0.parentStopID, $0) }, uniquingKeysWith: { first, _ in first })
        return tripStops
            .sorted { $0.sequence < $1.sequence }
            .map { stop in
                StopRowData(parentStopID: stop.parentStopID, sequence: stop.sequence, name: stop.name, platform: stop.platform,
                            coordinate: Coordinate(latitude: stop.lat, longitude: stop.lon),
                            stopTime: timesByChild[stop.childStopID] ?? timesByParent[stop.parentStopID])
            }
    }

    // MARK: - Stop state (shared by the map markers and the list)

    private enum StopState { case passed, current, next, upcoming }

    private func state(of row: StopRowData) -> StopState {
        if let currentSequence, row.sequence == currentSequence, isAtStop { return .current }
        if let nextSequence, row.sequence == nextSequence { return .next }
        if let currentSequence, row.sequence <= currentSequence { return .passed }
        if row.stopTime?.passed == true { return .passed }
        return .upcoming
    }

    private func isYourStop(_ row: StopRowData) -> Bool {
        guard let fromStopName, !fromStopName.isEmpty else { return false }
        return row.name.caseInsensitiveCompare(fromStopName) == .orderedSame
            || fromStopName.localizedCaseInsensitiveContains(row.name) || row.name.localizedCaseInsensitiveContains(fromStopName)
    }

    /// The web's `trackedStopIcon`: next, your stop, end, current, start,
    /// then passed/upcoming dots.
    private func markerKind(_ row: StopRowData, isFirst: Bool, isLast: Bool) -> TripStopAnnotation.Kind {
        let state = state(of: row)
        if state == .next { return .next }
        if isYourStop(row) { return .marked }
        if isLast { return .end }
        if state == .current { return .current }
        if isFirst { return .start }
        return state == .passed ? .passed : .upcoming
    }

    private var tripStopAnnotations: [TripStopAnnotation] {
        let all = rows
        return all.enumerated().compactMap { index, row in
            guard let coordinate = row.coordinate else { return nil }
            let time = row.stopTime.map { $0.arrivalTime.date.formatted(date: .omitted, time: .shortened) }
            let detail = [row.platform.isEmpty ? nil : "Platform \(row.platform)", time].compactMap { $0 }.joined(separator: " · ")
            return TripStopAnnotation(
                id: "\(row.sequence)-\(row.parentStopID)",
                coordinate: .init(latitude: coordinate.latitude, longitude: coordinate.longitude),
                name: row.name, detail: detail.isEmpty ? nil : detail,
                kind: markerKind(row, isFirst: index == 0, isLast: index == all.count - 1)
            )
        }
    }

    // MARK: - Body

    var body: some View {
        GeometryReader { proxy in
            let fullHeight = proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom
            ZStack(alignment: .top) {
                TransitMapView(
                    vehicles: vehicle.map { [VehicleAnnotation(vehicle: $0)] } ?? [],
                    tripStops: tripStopAnnotations,
                    polylines: shape.map { [RoutePolylineData(id: tripID, coordinates: $0.geojson.geometry.lineCoordinates, colorHex: routeHex)] } ?? [],
                    camera: !autoFollow ? .none : vehicle != nil ? .follow(annotationID: tripID, spanMeters: 1400)
                        : tripStops.isEmpty ? .none : .frame(points: tripStops.map { Coordinate(latitude: $0.lat, longitude: $0.lon) }, minSpanMeters: 800),
                    cameraInsets: UIEdgeInsets(
                        top: proxy.safeAreaInsets.top + 60, left: 0,
                        bottom: min(drawerHeight(available: proxy.size.height), fullHeight * 0.6) + proxy.safeAreaInsets.bottom, right: 0
                    ),
                    onUserInteraction: { if autoFollow { autoFollow = false } },
                    cameraResetToken: cameraResetToken
                )
                .ignoresSafeArea()

                topBar

                BottomDrawer(
                    detent: $drawer,
                    collapsedHeight: headerHeight,
                    availableHeight: proxy.size.height
                ) {
                    drawerHeader
                        .background(GeometryReader { g in
                            Color.clear.onAppear { headerHeight = g.size.height + 19 }
                                .onChange(of: g.size.height) { _, h in headerHeight = h + 19 }
                        })
                } content: {
                    drawerContent
                }
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .sheet(item: $reminderStop) { row in
            StopReminderSheet(stopName: row.name, time: row.stopTime?.arrivalTime.date) { kind, offset in
                await setReminder(kind, offset: offset, for: row)
            }
            .shadSheet(detents: [.medium])
        }
        .sheet(isPresented: $isShowingRouteAlerts) {
            if let vehicle {
                AlertSubscriptionSheet(target: .route(id: vehicle.route.id, title: "Route \(vehicle.route.name)"))
                    .shadSheet(detents: [.large])
            }
        }
        .task { await start() }
        .onAppear { router.isFullScreenMapVisible = true }
        .onDisappear {
            router.isFullScreenMapVisible = false
            pollTask?.cancel()
        }
    }

    private func drawerHeight(available: CGFloat) -> CGFloat {
        BottomDrawer<EmptyView, EmptyView>.height(for: drawer, collapsed: headerHeight, available: available, topClearance: 110)
    }

    /// Back, route alerts and follow - floating over the map in place of a
    /// navigation bar.
    private var topBar: some View {
        HStack(spacing: 8) {
            FloatingBarButton {
                Button { dismiss() } label: { Image(systemName: "chevron.left") }
                    .accessibilityLabel("Back")
            }
            Spacer()
            if let vehicle {
                FloatingBarButton {
                    Button { isShowingRouteAlerts = true } label: { Image(systemName: "exclamationmark.bubble") }
                        .accessibilityLabel("Alerts for route \(vehicle.route.name)")
                }
            }
            FloatingBarButton {
                Button {
                    autoFollow = true
                    cameraResetToken += 1
                } label: {
                    Image(systemName: autoFollow ? "location.north.circle.fill" : "location.north.circle")
                        .foregroundStyle(autoFollow ? Theme.live : Theme.foreground)
                }
                .accessibilityLabel(autoFollow ? "Following the vehicle" : "Follow the vehicle")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    // MARK: - Drawer

    @ViewBuilder
    private var drawerHeader: some View {
        if let vehicle {
            summaryHeader(vehicle)
                .padding(.horizontal, 16)
                .padding(.bottom, 14)
        } else if hasLoaded {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "antenna.radiowaves.left.and.right.slash")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Theme.mutedForeground)
                    .frame(width: 44, height: 44)
                    .background(Theme.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text("No live position yet").font(.geist(17, .semibold, relativeTo: .headline))
                    Text("This trip isn't sending its location - the times below are from the timetable.")
                        .font(.meta).foregroundStyle(Theme.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        } else {
            HStack(spacing: 8) {
                ProgressView()
                Text("Finding the vehicle...").font(.meta).foregroundStyle(Theme.mutedForeground)
            }
            .padding(.bottom, 16)
        }
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
                            Text(isAtStop ? "at stop" : "to next stop")
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
                if let away = stopsUntilYourStop {
                    Text(away == 0 ? "At your stop" : away == 1 ? "Your stop is next" : "\(away) stops to your stop")
                        .modifier(StatusChipStyle(tint: Theme.live))
                }
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

    /// "At Newmarket" / "Next: Newmarket".
    private var nextStopLine: String? {
        if isAtStop, let currentSequence, let row = rows.first(where: { $0.sequence == currentSequence }) {
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

    /// Stops the vehicle still has to reach, up to and including the
    /// rider's: 0 only while it's actually stopped there, 1 when it's next.
    /// Counted from the stop it's at (if stopped) or heading to - counting
    /// from `next` without including the rider's stop came out one short,
    /// and said "at your stop" while it was still on the way.
    private var stopsUntilYourStop: Int? {
        guard let yours = rows.first(where: isYourStop) else { return nil }
        if isAtStop, let current = currentSequence {
            guard yours.sequence >= current else { return nil }
            return rows.filter { $0.sequence > current && $0.sequence <= yours.sequence }.count
        }
        guard let next = nextSequence ?? currentSequence.map({ $0 + 1 }), yours.sequence >= next else { return nil }
        return rows.filter { $0.sequence >= next && $0.sequence <= yours.sequence }.count
    }

    // MARK: - Stop list

    private var passedRows: [StopRowData] { rows.filter { state(of: $0) == .passed } }
    private var aheadRows: [StopRowData] { rows.filter { state(of: $0) != .passed } }

    @ViewBuilder
    private var drawerContent: some View {
        if rows.isEmpty {
            if !hasLoaded { ProgressView().padding(24) }
        } else {
            ScrollViewReader { scrollProxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Tap a stop to get a reminder", systemImage: "bell")
                            .font(.meta)
                            .foregroundStyle(Theme.mutedForeground)
                            .padding(.horizontal, 4)
                        VStack(spacing: 0) {
                            if !passedRows.isEmpty {
                                Button {
                                    withAnimation(.easeOut(duration: 0.2)) { showEarlierStops.toggle() }
                                } label: {
                                    HStack(spacing: 8) {
                                        Image(systemName: showEarlierStops ? "chevron.up" : "chevron.down")
                                            .font(.system(size: 11, weight: .semibold))
                                        Text(showEarlierStops ? "Hide earlier stops" : "\(passedRows.count) earlier stop\(passedRows.count == 1 ? "" : "s")")
                                        Spacer()
                                    }
                                    .font(.metaMedium)
                                    .foregroundStyle(Theme.mutedForeground)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 12)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                if showEarlierStops {
                                    ForEach(passedRows) { stopRow($0, isLast: false) }
                                }
                            }
                            let ahead = aheadRows
                            ForEach(Array(ahead.enumerated()), id: \.element.id) { index, row in
                                stopRow(row, isLast: index == ahead.count - 1)
                                    .id(row.sequence)
                            }
                        }
                        .padding(.vertical, 4)
                        .shadCardBackground()
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusXL, style: .continuous))
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .onChange(of: nextSequence) { _, next in
                    if let next { withAnimation { scrollProxy.scrollTo(next, anchor: .top) } }
                }
            }
        }
    }

    /// A stop on the timeline: arrival time, the route-coloured line (dim
    /// once passed), a marker matching the map's, and "in N min" for the
    /// stops coming up. The next/current stop is highlighted edge to edge.
    @ViewBuilder
    private func stopRow(_ row: StopRowData, isLast: Bool) -> some View {
        let state = state(of: row)
        let yours = isYourStop(row)
        let color = Color(hex: routeHex)
        let tappable = state != .passed
        Button {
            if tappable { reminderStop = row }
        } label: {
            TimelineRow(
                time: row.stopTime?.arrivalTime.date,
                rail: isLast ? .none : .solid(color, dimmed: state == .passed),
                marker: marker(for: state, yours: yours, isLast: isLast, color: color),
                highlighted: state == .next || state == .current,
                accent: state == .current ? Theme.warning : Theme.live,
                incoming: row.sequence == rows.first?.sequence ? .none : .solid(color, dimmed: state == .passed || state == .current)
            ) {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(row.name)
                            .font(state == .next || state == .current || yours ? .bodyMedium : .bodyText)
                            .foregroundStyle(state == .passed ? Theme.mutedForeground : Theme.foreground)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 6) {
                            if state == .current { tag("At this stop", Theme.warning) }
                            if state == .next { tag("Next stop", Theme.live) }
                            if yours { tag("Your stop", Theme.danger) }
                            if row.stopTime?.skipped == true { tag("Skipped", Theme.danger) }
                            if !row.platform.isEmpty {
                                Text("Plat. \(row.platform)").font(.geist(11, relativeTo: .caption2)).foregroundStyle(Theme.mutedForeground)
                            }
                        }
                    }
                    Spacer(minLength: 6)
                    if remindedStops.contains(row.sequence) {
                        Image(systemName: "bell.fill").font(.system(size: 12)).foregroundStyle(Theme.live)
                            .accessibilityLabel("Reminder set")
                    }
                    if state != .passed, let date = row.stopTime?.arrivalTime.date {
                        TimelineView(.periodic(from: .now, by: 30)) { context in
                            let minutes = Int((date.timeIntervalSince(context.date) / 60).rounded(.up))
                            if minutes >= 0 && minutes < 90 {
                                Text(minutes <= 0 ? "Now" : "\(minutes) min")
                                    .font(.geistMono(12, medium: true, relativeTo: .caption))
                                    .foregroundStyle(state == .next ? Theme.live : Theme.mutedForeground)
                            }
                        }
                    }
                }
                .padding(.vertical, 10)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!tappable)
        .opacity(state == .passed ? 0.6 : 1)
        .accessibilityValue(state == .current ? "Vehicle at this stop" : state == .next ? "Next stop" : state == .passed ? "Passed" : "")
        .accessibilityHint(tappable ? "Set a reminder for this stop" : "")
    }

    private func marker(for state: StopState, yours: Bool, isLast: Bool, color: Color) -> TimelineMarker {
        if yours { return .icon("mappin", Theme.danger) }
        if isLast { return .destination }
        switch state {
        case .next: return .icon("arrowtriangle.down.fill", Theme.live)
        case .current: return .stop(Theme.warning)
        case .passed: return .stop(Theme.border)
        case .upcoming: return .stop(color)
        }
    }

    private func tag(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(.geist(11, .medium, relativeTo: .caption2))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(color.opacity(0.12), in: Capsule())
    }

    // MARK: - Data

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
        // Independent: a trip with no live vehicle yet (the API errors with
        // "no vehicles found") still has its stop times to show.
        async let vehicles = try? environment.api.liveVehicles(tripIDs: [tripID])
        async let times = try? environment.api.stopTimes(tripID: tripID)
        // Keep the last position if a poll comes back empty.
        if let fresh = await vehicles?.first { vehicle = fresh }
        if let fresh = await times { stopTimes = fresh }
        hasLoaded = true
    }

    private func loadShape() async {
        shape = try? await environment.api.routeShape(tripID: tripID)
    }

    private func loadTripStops() async {
        tripStops = (try? await environment.api.stopsForTrip(tripID: tripID)) ?? []
    }

    // MARK: - Reminders

    private func setReminder(_ kind: ReminderKind, offset: Int, for row: StopRowData) async -> Bool {
        if !environment.push.isAuthorized { await environment.push.requestPermission() }
        do {
            try await environment.api.addReminder(
                tripID: tripID,
                stopID: row.parentStopID,
                type: kind.rawValue,
                offset: kind == .nStopsAway ? offset : nil
            )
            remindedStops.insert(row.sequence)
            environment.toasts.show(kind.confirmationText(stopName: row.name, nStopsAway: offset))
            return true
        } catch {
            environment.toasts.show(error.localizedDescription.isEmpty ? "Couldn't set the reminder" : error.localizedDescription, .error)
            return false
        }
    }
}

/// What to be reminded about for one stop of a live trip - replaces the
/// old "pick a type, then tap a stop" mode: the stop is already chosen.
struct StopReminderSheet: View {
    let stopName: String
    let time: Date?
    let onSet: (ReminderKind, Int) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var stopsBefore = 2
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    option(.getOff, title: "Get off here", detail: "When this is the next stop", icon: "figure.walk.arrival")
                    option(.arrival, title: "When it's arriving", detail: "As the vehicle reaches this stop", icon: "location.fill")
                    Button {
                        Task { await set(.nStopsAway) }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "number.circle").frame(width: 24).foregroundStyle(Theme.live)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(stopsBefore) stop\(stopsBefore == 1 ? "" : "s") before").foregroundStyle(Theme.foreground)
                                Text("A heads-up while it's on the way").font(.meta).foregroundStyle(Theme.mutedForeground)
                            }
                            Spacer(minLength: 8)
                            Stepper("Stops before", value: $stopsBefore, in: 1...20)
                                .labelsHidden()
                        }
                    }
                    .disabled(isSaving)
                    .listRowBackground(Theme.card)
                } header: {
                    Text("Notify me")
                } footer: {
                    Text("A one-off notification for this trip.")
                }
            }
            .scrollContentBackground(.hidden)
            .groupedPageBackground()
            .tint(Theme.primary)
            .navigationTitle(stopName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if let time {
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 0) {
                            Text(stopName).font(.bodyMedium).lineLimit(1)
                            Text(time, style: .time).font(.meta).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                }
            }
        }
    }

    private func option(_ kind: ReminderKind, title: String, detail: String, icon: String) -> some View {
        Button {
            Task { await set(kind) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon).frame(width: 24).foregroundStyle(Theme.live)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(Theme.foreground)
                    Text(detail).font(.meta).foregroundStyle(Theme.mutedForeground)
                }
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .disabled(isSaving)
        .listRowBackground(Theme.card)
    }

    private func set(_ kind: ReminderKind) async {
        isSaving = true
        defer { isSaving = false }
        if await onSet(kind, stopsBefore) { dismiss() }
    }
}
