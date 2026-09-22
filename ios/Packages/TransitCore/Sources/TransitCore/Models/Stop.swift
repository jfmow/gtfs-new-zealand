import Foundation

/// A GTFS stop (parent station or child platform/bay) - `gtfs.Stop` on the
/// backend. Field names/shape confirmed against a live `GET /at/stops`
/// response (2026-09-22).
public struct Stop: Codable, Hashable, Sendable, Identifiable {
    public let stopID: String
    public let parentStation: String
    public let stopName: String
    public let stopCode: String
    public let stopHeadsign: String
    public let stopLat: Double
    public let stopLon: Double
    public let platformNumber: String
    public let stopSequence: Int
    public let isChildStop: Bool
    public let locationType: Int
    /// "bus" | "train" | "ferry" | "other"
    public let stopType: String
    public let wheelchairBoarding: Int

    public var id: String { stopID }
    public var coordinate: Coordinate { Coordinate(latitude: stopLat, longitude: stopLon) }

    enum CodingKeys: String, CodingKey {
        case stopID = "stop_id"
        case parentStation = "parent_station"
        case stopName = "stop_name"
        case stopCode = "stop_code"
        case stopHeadsign = "stop_headsign"
        case stopLat = "stop_lat"
        case stopLon = "stop_lon"
        case platformNumber = "platform_number"
        case stopSequence = "stop_sequence"
        case isChildStop = "is_child_stop"
        case locationType = "location_type"
        case stopType = "stop_type"
        case wheelchairBoarding = "wheelchair_boarding"
    }
}
