import AppIntents
import Foundation
import TransitCore

// Siri and Shortcuts: "When's the next bus from Britomart in Transit",
// "Go home with Transit", "Plan a journey in Transit". Saved stops and
// places come from the app group copy `RootView` keeps up to date.

/// Answers without opening the app: the next few services from a saved stop.
struct NextDeparturesIntent: AppIntent {
    static var title: LocalizedStringResource = "Next departures"
    static var description = IntentDescription("Tells you the next services from one of your saved stops.")

    @Parameter(title: "Stop")
    var stop: SavedStopEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Next departures from \(\.$stop)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let departures = try await UpcomingDepartures.fetch(stopQuery: stop.id, limit: 3)
        guard !departures.isEmpty else {
            return .result(dialog: "Nothing is due at \(stop.title) right now.")
        }
        let parts = departures.map { departure in
            let when = TimeFormatting.timeTillArrivalString(minutes: departure.timeTillArrival)
            let time = when == "Now" ? "now" : "in \(when)"
            return "\(departure.route.name) to \(TimeFormatting.niceLookingWords(departure.headsign)) \(time)"
        }
        return .result(dialog: "From \(stop.title): \(parts.joined(separator: ", then ")).")
    }
}

struct SavedPlaceEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Saved place"
    static var defaultQuery = SavedPlaceQuery()

    let id: String
    let name: String
    let coordinate: Coordinate

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

    init(_ place: SharedStore.SavedPlace) {
        id = place.id
        name = place.name
        coordinate = Coordinate(latitude: place.latitude, longitude: place.longitude)
    }
}

struct SavedPlaceQuery: EntityQuery, EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [SavedPlaceEntity] {
        SharedStore.savedPlaces.filter { identifiers.contains($0.id) }.map(SavedPlaceEntity.init)
    }

    func entities(matching string: String) async throws -> [SavedPlaceEntity] {
        SharedStore.placesInRegion.filter { $0.name.localizedCaseInsensitiveContains(string) }.map(SavedPlaceEntity.init)
    }

    func suggestedEntities() async throws -> [SavedPlaceEntity] {
        SharedStore.placesInRegion.map(SavedPlaceEntity.init)
    }
}

/// Opens the planner with a journey from here to a saved place.
struct GoToPlaceIntent: AppIntent {
    static var title: LocalizedStringResource = "Plan a trip to a place"
    static var description = IntentDescription("Plans a journey from where you are to one of your saved places.")
    static var openAppWhenRun = true

    @Parameter(title: "Place")
    var place: SavedPlaceEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Plan a trip to \(\.$place)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        AppAction.relay.perform(.goTo(name: place.name, coordinate: place.coordinate))
        return .result()
    }
}

struct PlanJourneyIntent: AppIntent {
    static var title: LocalizedStringResource = "Plan a journey"
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppAction.relay.perform(.planJourney)
        return .result()
    }
}

struct TransitShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: NextDeparturesIntent(),
            phrases: [
                "Next departures from \(\.$stop) in \(.applicationName)",
                "When's the next bus from \(\.$stop) in \(.applicationName)",
                "Next departures in \(.applicationName)",
            ],
            shortTitle: "Next departures",
            systemImageName: "clock"
        )
        AppShortcut(
            intent: GoToPlaceIntent(),
            phrases: [
                "Go to \(\.$place) with \(.applicationName)",
                "Get me to \(\.$place) with \(.applicationName)",
                "Plan a trip in \(.applicationName)",
            ],
            shortTitle: "Go to a place",
            systemImageName: "house"
        )
        AppShortcut(
            intent: PlanJourneyIntent(),
            phrases: ["Plan a journey in \(.applicationName)"],
            shortTitle: "Plan a journey",
            systemImageName: "point.topleft.down.to.point.bottomright.curvepath"
        )
    }
}
