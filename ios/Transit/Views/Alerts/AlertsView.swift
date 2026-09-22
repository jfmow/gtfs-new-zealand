import SwiftUI
import TransitCore

/// Alerts for a stop, grouped into per-route tabs - `pages/alerts.tsx`
/// (`?s=` mode).
struct AlertsView: View {
    let stopQuery: String
    let title: String

    @Environment(AppEnvironment.self) private var environment
    @State private var alertsByRoute: [String: [TransitAlert]] = [:]
    @State private var routesToDisplay: [String] = []
    @State private var selectedRoute: String?
    @State private var errorMessage: String?
    @State private var isLoading = false

    var body: some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            ProgressView()
        } else if let errorMessage {
            ContentUnavailableView("Couldn't load alerts", systemImage: "wifi.slash", description: Text(errorMessage))
        } else if routesToDisplay.isEmpty {
            ContentUnavailableView("No alerts", systemImage: "checkmark.circle", description: Text("There are no service alerts for this stop."))
        } else {
            VStack(spacing: 0) {
                Picker("Route", selection: Binding(get: { selectedRoute ?? routesToDisplay[0] }, set: { selectedRoute = $0 })) {
                    ForEach(routesToDisplay, id: \.self) { route in
                        Text(route).tag(route)
                    }
                }
                .pickerStyle(.segmented)
                .padding()

                let current = selectedRoute ?? routesToDisplay[0]
                let alerts = alertsByRoute[current] ?? []
                if alerts.isEmpty {
                    ContentUnavailableView("No alerts for this route", systemImage: "checkmark.circle")
                } else {
                    List(alerts, id: \.title) { alert in
                        TransitCard { AlertCard(alert: alert) }
                            .cardListRow()
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Theme.paper)
                }
            }
            .background(Theme.paper)
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await environment.api.alerts(forStop: stopQuery)
            alertsByRoute = result.alerts
            routesToDisplay = result.routesToDisplay
            errorMessage = nil
        } catch let APIError.server(code, _, _) where code == 404 {
            routesToDisplay = []
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct AlertCard: View {
    let alert: TransitAlert
    @State private var expanded = false

    private var status: AlertStatus { AlertStatusCalculator.status(for: alert) }
    private var canExpand: Bool { alert.description.count > 140 }
    private var truncatedDescription: String {
        guard canExpand, !expanded else { return alert.description }
        return String(alert.description.prefix(140)) + "…"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                CircularBadge(diameter: 36, fill: badgeColor) {
                    Image(systemName: causeIcon(alert.cause))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(alert.title.isEmpty ? humanize(alert.effect) : alert.title)
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .foregroundStyle(Theme.ink)
                    Text(dateRange).font(.caption2.monospacedDigit()).foregroundStyle(Theme.steel.opacity(0.8))
                }
                Spacer()
                statusBadge
            }
            Text(truncatedDescription).font(.subheadline).foregroundStyle(Theme.steel)
            if canExpand {
                Button(expanded ? "Show less" : "Read more") { expanded.toggle() }
                    .font(.caption.weight(.medium))
            }
        }
    }

    private var statusBadge: some View {
        Text(status.label)
            .font(.caption2.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(badgeColor.opacity(0.15))
            .foregroundStyle(badgeColor)
            .clipShape(Capsule())
    }

    private var badgeColor: Color {
        switch status.kind {
        case .active: return Theme.alert
        case .soon: return Theme.delayed
        case .inactive: return Theme.steel
        }
    }

    private var dateRange: String {
        let start = Date(timeIntervalSince1970: Double(alert.startDate))
        let end = alert.endDate > 0 ? Date(timeIntervalSince1970: Double(alert.endDate)) : nil
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_NZ")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        if let end {
            return "\(formatter.string(from: start)) – \(formatter.string(from: end))"
        }
        return formatter.string(from: start)
    }

    private func causeIcon(_ cause: String) -> String {
        switch cause {
        case "MAINTENANCE", "CONSTRUCTION": return "hammer"
        case "WEATHER": return "cloud.rain"
        case "ACCIDENT", "MEDICAL_EMERGENCY": return "exclamationmark.triangle"
        case "TECHNICAL_PROBLEM": return "wrench"
        case "STRIKE": return "person.crop.circle.badge.exclamationmark"
        case "DEMONSTRATION": return "megaphone"
        case "HOLIDAY": return "calendar"
        default: return "info.circle"
        }
    }

    private func humanize(_ raw: String) -> String {
        raw.replacingOccurrences(of: "_", with: " ").capitalized
    }
}
