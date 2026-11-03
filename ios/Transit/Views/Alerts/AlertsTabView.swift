import SwiftData
import SwiftUI
import TransitCore

/// The Updates tab: "For you" (your notifications, and a way into your
/// alerts and reminders) and "Service alerts" - `pages/alerts.tsx`: stop
/// search and "Get alerts" for a stop, with its alerts on the page.
struct AlertsTabView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var selectedStop: String?
    @State private var isShowingSubscription = false
    /// Your notifications ("For you") or service alerts.
    @State private var showsInbox = true

    /// Regular width (iPad): your stops listed on the left, the chosen
    /// stop's alerts on the right, instead of one replacing the other.
    private var usesSplit: Bool { horizontalSizeClass == .regular }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // The chips and Settings on one row, in place of a navigation
                // bar (the tab bar already says "Updates"). Timetable-only
                // regions (Otago) have no service alerts - just Settings.
                HStack(spacing: 8) {
                    if environment.region.hasRealtime {
                        Chip(label: "For you", isActive: showsInbox) { showsInbox = true }
                        Chip(label: "Service alerts", isActive: !showsInbox) { showsInbox = false }
                    }
                    Spacer()
                    MapSettingsButton()
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 8)
                if showsInbox || !environment.region.hasRealtime {
                    NotificationsInbox()
                } else {
                    alertsContent
                }
            }
            // Grouped, like Home - and the same colour as the inbox list.
            .groupedPageBackground()
            .navigationTitle("Updates")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $isShowingSubscription) {
                if let selectedStop {
                    AlertSubscriptionSheet(target: .stop(query: selectedStop, title: selectedStop)).shadSheet(detents: [.large])
                }
            }
        }
    }

    @ViewBuilder
    private var alertsContent: some View {
        VStack(spacing: 0) {
                if !usesSplit {
                    searchField.readableContentWidth()
                }

                if usesSplit {
                    HStack(spacing: 0) {
                        // Search heads the list column it belongs with.
                        VStack(spacing: 0) {
                            searchField
                            AlertsOverview { selectedStop = $0 }
                        }
                        .frame(width: 400)
                        Divider()
                        Group {
                            if let selectedStop {
                                selectedStopAlerts(selectedStop)
                            } else {
                                EmptyState(systemImage: "exclamationmark.bubble", title: "Travel alerts",
                                           message: "Pick one of your stops, or search for any stop.")
                                    .frame(maxHeight: .infinity)
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    }
                } else if let selectedStop {
                    selectedStopAlerts(selectedStop)
                } else {
                    // Your stops' alerts straight away, rather than an empty
                    // page asking for a search.
                    AlertsOverview { selectedStop = $0 }
                }
        }
    }

    private var searchField: some View {
        StopSearchField { selectedStop = $0 }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 12)
            .zIndex(1)
    }

    /// The stop's name, "Get alerts" and clear, then its alerts.
    private func selectedStopAlerts(_ selectedStop: String) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text(selectedStop).font(.pageTitle).lineLimit(2)
                Spacer(minLength: 8)
                Button {
                    isShowingSubscription = true
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "bell.badge").font(.system(size: 12, weight: .medium))
                        Text("Get alerts")
                    }
                }
                .buttonStyle(.shad(.outline, size: .sm))
                Button {
                    self.selectedStop = nil
                } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                }
                .buttonStyle(.shad(.ghost, size: .iconSm))
                .accessibilityLabel("Clear stop")
            }
            .padding(.horizontal, 16)
            .readableContentWidth()
            AlertsView(stopQuery: selectedStop, title: selectedStop, standalone: false)
                // Another stop picked beside it (iPad) loads fresh.
                .id(selectedStop)
                .frame(maxHeight: .infinity, alignment: .top)
        }
    }
}

/// The Alerts tab before a search: saved stops, then the nearest few, each
/// with a one-line summary of its alerts. Tapping one opens its full list.
private struct AlertsOverview: View {
    let onSelect: (String) -> Void

    @Environment(AppEnvironment.self) private var environment
    @Query(sort: \FavouriteStop.sortOrder) private var favourites: [FavouriteStop]
    @State private var nearby: [Stop] = []

    private struct Entry: Identifiable {
        let query: String
        let title: String
        let colorHex: String?
        let stopType: String
        var id: String { query }
    }

    private var saved: [Entry] {
        var seen = Set<String>()
        return favourites.filter { seen.insert($0.stopID).inserted }
            .map { Entry(query: $0.stopID, title: $0.displayName, colorHex: $0.colorHex, stopType: "") }
    }

