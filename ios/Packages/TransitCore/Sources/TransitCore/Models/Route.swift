import Foundation

/// A GTFS route - `gtfs.Route` on the backend, from `GET /{region}/routes`.
/// Field names/shape confirmed against a live response (2026-09-22).
public struct Route: Codable, Hashable, Sendable, Identifiable {
    public let routeID: String
    public let agencyID: String
    public let routeShortName: String
    public let routeLongName: String
    /// The raw GTFS `route_type` integer (2 = rail, 3 = bus, 4 = ferry, ...).
    public let routeType: Int
    /// Hex colour with no leading '#' - often empty, in which case fall back
    /// to the region's brand colour.
    public let routeColor: String
    /// "Bus" | "Train" | "Ferry" | "School bus" - already humanised by the
    /// backend, unlike `routeType`.
    public let vehicleType: String

    public var id: String { routeID }

    enum CodingKeys: String, CodingKey {
        case routeID = "route_id"
        case agencyID = "agency_id"
        case routeShortName = "route_short_name"
        case routeLongName = "route_long_name"
        case routeType = "route_type"
        case routeColor = "route_color"
        case vehicleType = "vehicle_type"
    }
}

/// The compact route summary embedded in a `Departure` or `Vehicle` - not
/// the full `Route` record, just what the realtime/board endpoints inline.
public struct RouteSummary: Codable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let color: String
    /// Only present on `realtime/live` rows, not the departures board.
    public let type: String?
}
