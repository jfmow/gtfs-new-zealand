import SwiftUI
import TransitCore

/// Alerts for a stop, one route at a time - `pages/alerts.tsx` (`?s=`
/// mode): route pills with counts, then that route's alert cards. Used
/// inline on the Alerts tab and pushed from a board or a notification.
struct AlertsView: View {
    let stopQuery: String
    let title: String
    /// Pushed on its own (board menu, notification): show a title and the
    /// Notifications button in the nav bar. Inline on the Alerts tab, the
    /// tab provides both.
    var standalone = true

    @Environment(AppEnvironment.self) private var environment
    @State private var alertsByRoute: [String: [TransitAlert]] = [:]
    @State private var routesToDisplay: [String] = []
    @State private var selectedRoute: String?
    @State private var loadError: Error?
    @State private var isLoading = true
    @State private var isShowingSubscription = false

    var body: some View {
        content
            .if(standalone) { view in
                view
                    .navigationTitle(title)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button { isShowingSubscription = true } label: { Image(systemName: "bell.badge") }
                                .accessibilityLabel("Notifications for this stop")
                        }
                    }
                    .sheet(isPresented: $isShowingSubscription) {
                        AlertSubscriptionSheet(target: .stop(query: stopQuery, title: title)).shadSheet(detents: [.large])
                    }
            }
            .task(id: stopQuery) { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
        } else if let loadError {
            ErrorState(title: "Couldn't load alerts", error: loadError) { Task { await load() } }
        } else if routesToDisplay.isEmpty {
            EmptyState(systemImage: "checkmark.circle", title: "No travel alerts", message: "No travel alerts found for this stop.")
        } else {
            let current = selectedRoute ?? routesToDisplay[0]
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    FlowLayout(spacing: 6, lineSpacing: 6) {
                        ForEach(routesToDisplay, id: \.self) { route in
                            Chip(label: "\(route)  \(alertsByRoute[route]?.count ?? 0)", isActive: route == current) {
                                selectedRoute = route
                            }
                        }
                    }
                    let alerts = alertsByRoute[current] ?? []
                    if alerts.isEmpty {
                        EmptyState(systemImage: "checkmark.circle", title: "No alerts for this route")
                    } else {
                        ForEach(Array(alerts.enumerated()), id: \.offset) { _, alert in
                            AlertCard(alert: alert)
                        }
                    }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private func load() async {
        isLoading = alertsByRoute.isEmpty
        defer { isLoading = false }
        do {
            let result = try await environment.api.alerts(forStop: stopQuery)
            alertsByRoute = result.alerts
            routesToDisplay = result.routesToDisplay
            if let selectedRoute, !routesToDisplay.contains(selectedRoute) { self.selectedRoute = nil }
            loadError = nil
        } catch let APIError.server(code, _, _) where code == 404 {
            routesToDisplay = []
            loadError = nil
        } catch {
            loadError = error
        }
    }
}

/// `AlertCard` on the web: cause icon + status pill, the effect, title,
/// when it applies, and the description with Read more past 140 chars.
struct AlertCard: View {
    let alert: TransitAlert
    @State private var expanded = false

    private var status: AlertStatus { AlertStatusCalculator.status(for: alert) }
    private var description: String {
        alert.description.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
    }
    private var canExpand: Bool { description.count > 140 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 6) {
                Image(systemName: causeIcon(alert.cause))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.mutedForeground)
                    .accessibilityHidden(true)
                Text(status.label)
                    .font(.geist(10, .semibold, relativeTo: .caption2))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .foregroundStyle(statusColor)
                    .background(statusColor.opacity(status.kind == .inactive ? 0 : 0.14), in: Capsule())
                    .background(status.kind == .inactive ? Theme.muted : .clear, in: Capsule())
                Spacer(minLength: 8)
                Text(TimeFormatting.niceLookingWords(alert.effect.replacingOccurrences(of: "_", with: " ").lowercased(), retainDigits: true))
                    .font(.geist(11, relativeTo: .caption2))
                    .foregroundStyle(Theme.mutedForeground)
            }

            Text(alert.title.isEmpty ? TimeFormatting.niceLookingWords(alert.effect.replacingOccurrences(of: "_", with: " ").lowercased()) : alert.title)
                .font(.geist(15, .semibold, relativeTo: .headline))
                .fixedSize(horizontal: false, vertical: true)

            if alert.startDate > 0 {
                Label(dateRange, systemImage: "clock")
                    .font(.meta)
                    .foregroundStyle(Theme.mutedForeground)
                    .labelStyle(.titleAndIcon)
            }

            Text(expanded || !canExpand ? description : String(description.prefix(140)) + "…")
                .font(.meta)
                .foregroundStyle(Theme.mutedForeground)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)

            if canExpand {
                Button {
                    withAnimation(.easeOut(duration: 0.2)) { expanded.toggle() }
                } label: {
                    Label(expanded ? "Show less" : "Read more", systemImage: expanded ? "chevron.up" : "chevron.down")
                        .font(.metaMedium)
                        .foregroundStyle(Theme.foreground)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .shadCardBackground()
    }

    private var statusColor: Color {
        switch status.kind {
        case .active: return Theme.danger
        case .soon: return Theme.warning
        case .inactive: return Theme.mutedForeground
        }
    }

    /// Same day: "3 Oct · 9:00 am – 5:00 pm"; otherwise both ends in full.
    private var dateRange: String {
        let start = Date(timeIntervalSince1970: Double(alert.startDate))
        guard alert.endDate > 0 else { return start.formatted(.dateTime.day().month().hour().minute()) }
        let end = Date(timeIntervalSince1970: Double(alert.endDate))
        if Calendar.current.isDate(start, inSameDayAs: end) {
            return "\(start.formatted(.dateTime.day().month())) · \(start.formatted(date: .omitted, time: .shortened)) – \(end.formatted(date: .omitted, time: .shortened))"
        }
        return "\(start.formatted(.dateTime.day().month().hour().minute())) – \(end.formatted(.dateTime.day().month().hour().minute()))"
    }

    private func causeIcon(_ cause: String) -> String {
        switch cause {
        case "MAINTENANCE": return "hammer"
        case "CONSTRUCTION": return "cone"
        case "WEATHER": return "cloud.rain"
        case "ACCIDENT": return "exclamationmark.triangle"
        case "MEDICAL_EMERGENCY": return "heart.text.square"
        case "POLICE_ACTIVITY": return "shield"
        case "TECHNICAL_PROBLEM": return "wrench"
        case "STRIKE", "DEMONSTRATION": return "person.3"
        case "HOLIDAY": return "calendar"
        default: return "exclamationmark.circle"
        }
    }
}
