import AppIntents
import Foundation
import TransitCore

// Shared by the widget extension (the departures widget's "choose a stop")
// and the app (Siri's "next departures from ..."): a saved stop as an App
// Intents entity, read from the app group copy `SharedStore` keeps.

struct SavedStopEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Saved stop"
    static var defaultQuery = SavedStopQuery()

    /// The board query (`SharedStore.SavedStop.query`).
    let id: String
    let title: String
    let colorHex: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }

    init(_ stop: SharedStore.SavedStop) {
        id = stop.query
        title = stop.title
        colorHex = stop.colorHex
    }
}

struct SavedStopQuery: EntityQuery, EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [SavedStopEntity] {
        SharedStore.savedStops.filter { identifiers.contains($0.query) }.map(SavedStopEntity.init)
    }

    func entities(matching string: String) async throws -> [SavedStopEntity] {
        SharedStore.savedStops.filter { $0.title.localizedCaseInsensitiveContains(string) }.map(SavedStopEntity.init)
    }

    func suggestedEntities() async throws -> [SavedStopEntity] {
        SharedStore.savedStops.map(SavedStopEntity.init)
    }

    func defaultResult() async -> SavedStopEntity? {
        SharedStore.savedStops.first.map(SavedStopEntity.init)
    }
}

/// The departures widget's configuration - which saved stop it shows.
struct SelectStopIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Choose a stop"
    static var description = IntentDescription("Shows the next departures from one of your saved stops.")

    @Parameter(title: "Stop")
    var stop: SavedStopEntity?
}

/// The next departures from a stop, soonest first - what the widget and
/// Siri show. The same filtering as Home's cards (`NextDeparturesLoader`).
enum UpcomingDepartures {
    static func fetch(stopQuery: String, limit: Int) async throws -> [Departure] {
        let region = SharedStore.regionSlug.flatMap(Region.bySlug) ?? .auckland
        let api = APIClient(region: region)
        let all: [Departure]
        do {
            all = try await api.departures(stop: stopQuery, limit: 12)
        } catch let APIError.server(code, _, _) where code == 404 {
            return []
        }
        return Array(all.filter { $0.timeTillArrival >= 0 && !$0.departed && !$0.canceled && !$0.skipped }
            .sorted { $0.timeTillArrival < $1.timeTillArrival }
            .prefix(limit))
    }
}
