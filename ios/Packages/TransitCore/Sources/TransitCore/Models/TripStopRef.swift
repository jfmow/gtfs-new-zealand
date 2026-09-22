import Foundation

/// The compact stop reference embedded in a `Departure` row's `stop` field
/// and a `Vehicle`'s `trip.{first,next,final,current}_stop` fields - not a
/// full `Stop`, just what those realtime/board responses inline. Field
/// names/shape confirmed against live responses (2026-09-22).
public struct TripStopRef: Codable, Hashable, Sendable {
    public let lat: Double
    public let lon: Double
    public let parentStopID: String
    public let name: String
    public let platform: String
    public let sequence: Int
    public let childStopID: String

    public var coordinate: Coordinate { Coordinate(latitude: lat, longitude: lon) }

    enum CodingKeys: String, CodingKey {
        case lat, lon, name, platform, sequence
        case parentStopID = "parent_stop_id"
        case childStopID = "child_stop_id"
    }
}
