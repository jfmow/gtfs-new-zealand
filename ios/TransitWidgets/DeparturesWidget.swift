import AppIntents
import SwiftUI
import TransitCore
import WidgetKit

// Next departures from a saved stop - Home Screen (small, medium) and Lock
// Screen (rectangular, inline). Same tokens and Geist type as the Live
// Activity; the rows read like Home's stop cards (route badge, headsign,
// countdown).

struct DeparturesWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "dev.suddsy.transit.departures", intent: SelectStopIntent.self, provider: DeparturesProvider()) { entry in
            DeparturesWidgetView(entry: entry)
                .containerBackground(Tokens.card, for: .widget)
        }
        .configurationDisplayName("Departures")
        .description("The next services from one of your saved stops.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Timeline

struct DeparturesEntry: TimelineEntry {
    struct Row: Hashable {
        let route: String
        let colorHex: String
        let headsign: String
        let departsAt: Date
        let isLive: Bool
    }

    enum State {
        case noSavedStops
        case failed
        case rows([Row])
    }

    let date: Date
    let stop: SavedStopEntity?
    let state: State

    /// Rows still to come at this entry's time.
    var upcoming: [Row] {
        guard case .rows(let rows) = state else { return [] }
        return rows.filter { $0.departsAt.timeIntervalSince(date) > -30 }
    }

    func minutes(until row: Row) -> String {
        TimeFormatting.timeTillArrivalString(minutes: max(0, row.departsAt.timeIntervalSince(date) / 60))
    }

    static let placeholderRows: [Row] = [
        Row(route: "70", colorHex: "0ea5e9", headsign: "Botany", departsAt: Date().addingTimeInterval(240), isLive: true),
        Row(route: "NX1", colorHex: "10b981", headsign: "Hibiscus Coast", departsAt: Date().addingTimeInterval(540), isLive: true),
        Row(route: "STH", colorHex: "f43f5e", headsign: "Papakura", departsAt: Date().addingTimeInterval(900), isLive: false),
        Row(route: "WEST", colorHex: "84cc16", headsign: "Swanson", departsAt: Date().addingTimeInterval(1260), isLive: false),
    ]
}

struct DeparturesProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> DeparturesEntry {
        DeparturesEntry(date: Date(), stop: nil, state: .rows(DeparturesEntry.placeholderRows))
    }

    func snapshot(for configuration: SelectStopIntent, in context: Context) async -> DeparturesEntry {
        if context.isPreview, SharedStore.savedStops.isEmpty { return placeholder(in: context) }
        return await load(configuration).first ?? placeholder(in: context)
    }

    func timeline(for configuration: SelectStopIntent, in context: Context) async -> Timeline<DeparturesEntry> {
        let entries = await load(configuration)
        // Fresh times every 15 min at most (the system budgets reloads
        // anyway); the per-minute entries count down in between.
        return Timeline(entries: entries, policy: .after(Date().addingTimeInterval(15 * 60)))
    }

    private func load(_ configuration: SelectStopIntent) async -> [DeparturesEntry] {
        let now = Date()
        guard let stop = await resolvedStop(configuration) else {
            return [DeparturesEntry(date: now, stop: nil, state: .noSavedStops)]
        }
        do {
            let departures = try await UpcomingDepartures.fetch(stopQuery: stop.id, limit: 8)
            let rows = departures.map { departure in
                DeparturesEntry.Row(
                    route: departure.route.name,
                    colorHex: departure.route.color,
                    headsign: TimeFormatting.niceLookingWords(departure.headsign),
                    departsAt: now.addingTimeInterval(departure.timeTillArrival * 60),
                    isLive: departure.locationTracking || departure.tripUpdateTracking
                )
            }
            // One entry a minute for the next 15, so countdowns tick down
            // without a network fetch each time.
            return (0..<15).map { minute in
                DeparturesEntry(date: now.addingTimeInterval(Double(minute) * 60), stop: stop, state: .rows(rows))
            }
        } catch {
            return [DeparturesEntry(date: now, stop: stop, state: .failed)]
        }
    }

    /// The configured stop, or the first saved one - a widget added before
    /// it's been configured (or whose stop was since unsaved) still shows
    /// something.
    private func resolvedStop(_ configuration: SelectStopIntent) async -> SavedStopEntity? {
        let saved = SharedStore.savedStops
        if let chosen = configuration.stop, saved.contains(where: { $0.query == chosen.id }) { return chosen }
        return saved.first.map(SavedStopEntity.init)
    }
}

