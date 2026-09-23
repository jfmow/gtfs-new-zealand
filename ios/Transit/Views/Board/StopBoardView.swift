import SwiftData
import SwiftUI
import TransitCore

/// A stop's departures board - `components/services/index.tsx`. Polls every
/// 10s while the app is active; switches to a one-shot schedule fetch when a
/// date is picked, same as the web board.
struct StopBoardView: View {
    let stopQuery: String
    let title: String

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @Query private var favourites: [FavouriteStop]

    @State private var departures: [Departure] = []
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var isNotFound = false
    @State private var selectedDate: Date?
    @State private var platformFilter: String?
    @State private var pollTask: Task<Void, Never>?
    @State private var isShowingSubscriptionSheet = false
    @State private var isPickingDate = false
    @State private var isShowingAlerts = false
    @State private var draftDate = Date()
    @State private var showAllPlatforms = false
    @State private var loadError: Error?

    init(stopQuery: String, title: String) {
        self.stopQuery = stopQuery
        self.title = title
        let query = stopQuery
        _favourites = Query(filter: #Predicate<FavouriteStop> { $0.stopID == query })
    }

    var body: some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            // Registered here - stably, on `body` - rather than nested
            // inside `content`'s conditional branches. `content` rebuilds
            // on every poll tick (every 10s, including while a pushed
            // child like VehicleQuickLookView sits on top of this screen -
            // NavigationStack doesn't fire `onDisappear` on a mere push, so
            // this view's poll timer keeps running underneath). A
            // navigationDestination nested inside a branch that gets torn
            // down and rebuilt while a stack it's part of has a live pushed
            // child is exactly what caused that child to intermittently
            // render behind this list instead of on top of it - same root
            // cause class as the HomeView fix earlier (a destination
            // registration needs a stable, always-present home in the tree).
            .navigationDestination(for: String.self) { tripID in
                VehicleQuickLookView(tripID: tripID)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isShowingSubscriptionSheet = true
                    } label: {
                        Image(systemName: "bell")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        toggleFavourite()
                    } label: {
                        Image(systemName: favourites.isEmpty ? "star" : "star.fill")
                            .foregroundStyle(favourites.isEmpty ? Theme.foreground : Color(hex: "eab308"))
                    }
                    .accessibilityLabel(favourites.isEmpty ? "Add to favourites" : "Remove from favourites")
                    .accessibilityLabel(favourites.isEmpty ? "Add to favourites" : "Remove from favourites")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    // The web header's other actions: timetable for a date,
                    // directions to the stop, the stop's service alerts.
                    Menu {
                        Button {
                            draftDate = selectedDate ?? Date()
                            isPickingDate = true
                        } label: { Label("Timetable for a date", systemImage: "calendar") }
                        if let coordinate = stopCoordinate {
                            Button { openDirections(to: coordinate) } label: { Label("Directions to stop", systemImage: "location.north.line") }
                        }
                        // A sheet, not a push: a view-based NavigationLink
                        // inside a toolbar menu is unreliable in the tabs'
                        // path-driven stacks.
                        Button { isShowingAlerts = true } label: { Label("Service alerts", systemImage: "exclamationmark.bubble") }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("More")
                }
            }
            .sheet(isPresented: $isShowingSubscriptionSheet) {
                AlertSubscriptionSheet(target: .stop(query: stopQuery, title: title))
                    .shadSheet(detents: [.large])
            }
            .sheet(isPresented: $isPickingDate) {
                datePickerSheet
            }
            .sheet(isPresented: $isShowingAlerts) {
                NavigationStack {
                    AlertsView(stopQuery: stopQuery, title: title)
                        .toolbar { DoneButton() }
                }
                .shadSheet(detents: [.large])
            }
            .task { await start() }
            .onDisappear { pollTask?.cancel() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await refresh() } } else { pollTask?.cancel() }
            }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading, departures.isEmpty {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).pageBackground()
        } else if isNotFound {
            EmptyState(systemImage: "calendar.badge.exclamationmark", title: "No services scheduled", message: selectedDate == nil ? "Nothing is due at this stop right now." : "Nothing runs from this stop on that date.")
                .frame(maxHeight: .infinity).pageBackground()
        } else if let loadError, departures.isEmpty {
            ErrorState(title: "Could not load departures", error: loadError) { Task { await refresh() } }
                .frame(maxHeight: .infinity).pageBackground()
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let selectedDate { scheduleBanner(for: selectedDate) }
                    if filterOptions.values.count > 1 { platformChips }

                    VStack(spacing: 0) {
                        ForEach(Array(visibleDepartures.enumerated()), id: \.element.id) { index, departure in
                            if index > 0 { RowDivider() }
                            row(for: departure)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusXL, style: .continuous))
                    .shadCardBackground()
                }
                .padding(16)
            }
            .refreshable { await refresh() }
            .pageBackground()
        }
    }

    @ViewBuilder
    private func row(for departure: Departure) -> some View {
        let preview = selectedDate != nil
        let rowView = DepartureRow(departure: departure, isSchedulePreview: preview)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(departure.departed && !preview ? Theme.warning.opacity(0.06) : .clear)
        if departure.isTrackable && !preview {
            NavigationLink(value: departure.tripID) { rowView.contentShape(Rectangle()) }
                .accessibilityIdentifier("departure-row")
                .buttonStyle(DropdownRowStyle())
        } else {
            rowView
        }
    }

    /// The web shows the first three options, then a "Show more" toggle.
    /// Stops without platforms (most bus stops) filter by route instead.
    private var platformChips: some View {
        let options = filterOptions
        let values = options.values
        let shown = showAllPlatforms || values.count <= 3 ? values : Array(values.prefix(3))
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                FilterChip(title: options.byRoute ? "All routes" : "All platforms", isSelected: platformFilter == nil) { platformFilter = nil }
                ForEach(shown, id: \.self) { value in
                    FilterChip(title: options.byRoute ? value : "Platform \(value)", isSelected: platformFilter == value) {
                        platformFilter = value
                    }
                }
                if values.count > 3 {
                    Button(showAllPlatforms ? "Show fewer" : "Show more") { showAllPlatforms.toggle() }
                        .buttonStyle(.shad(.ghost, size: .sm))
                }
            }
        }
        .accessibilityLabel(filterOptions.byRoute ? "Route filters" : "Platform filters")
    }

    private func scheduleBanner(for date: Date) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "calendar").foregroundStyle(Theme.mutedForeground)
            Text("Timetable for \(date.formatted(.dateTime.weekday(.wide).day().month()))").font(.bodyMedium)
            Spacer(minLength: 8)
            Button("Back to live") {
                selectedDate = nil
                Task { await refresh() }
            }
            .buttonStyle(.shad(.outline, size: .sm))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .mutedPanel()
    }

    private var datePickerSheet: some View {
        NavigationStack {
            DatePicker("Date", selection: $draftDate, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .tint(Theme.primary)
                .padding(.horizontal, 16)
                .navigationTitle("Timetable for a date")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { isPickingDate = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Show") {
                            selectedDate = Calendar.current.isDateInToday(draftDate) && selectedDate == nil ? nil : draftDate
                            isPickingDate = false
                            Task { await refresh() }
                        }
                    }
                }
                .pageBackground()
        }
        .shadSheet(detents: [.medium, .large])
    }

    /// The stop's location, from any departure (each carries its stop).
    private var stopCoordinate: Coordinate? {
        guard let stop = departures.first?.stop, stop.lat != 0 || stop.lon != 0 else { return nil }
        return Coordinate(latitude: stop.lat, longitude: stop.lon)
    }

    private func openDirections(to coordinate: Coordinate) {
        let name = title.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        if let url = URL(string: "http://maps.apple.com/?daddr=\(coordinate.latitude),\(coordinate.longitude)&dirflg=w&q=\(name)") {
            UIApplication.shared.open(url)
        }
    }

    /// Platforms if the stop has any (numeric ones in number order), else
    /// the routes serving it - `getUniquePlatforms` in the web's services.
    private var filterOptions: (byRoute: Bool, values: [String]) {
        let platforms = Set(departures.map(\.platform)).filter { !$0.isEmpty && $0 != "no platform" }
        if !platforms.isEmpty {
            return (false, platforms.sorted { a, b in
                if let x = Int(a), let y = Int(b) { return x < y }
                return a.localizedStandardCompare(b) == .orderedAscending
            })
        }
        let routes = Set(departures.map(\.route.name)).filter { !$0.isEmpty }
        return (true, routes.sorted { $0.localizedStandardCompare($1) == .orderedAscending })
    }

    private var visibleDepartures: [Departure] {
        let sorted = DepartureBoard.filterAndSort(departures)
        guard let platformFilter else { return sorted }
        let byRoute = filterOptions.byRoute
        return sorted.filter { byRoute ? $0.route.name == platformFilter : $0.platform == platformFilter }
    }

    // MARK: - Data

    private func start() async {
        await refresh()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled, selectedDate == nil else { continue }
                await refresh()
            }
        }
    }

    private func refresh() async {
        isLoading = departures.isEmpty
        defer { isLoading = false }
        do {
            if let selectedDate {
                departures = try await environment.api.schedule(stop: stopQuery, date: selectedDate)
            } else {
                departures = try await environment.api.departures(stop: stopQuery)
            }
            errorMessage = nil
            loadError = nil
            isNotFound = false
        } catch let APIError.server(code, _, _) where code == 404 {
            departures = []
            isNotFound = true
        } catch {
            errorMessage = error.localizedDescription
            loadError = error
        }
    }

    private func toggleFavourite() {
        if let existing = favourites.first {
            modelContext.delete(existing)
            environment.toasts.show("Removed from favourites")
            return
        }
        let nextOrder = (try? modelContext.fetchCount(FetchDescriptor<FavouriteStop>())) ?? 0
        let favourite = FavouriteStop(stopID: stopQuery, displayName: title, colorHex: favouriteColor(for: nextOrder), sortOrder: nextOrder)
        modelContext.insert(favourite)
        environment.toasts.show("Added to favourites")
    }

    private func favouriteColor(for index: Int) -> String {
        Swatches.color(at: index)
    }
}

