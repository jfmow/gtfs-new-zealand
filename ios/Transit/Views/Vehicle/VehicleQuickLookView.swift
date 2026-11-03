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
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var vehicle: Vehicle?
    @State private var stopTimes: [StopTimeUpdate] = []
    // The realtime `stopTimes` response only carries stop *ids*, so the
    // static list of this trip's stops (name, platform, sequence, position)
    // is fetched once and joined against it - the web's
    // `fetchStopsForTrip` + `getStopTime` pairing.
    @State private var tripStops: [TripStopRef] = []
    @State private var shape: RouteShape?
    @State private var hasLoaded = false

    /// Regular width: the summary and stop list in a side panel rather than
    /// the bottom drawer (`MapSidePanel`).
    private var usesSidePanel: Bool { horizontalSizeClass == .regular }

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
    @AppStorage(Map3D.storageKey) private var is3D = false

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
                StopRowData(parentStopID: stop.parentStopID, sequence: stop.sequence, name: Self.cleanStopName(stop.label), platform: stop.platform,
                            coordinate: Coordinate(latitude: stop.lat, longitude: stop.lon),
                            stopTime: timesByChild[stop.childStopID] ?? timesByParent[stop.parentStopID])
            }
    }

    /// "Avondale Train Station 105" -> "Avondale Train Station": the code
    /// is for search, and made most names wrap.
    static func cleanStopName(_ name: String) -> String {
        name.replacingOccurrences(of: #"\s+\d{3,6}$"#, with: "", options: .regularExpression)
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
        var fromStopName = fromStopName
        #if DEBUG
        // `-trackerFromStop <name>`: as if opened from that stop's board.
        if fromStopName == nil { fromStopName = UserDefaults.standard.string(forKey: "trackerFromStop") }
        #endif
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

    /// The vehicle glides along its trip's shape between live positions.
    private var vehicleRoutes: [String: VehicleRoute] {
        guard let shape, vehicle != nil else { return [:] }
        return [tripID: VehicleRoute(
            shape: shape.geojson.geometry.lineCoordinates,
            stops: tripStops.map { Coordinate(latitude: $0.lat, longitude: $0.lon) }
        )]
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
                    camera: !autoFollow ? .none : vehicle != nil ? .follow(annotationID: tripID, spanMeters: 700)
                        : tripStops.isEmpty ? .none : .frame(points: tripStops.map { Coordinate(latitude: $0.lat, longitude: $0.lon) }, minSpanMeters: 800),
                    clustersVehicles: false,
                    vehicleRoutes: vehicleRoutes,
                    cameraInsets: usesSidePanel
                        ? UIEdgeInsets(top: proxy.safeAreaInsets.top + 60, left: proxy.safeAreaInsets.leading + MapSidePanelMetrics.occupiedWidth + 16,
                                       bottom: proxy.safeAreaInsets.bottom + 24, right: 24)
                        : UIEdgeInsets(
                            top: proxy.safeAreaInsets.top + 60, left: 0,
                            bottom: min(drawerHeight(available: proxy.size.height), fullHeight * 0.6) + proxy.safeAreaInsets.bottom, right: 0
                        ),
                    onUserInteraction: { if autoFollow { autoFollow = false } },
                    cameraResetToken: cameraResetToken
                )
                .ignoresSafeArea()

                if usesSidePanel {
                    MapSidePanel {
                        VStack(spacing: 0) {
                            newHeader.padding(.top, 18)
                            newContent
                        }
                    }
                    // Over the map, right of the panel.
                    newTopBar.padding(.leading, MapSidePanelMetrics.occupiedWidth - 16)
                } else {
                    newTopBar

                    BottomDrawer(
                        detent: $drawer,
                        collapsedHeight: headerHeight,
                        availableHeight: proxy.size.height
                    ) {
                        newHeader
                            .background(GeometryReader { g in
                                Color.clear.onAppear { headerHeight = g.size.height + 19 }
                                    .onChange(of: g.size.height) { _, h in headerHeight = h + 19 }
                            })
                    } content: {
                        newContent
                    }
                    .frame(maxHeight: .infinity, alignment: .bottom)
                }
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
        .task { await loadStatic() }
        .foregroundPoll(every: .seconds(10), id: tripID) { await refresh() }
        .onAppear { router.isFullScreenMapVisible = true }
        .onDisappear { router.isFullScreenMapVisible = false }
    }

    private func drawerHeight(available: CGFloat) -> CGFloat {
        BottomDrawer<EmptyView, EmptyView>.height(for: drawer, collapsed: headerHeight, available: available, topClearance: 110)
    }

    // MARK: - Drawer

    /// Before anything's loaded, or a trip with no stops or position.
    @ViewBuilder
    private var drawerHeader: some View {
        if hasLoaded {
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

    // MARK: - Stop list

    private var passedRows: [StopRowData] { rows.filter { state(of: $0) == .passed } }
    private var aheadRows: [StopRowData] { rows.filter { state(of: $0) != .passed } }

    // MARK: - Header and stop list (2026-11-03 redesign)

    /// Back, then follow and a menu for the rest.
    private var newTopBar: some View {
        HStack(spacing: 8) {
            FloatingBarButton {
                Button { dismiss() } label: { Image(systemName: "chevron.left") }
                    .accessibilityLabel("Back")
            }
            Spacer()
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
            FloatingBarButton {
                Menu {
                    if let vehicle {
                        Button { isShowingRouteAlerts = true } label: {
                            Label("Alerts for route \(vehicle.route.name)", systemImage: "exclamationmark.bubble")
                        }
                    }
                    if !PowerState.shared.isLowPower {
                        Toggle(isOn: $is3D) { Label("3D map", systemImage: "view.3d") }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("More")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    /// The rider's stop, if this was opened from one and it's still ahead.
    private var yourRow: StopRowData? {
        guard let row = rows.first(where: isYourStop), state(of: row) != .passed else { return nil }
        return row
    }

    /// Where the countdown counts to: your stop, else the next one.
    private var focusRow: StopRowData? {
        if let yourRow { return yourRow }
        if let currentSequence, isAtStop { return rows.first { $0.sequence == currentSequence } }
        if let nextSequence { return rows.first { $0.sequence == nextSequence } }
        return aheadRows.first
    }

    @ViewBuilder
    private var newHeader: some View {
        if vehicle != nil || !rows.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                // What it is.
                HStack(spacing: 10) {
                    RouteBadge(name: vehicle?.route.name ?? "", colorHex: routeHex, size: 14)
                    Text(Headsign.display(vehicle?.trip?.headsign ?? rows.last?.name ?? ""))
                        .font(.cardTitle)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                // When it gets where you care about.
                if let focus = focusRow {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(yourRow != nil ? "To your stop" : isAtStop && focus.sequence == currentSequence ? "At" : "Next stop")
                                .font(.meta).foregroundStyle(Theme.mutedForeground)
                            Text(focus.name).font(.geist(20, .semibold, relativeTo: .title3)).lineLimit(1).minimumScaleFactor(0.8)
                        }
                        Spacer(minLength: 8)
                        if let date = focus.stopTime?.arrivalTime.date {
                            TimelineView(.periodic(from: .now, by: 15)) { context in
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(JourneyTrackingView.minutesText(until: date, now: context.date))
                                        .font(.geistMono(26, medium: true, relativeTo: .title2))
                                        .foregroundStyle(vehicle != nil ? Theme.live : Theme.foreground)
                                    Text(date, style: .time).font(.meta).foregroundStyle(Theme.mutedForeground)
                                }
                            }
                        }
                    }
                    progressStrip(to: focus)
                }
                statusLine
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 14)
        } else {
            drawerHeader
        }
    }

    /// One quiet line: live or timetable, then what's known about the
    /// vehicle - lower-priority items drop off rather than wrap.
    private var statusLine: some View {
        var items: [AnyView] = []
        if let vehicle {
            items.append(AnyView(HStack(spacing: 5) { LiveDot(color: Theme.success); Text("Live") }))
            if vehicle.offCourse {
                items.append(AnyView(Label("Off course", systemImage: "exclamationmark.triangle.fill").foregroundStyle(Theme.warning)))
            }
            if vehicle.occupancy >= 0 {
                items.append(AnyView(HStack(spacing: 4) { OccupancyIconsView(occupancy: vehicle.occupancy); Text(OccupancyText.short(vehicle.occupancy)) }))
            }
            if let cars = vehicle.cars { items.append(AnyView(Text("\(cars) cars"))) }
            if let platform = vehicle.trip?.nextStop?.platform, !platform.isEmpty {
                items.append(AnyView(Text("Platform \(platform)")))
            }
        } else if hasLoaded {
            items.append(AnyView(Label("Timetable times - no live position", systemImage: "antenna.radiowaves.left.and.right.slash")))
        }
        return ViewThatFits(in: .horizontal) {
            ForEach((1...max(items.count, 1)).reversed(), id: \.self) { count in
                HStack(spacing: 14) { ForEach(0..<min(count, items.count), id: \.self) { items[$0] } }.fixedSize()
            }
        }
        .font(.meta)
        .foregroundStyle(Theme.mutedForeground)
    }

    /// B: the vehicle, a dot per stop still to go, and the stop it's
    /// counting to - so "6 stops" reads at a glance.
    private func progressStrip(to focus: StopRowData) -> some View {
        let start = isAtStop ? (currentSequence ?? 0) : (nextSequence ?? currentSequence ?? 0)
        let between = rows.filter { $0.sequence >= start && $0.sequence < focus.sequence }
        let dots = min(between.count, 14)
        let color = Color(hex: routeHex)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 0) {
                Image(systemName: vehicle?.type == "train" || vehicle?.type == "Train" ? "tram.fill" : vehicle?.type.lowercased() == "ferry" ? "ferry.fill" : "bus.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(RouteColors.text(onHex: routeHex))
                    .frame(width: 24, height: 24)
                    .background(color, in: Circle())
                ForEach(0..<dots, id: \.self) { _ in
                    Rectangle().fill(color).frame(height: 3)
                    Circle().strokeBorder(color, lineWidth: 2.5).background(Circle().fill(Theme.background)).frame(width: 10, height: 10)
                }
                Rectangle().fill(color).frame(height: 3)
                Image(systemName: yourRow != nil ? "mappin.circle.fill" : "smallcircle.filled.circle")
                    .font(.system(size: 20))
                    .foregroundStyle(yourRow != nil ? Theme.danger : color)
                    .background(Circle().fill(Theme.background).padding(2))
            }
            Text(stopsToGoText(between.count + 1))
                .font(.metaMedium).foregroundStyle(Theme.mutedForeground)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(stopsToGoText(between.count + 1))
    }

    /// Counting the stop itself, as riders do: "next" is 1 stop to go.
    private func stopsToGoText(_ count: Int) -> String {
        if isAtStop, count <= 1, focusRow?.sequence == currentSequence { return "At the stop" }
        return count <= 1 ? (yourRow != nil ? "Your stop is next" : "Next stop") : "\(count) stops to go"
    }

    @ViewBuilder
    private var newContent: some View {
        if rows.isEmpty {
            if !hasLoaded { ProgressView().padding(24) }
        } else {
            ScrollView {
                DrawerScrollAnchor()
                VStack(alignment: .leading, spacing: 0) {
                    if !passedRows.isEmpty {
                        Button {
                            withAnimation(.easeOut(duration: 0.2)) { showEarlierStops.toggle() }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: showEarlierStops ? "chevron.up" : "chevron.down").font(.system(size: 11, weight: .semibold))
                                Text(showEarlierStops ? "Hide earlier stops" : "\(passedRows.count) earlier stop\(passedRows.count == 1 ? "" : "s")")
                            }
                            .font(.metaMedium)
                            .foregroundStyle(Theme.mutedForeground)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                        }
                        .buttonStyle(.plain)
                        if showEarlierStops {
                            ForEach(passedRows) { newStopRow($0, isFirst: $0.sequence == rows.first?.sequence, isLast: false) }
                        }
                    }
                    let ahead = aheadRows
                    ForEach(Array(ahead.enumerated()), id: \.element.id) { index, row in
                        newStopRow(row, isFirst: row.sequence == rows.first?.sequence, isLast: index == ahead.count - 1)
                    }
                }
                .padding(.bottom, 24)
            }
        }
    }

    /// Rail and marker, the stop, then "5 min" over its clock time and a
    /// bell for a reminder.
    private func newStopRow(_ row: StopRowData, isFirst: Bool, isLast: Bool) -> some View {
        let state = state(of: row)
        let yours = isYourStop(row)
        let color = Color(hex: routeHex)
        let passed = state == .passed
        let reminded = remindedStops.contains(row.sequence)
        return HStack(spacing: 12) {
            // The line, through a marker matching the map's.
            ZStack {
                VStack(spacing: 0) {
                    Rectangle().fill(isFirst ? .clear : color.opacity(passed || state == .current ? 0.3 : 1)).frame(width: 4)
                    Rectangle().fill(isLast ? .clear : color.opacity(passed ? 0.3 : 1)).frame(width: 4)
                }
                Group {
                    if yours {
                        Image(systemName: "mappin.circle.fill").font(.system(size: 20)).foregroundStyle(Theme.danger)
                    } else if state == .next || state == .current {
                        Circle().fill(state == .current ? Theme.warning : Theme.live).frame(width: 14, height: 14)
                            .overlay(Circle().strokeBorder(Theme.background, lineWidth: 3))
                    } else if isLast {
                        Image(systemName: "smallcircle.filled.circle.fill").font(.system(size: 16)).foregroundStyle(color)
                    } else {
                        Circle().strokeBorder(passed ? Theme.border : color, lineWidth: 3).background(Circle().fill(Theme.background)).frame(width: 12, height: 12)
                    }
                }
                .background(Circle().fill(Theme.background).padding(-1))
            }
            .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(row.name)
                    .font(state == .next || state == .current || yours ? .bodyMedium : .bodyText)
                    .foregroundStyle(passed ? Theme.mutedForeground : Theme.foreground)
                    .lineLimit(1)
                let detail = [
                    state == .current ? "At this stop" : state == .next ? "Next stop" : nil,
                    yours ? "Your stop" : nil,
                    row.stopTime?.skipped == true ? "Skipped" : nil,
                    row.platform.isEmpty ? nil : "Platform \(row.platform)",
                ].compactMap { $0 }
                if !detail.isEmpty {
                    Text(detail.joined(separator: "  "))
                        .font(.meta)
                        .foregroundStyle(state == .next ? Theme.live : state == .current ? Theme.warning : yours ? Theme.danger : Theme.mutedForeground)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let date = row.stopTime?.arrivalTime.date {
                VStack(alignment: .trailing, spacing: 1) {
                    if !passed {
                        TimelineView(.periodic(from: .now, by: 30)) { context in
                            let minutes = Int((date.timeIntervalSince(context.date) / 60).rounded(.up))
                            Text(minutes <= 0 ? "Now" : minutes < 90 ? "\(minutes) min" : "")
                                .font(.geistMono(14, medium: true, relativeTo: .callout))
                                .foregroundStyle(state == .next || yours ? Theme.live : Theme.foreground)
                        }
                    }
                    Text(date, style: .time).font(.meta).foregroundStyle(Theme.mutedForeground)
                }
            }
            if !passed {
                Button { reminderStop = row } label: {
                    Image(systemName: reminded ? "bell.fill" : "bell")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(reminded ? Theme.live : Theme.mutedForeground)
                        .frame(width: 36, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(reminded ? "Reminder set for \(row.name)" : "Remind me about \(row.name)")
            } else {
                Color.clear.frame(width: 36, height: 1)
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .frame(minHeight: 54)
        .background(state == .next || state == .current ? (state == .current ? Theme.warning : Theme.live).opacity(0.07) : .clear)
        .opacity(passed ? 0.7 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(state == .next ? "tracker-next-stop" : "tracker-stop")
    }

    // MARK: - Data

    /// The trip's shape and stop list - fetched once; `refresh` polls the
    /// live parts.
    private func loadStatic() async {
        async let shapeFetch: () = loadShape()
        async let stopsFetch: () = loadTripStops()
        await shapeFetch
        await stopsFetch
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
    /// Off when setting it from a board - you're getting on there, not off.
    var offersGetOff = true
    let onSet: (ReminderKind, Int) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var stopsBefore = 2
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if offersGetOff {
                        option(.getOff, title: "Get off here", detail: "When this is the next stop", icon: "figure.walk.arrival")
                    }
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
