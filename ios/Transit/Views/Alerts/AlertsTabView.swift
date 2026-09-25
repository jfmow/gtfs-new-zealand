import SwiftData
import SwiftUI
import TransitCore

/// The Alerts tab - `pages/alerts.tsx`: stop search and a "Notifications"
/// button for that stop's alert subscription, with the stop's alerts shown
/// right on the page (the web keeps them on the same route via `?s=`).
struct AlertsTabView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var selectedStop: String?
    @State private var isShowingSubscription = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                StopSearchField { selectedStop = $0 }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)
                .zIndex(1)

                if let selectedStop {
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
                    AlertsView(stopQuery: selectedStop, title: selectedStop, standalone: false)
                        .frame(maxHeight: .infinity, alignment: .top)
                } else {
                    // Your stops' alerts straight away, rather than an empty
                    // page asking for a search.
                    AlertsOverview { selectedStop = $0 }
                }
            }
            .pageBackground()
            .navigationTitle("Alerts")
            .navigationBarTitleDisplayMode(.inline)
            .appToolbar()
            .sheet(isPresented: $isShowingSubscription) {
                if let selectedStop {
                    AlertSubscriptionSheet(target: .stop(query: selectedStop, title: selectedStop)).shadSheet(detents: [.large])
                }
            }
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
        let isSaved: Bool
        var id: String { query }
    }

    private var entries: [Entry] {
        var seen = Set<String>()
        var out: [Entry] = []
        for favourite in favourites where seen.insert(favourite.stopID).inserted {
            out.append(Entry(query: favourite.stopID, title: favourite.displayName, isSaved: true))
        }
        var names = Set(out.map(\.title))
        for stop in nearby where names.insert(stop.stopName).inserted && seen.insert(stop.boardQuery).inserted {
            out.append(Entry(query: stop.boardQuery, title: stop.stopName, isSaved: false))
            if out.filter({ !$0.isSaved }).count == 3 { break }
        }
        return out
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                let all = entries
                if all.isEmpty {
                    EmptyState(systemImage: "exclamationmark.bubble", title: "Travel alerts",
                               message: "Search for a stop to view alerts. Saved and nearby stops show up here.")
                } else {
                    SectionLabel(text: "Your stops")
                    ForEach(all) { entry in
                        Button { onSelect(entry.query) } label: {
                            StopAlertsSummaryRow(query: entry.query, title: entry.title, isSaved: entry.isSaved)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(16)
        }
        .task(id: environment.location.coordinate == nil) {
            guard let here = environment.location.coordinate else { return }
            nearby = (try? await environment.api.closestStops(to: here)) ?? []
        }
    }
}

/// "Britomart · 2 active, 1 upcoming" with the affected routes.
private struct StopAlertsSummaryRow: View {
    let query: String
    let title: String
    let isSaved: Bool

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
            Image(systemName: isSaved ? "star.fill" : "location")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.mutedForeground)
                .frame(width: 32, height: 32)
                .background(Theme.muted, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.bodyMedium).foregroundStyle(Theme.foreground)
                status
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.mutedForeground.opacity(0.6))
                .accessibilityHidden(true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .shadCardBackground()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .task(id: query) { await load() }
    }

    @ViewBuilder
    private var status: some View {
        if let summary {
            if summary.active == 0 && summary.upcoming == 0 {
                Label("No current alerts", systemImage: "checkmark.circle")
                    .font(.meta)
                    .foregroundStyle(Theme.success)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text(countText(summary))
                        .font(.metaMedium)
                        .foregroundStyle(summary.active > 0 ? Theme.danger : Theme.warning)
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
        if summary.active > 0 { parts.append("\(summary.active) active") }
        if summary.upcoming > 0 { parts.append("\(summary.upcoming) upcoming") }
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