// MARK: - Views

struct DeparturesWidgetView: View {
    let entry: DeparturesEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            switch family {
            case .accessoryInline: inline
            case .accessoryRectangular: rectangular
            case .systemMedium: home(rowLimit: 4, showsHeadsign: true)
            default: home(rowLimit: 3, showsHeadsign: false)
            }
        }
        .widgetURL(stopURL)
    }

    private var stopURL: URL? {
        guard let stop = entry.stop else { return URL(string: "transit://") }
        var components = URLComponents()
        components.scheme = "transit"
        components.host = "stop"
        components.queryItems = [URLQueryItem(name: "s", value: stop.id)]
        return components.url
    }

    // MARK: Home Screen

    private func home(rowLimit: Int, showsHeadsign: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "star.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(entry.stop.map { Color(hex: $0.colorHex) } ?? Tokens.mutedForeground)
                Text(entry.stop?.title ?? "Departures")
                    .font(.geist(13, .semibold))
                    .foregroundStyle(Tokens.foreground)
                    .lineLimit(1)
            }
            switch entry.state {
            case .noSavedStops:
                message("Save a stop in Transit to see its departures here.")
            case .failed:
                message("Couldn't load departures.")
            case .rows:
                let rows = entry.upcoming.prefix(rowLimit)
                if rows.isEmpty {
                    message("No upcoming services.")
                } else {
                    VStack(alignment: .leading, spacing: showsHeadsign ? 7 : 8) {
                        ForEach(Array(rows), id: \.self) { row in
                            HStack(spacing: 6) {
                                RouteTag(name: row.route, colorHex: row.colorHex)
                                if showsHeadsign {
                                    Text(row.headsign)
                                        .font(.geist(12))
                                        .foregroundStyle(Tokens.foreground)
                                        .lineLimit(1)
                                }
                                Spacer(minLength: 4)
                                Text(entry.minutes(until: row))
                                    .font(.geist(13, .semibold).monospacedDigit())
                                    .foregroundStyle(row.isLive ? Tokens.live : Tokens.foreground)
                                    .lineLimit(1)
                                    .fixedSize()
                            }
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(.geist(12))
            .foregroundStyle(Tokens.mutedForeground)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Lock Screen

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(entry.stop?.title ?? "Departures")
                .font(.system(size: 13, weight: .semibold))
                .widgetAccentable()
                .lineLimit(1)
            let rows = entry.upcoming.prefix(2)
            if rows.isEmpty {
                Text(entry.stop == nil ? "Save a stop in Transit" : "No upcoming services")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(rows), id: \.self) { row in
                    HStack(spacing: 4) {
                        Text(row.route).font(.system(size: 13, weight: .semibold))
                        Text(row.headsign).font(.system(size: 13)).lineLimit(1)
                        Spacer(minLength: 2)
                        Text(entry.minutes(until: row)).font(.system(size: 13, weight: .semibold).monospacedDigit())
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var inline: some View {
        if let next = entry.upcoming.first {
            Text("\(next.route) in \(entry.minutes(until: next)) · \(entry.stop?.title ?? "")")
        } else {
            Text(entry.stop?.title ?? "Save a stop in Transit")
        }
    }
}

/// The route's colour with its name, as `RouteBadge` draws it in the app.
private struct RouteTag: View {
    let name: String
    let colorHex: String

    var body: some View {
        let fill = colorHex.isEmpty ? "424242" : colorHex
        Text(name)
            .font(.geist(11, .semibold))
            .lineLimit(1)
            .foregroundStyle(RouteColors.text(onHex: fill))
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(Color(hex: fill), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            .fixedSize()
    }
}

#Preview(as: .systemMedium) {
    DeparturesWidget()
} timeline: {
    DeparturesEntry(date: Date(), stop: nil, state: .rows(DeparturesEntry.placeholderRows))
}