/// Mirrors `components/services/index.tsx`'s departures-board row exactly:
/// route-colour rail + coloured route badge, platform-changed/tracking-state
/// pills, 2-line headsign, right-aligned `BoardTime`-equivalent, and a
/// detail line (time, platform, stops-away/"At this stop", occupancy,
/// bike/wheelchair icons) - not the plain single-status-line version this
/// used to be.
struct DepartureRow: View {
    let departure: Departure
    var isSchedulePreview: Bool = false

    private var routeColor: Color { Color(hex: departure.route.color.isEmpty ? "424242" : departure.route.color) }
    private var railColor: Color { Color(hex: departure.route.color.isEmpty ? "9ca3af" : departure.route.color) }

    private var hasPlatform: Bool { !departure.platform.isEmpty && departure.platform != "no platform" }

    /// `service.location_tracking || service.trip_update_tracking` - a
    /// timetable-only service (neither) shouldn't show a stale stops-away
    /// count or "seats free" that was never really live.
    private var isLive: Bool {
        !isSchedulePreview && !departure.canceled && !departure.skipped
            && (departure.locationTracking || departure.tripUpdateTracking)
    }

    private var showOccupancy: Bool { isLive && departure.locationTracking && departure.occupancy >= 0 }

    private enum Tracking { case live, limited, scheduled, none }
    private var tracking: Tracking {
        if departure.canceled || departure.skipped { return .none }
        if departure.locationTracking { return .live }
        if departure.tripUpdateTracking { return .limited }
        return .scheduled
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(railColor).frame(width: 3).padding(.vertical, 1)

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 5) {
                            RouteBadge(name: departure.route.name, colorHex: departure.route.color, size: 12)

                            if departure.platformChanged {
                                pill("Platform changed", color: Theme.danger)
                            }
                            if !isSchedulePreview, tracking == .limited {
                                pill("Limited tracking", color: Theme.warning)
                            }
                            if !isSchedulePreview, tracking == .scheduled {
                                pill("Timetable only", color: Theme.mutedForeground)
                            }
                        }
                        Text(TimeFormatting.niceLookingWords(departure.headsign))
                            .font(.cardTitle)
                            .foregroundStyle(Theme.foreground)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 8)

                    boardTime
                }

                detailLine
            }
        }
    }

    private func pill(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.geist(10, .medium, relativeTo: .caption2))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(color.opacity(0.4), lineWidth: 1))
    }

    /// `BoardTime` from the web: schedule-preview shows the plain time;
    /// otherwise Cancelled/Not stopping/Departed each get their own fixed
    /// colour, "Now" and anything ≤2 min get `Theme.live`, else the
    /// plain countdown in ink.
    @ViewBuilder
    private var boardTime: some View {
        if isSchedulePreview {
            Text(TimeFormatting.convert24hTo12h(departure.arrivalTime) ?? departure.arrivalTime).font(.number(16))
        } else if departure.canceled {
            Text("Cancelled").font(.geist(14, .bold)).foregroundStyle(Theme.danger)
        } else if departure.skipped {
            Text("Not stopping").font(.geist(14, .bold)).foregroundStyle(Theme.live)
        } else if departure.departed || departure.timeTillArrival < 0 {
            // A negative countdown means it's gone even if the feed hasn't
            // flagged it yet - the countdown formatter would print
            // "Departed" in the big "due now" style otherwise.
            Text("Departed").font(.geist(14, .bold)).foregroundStyle(Theme.warning)
        } else {
            let imminent = departure.timeTillArrival <= 2
            Text(TimeFormatting.timeTillArrivalString(minutes: departure.timeTillArrival))
                .font(.number(19))
                .foregroundStyle(imminent ? Theme.live : Theme.foreground)
                .lineLimit(1)
                .fixedSize()
        }
    }

    private var detailLine: some View {
        HStack(spacing: 10) {
            if !isSchedulePreview {
                Label(TimeFormatting.convert24hTo12h(departure.arrivalTime) ?? departure.arrivalTime, systemImage: "clock").labelStyle(.detail)
            }
            if hasPlatform {
                Label("Platform \(departure.platform)", systemImage: "mappin")
                    .labelStyle(.detail)
                    .foregroundStyle(departure.platformChanged ? Theme.danger : Theme.mutedForeground)
            }
            if isLive, departure.stopsAway > 0 {
                Label("\(departure.stopsAway) \(departure.stopsAway == 1 ? "stop" : "stops") away", systemImage: "point.3.connected.trianglepath.dotted")
                    .labelStyle(.detail)
            } else if isLive, departure.stopsAway <= 0, departure.stopState == "AtStop" {
                Text("At this stop").font(.caption2.weight(.medium)).foregroundStyle(Theme.live)
            }
            if showOccupancy {
                Text(OccupancyText.short(departure.occupancy)).font(.caption2).foregroundStyle(Theme.mutedForeground)
            }

            Spacer()

            Image(systemName: "bicycle").font(.system(size: 11)).foregroundStyle(allowedColor(departure.bikesAllowed))
                .accessibilityLabel(departure.bikesAllowed == 1 ? "Bikes allowed" : departure.bikesAllowed == 2 ? "No bikes" : "Bikes unknown")
            Image(systemName: "figure.roll").font(.system(size: 11)).foregroundStyle(allowedColor(departure.wheelchairsAllowed))
                .accessibilityLabel(departure.wheelchairsAllowed == 1 ? "Wheelchair accessible" : departure.wheelchairsAllowed == 2 ? "Not wheelchair accessible" : "Wheelchair access unknown")
        }
        .font(.meta)
        .foregroundStyle(Theme.mutedForeground)
        .lineLimit(1)
    }

    /// `allowedColor` from the web: 1 = allowed (green), 2 = not allowed
    /// (red), anything else (0/unknown) = amber.
    private func allowedColor(_ value: Int) -> Color {
        if value == 1 { return Theme.success }
        if value == 2 { return Theme.danger }
        return Theme.warning
    }
}