    private var near: [Entry] {
        var seen = Set(favourites.map(\.stopID))
        var names = Set(favourites.map(\.displayName))
        return Array(nearby.filter { names.insert($0.stopName).inserted && seen.insert($0.boardQuery).inserted }
            .prefix(3)
            .map { Entry(query: $0.boardQuery, title: $0.stopName, colorHex: nil, stopType: $0.stopType) })
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if saved.isEmpty && near.isEmpty {
                    EmptyState(systemImage: "exclamationmark.bubble", title: "Travel alerts",
                               message: "Search for a stop to see its alerts. Your saved and nearby stops show up here.")
                }
                section("Your stops", saved)
                section("Near you", near)
            }
            .padding(.top, 4)
            .padding(.bottom, 24)
            .readableContentWidth()
        }
        .task(id: environment.location.coordinate == nil) {
            guard let here = environment.location.coordinate else { return }
            nearby = (try? await environment.api.closestStops(to: here)) ?? []
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ entries: [Entry]) -> some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HomeHeading(title: title) { EmptyView() }
                VStack(spacing: 0) {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { Rectangle().fill(Theme.border).frame(height: 1).padding(.leading, 48) }
                        Button { onSelect(entry.query) } label: {
                            StopAlertsSummaryRow(query: entry.query, title: entry.title) {
                                if let hex = entry.colorHex { HomeSavedTile(colorHex: hex) } else { HomeModeTile(stopType: entry.stopType) }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .shadCardBackground(radius: 16)
                .padding(.horizontal, 16)
            }
        }
    }
}

/// "Britomart · 2 active, 1 upcoming" with the affected routes.
private struct StopAlertsSummaryRow<Tile: View>: View {
    let query: String
    let title: String
    @ViewBuilder var tile: Tile

    @Environment(AppEnvironment.self) private var environment
    @State private var summary: Summary?
    @State private var failed = false

    private struct Summary {
        let active: Int
        let upcoming: Int
        let routes: [String]
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            tile.frame(width: 24, height: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.bodyMedium).foregroundStyle(Theme.foreground)
                status
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.mutedForeground.opacity(0.6))
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .task(id: query) { await load() }
    }

    @ViewBuilder
    private var status: some View {
        if let summary {
            if summary.active == 0 && summary.upcoming == 0 {
                Label("All clear", systemImage: "checkmark.circle.fill")
                    .font(.meta)
                    .foregroundStyle(Theme.success)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    // Only something happening now is red - planned work
                    // ahead is worth knowing, not alarming.
                    HStack(spacing: 6) {
                        if summary.active > 0 { Circle().fill(Theme.danger).frame(width: 7, height: 7) }
                        Text(countText(summary))
                            .font(summary.active > 0 ? .metaMedium : .meta)
                            .foregroundStyle(summary.active > 0 ? Theme.danger : Theme.mutedForeground)
                    }
                    FlowLayout(spacing: 4, lineSpacing: 4) {
                        ForEach(summary.routes.prefix(8), id: \.self) { route in
                            RouteBadge(name: shortName(route), colorHex: "", size: 11)
                        }
                    }
                }
            }
        } else if failed {
            Text("Couldn't load alerts").font(.meta).foregroundStyle(Theme.mutedForeground)
        } else {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("Checking alerts").font(.meta).foregroundStyle(Theme.mutedForeground)
            }
        }
    }

    /// Alerts are keyed by route id - AT's carry a feed version suffix
    /// ("INN-202"), which means nothing to a rider.
    private func shortName(_ routeID: String) -> String {
        guard let dash = routeID.lastIndex(of: "-"),
              routeID[routeID.index(after: dash)...].allSatisfy(\.isNumber),
              dash != routeID.startIndex else { return routeID }
        return String(routeID[..<dash])
    }

    private func countText(_ summary: Summary) -> String {
        var parts: [String] = []
        if summary.active > 0 { parts.append("\(summary.active) happening now") }
        if summary.upcoming > 0 { parts.append("\(summary.upcoming) planned") }
        return parts.joined(separator: ", ")
    }

    private func load() async {
        do {
            let result = try await environment.api.alerts(forStop: query)
            var active = 0, upcoming = 0
            var routes: [String] = []
            for route in result.routesToDisplay {
                let kinds = (result.alerts[route] ?? []).map { AlertStatusCalculator.status(for: $0).kind }
                active += kinds.filter { $0 == .active }.count
                upcoming += kinds.filter { $0 == .soon }.count
                if kinds.contains(where: { $0 != .inactive }) { routes.append(route) }
            }
            summary = Summary(active: active, upcoming: upcoming, routes: routes)
        } catch let APIError.server(code, _, _) where code == 404 {
            summary = Summary(active: 0, upcoming: 0, routes: [])
        } catch {
            failed = true
        }
    }
}
