import Foundation

/// One match from `GET /{region}/stops/find-stop/{q}` - a lighter-weight
/// stop record for autocomplete than the full `Stop`. Field names/shape
/// confirmed against a live response (2026-09-22).
public struct StopSearchResult: Codable, Hashable, Sendable, Identifiable {
    public let name: String
    /// "bus" | "train" | "ferry" | "other"
    public let typeOfStop: String
    public let stopLat: Double
    public let stopLon: Double
    public let stopCode: String
    public let stopID: String

    public var id: String { stopID }
    public var coordinate: Coordinate { Coordinate(latitude: stopLat, longitude: stopLon) }

    enum CodingKeys: String, CodingKey {
        case name
        case typeOfStop = "type_of_stop"
        case stopLat = "stop_lat"
        case stopLon = "stop_lon"
        case stopCode = "stop_code"
        case stopID = "stop_id"
    }
}
