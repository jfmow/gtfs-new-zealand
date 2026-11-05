import Foundation

/// What the app shares with its widgets and App Intents through the app
/// group: the rider's region, saved stops and saved places. The app writes it (see
/// `RootView`); the widget extension only reads.
enum SharedStore {
    static let appGroup = "group.dev.suddsy.transit"

    /// Falls back to the app's own defaults if the group container isn't
    /// available (an unprovisioned build) - the app keeps working, the
    /// widget just sees nothing saved.
    static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

    struct SavedStop: Codable, Hashable, Identifiable {
        /// The board query (`/services/{query}`).
        let query: String
        let title: String
        let colorHex: String
        var id: String { query }
    }

    struct SavedPlace: Codable, Hashable, Identifiable {
        let name: String
        let latitude: Double
        let longitude: Double
        /// SF Symbol for the place's icon (`SavedPlaceIcon.systemImage`).
        let systemImage: String
        let regionSlug: String
        var id: String { "\(regionSlug)/\(name)" }
    }

    private static let regionKey = "regionSlug"
    private static let savedStopsKey = "savedStops"
    private static let savedPlacesKey = "savedPlaces"

    static var regionSlug: String? {
        get { defaults.string(forKey: regionKey) }
        set { defaults.set(newValue, forKey: regionKey) }
    }

    static var savedStops: [SavedStop] {
        get {
            guard let data = defaults.data(forKey: savedStopsKey) else { return [] }
            return (try? JSONDecoder().decode([SavedStop].self, from: data)) ?? []
        }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: savedStopsKey) }
    }

    static var savedPlaces: [SavedPlace] {
        get {
            guard let data = defaults.data(forKey: savedPlacesKey) else { return [] }
            return (try? JSONDecoder().decode([SavedPlace].self, from: data)) ?? []
        }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: savedPlacesKey) }
    }

    /// Saved places in the rider's current region.
    static var placesInRegion: [SavedPlace] {
        let region = regionSlug ?? "at"
        return savedPlaces.filter { $0.regionSlug == region }
    }
}