private struct DetailLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            configuration.icon.font(.system(size: 9))
            configuration.title
        }
    }
}

private extension LabelStyle where Self == DetailLabelStyle {
    static var detail: DetailLabelStyle { DetailLabelStyle() }
}

/// `getOccupancyShort` from `components/services/occupancy.tsx`.
enum OccupancyText {
    static func short(_ value: Int) -> String {
        switch value {
        case 0, 1: return "Seats free"
        case 2: return "Filling up"
        case 3: return "Standing room"
        case 4: return "Likely full"
        default: return ""
        }
    }

    /// Longer, sentence-style description - `getOccupancyLabel` from the
    /// same web file, used where there's more room (the live journey
    /// tracker's detail strip).
    static func label(_ value: Int) -> String {
        switch value {
        case 0, 1: return "Seats available"
        case 2: return "Some seats still available"
        case 3: return "Likely standing room only"
        case 4: return "Likely full, standing only"
        default: return "Unknown occupancy"
        }
    }
}

/// `OccupancyIcons` from `components/services/occupancy.tsx` - three person
/// glyphs, filled progressively (1 for low, 2 for medium, 3 for high).
struct OccupancyIconsView: View {
    let occupancy: Int

    private var filled: Int { occupancy <= 1 ? 1 : occupancy == 2 ? 2 : 3 }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<3, id: \.self) { index in
                Image(systemName: "person.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(index < filled ? Theme.foreground : Theme.mutedForeground.opacity(0.3))
            }
        }
    }
}

struct FilterChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Chip(label: title, isActive: isSelected, action: action)
    }
}
