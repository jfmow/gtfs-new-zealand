import Foundation

/// A live vehicle position - `GET /{region}/realtime/live`. `trip` and
/// `state` are only populated when the request included `tripId` for this
/// vehicle. Field names/shape confirmed against live responses (2026-09-22).
public struct Vehicle: Codable, Hashable, Sendable, Identifiable {
    public let tripID: String
    public let route: RouteSummary
    public let trip: VehicleTrip?
    /// 0-4, or -1 if unknown.
    public let occupancy: Int
    public let licensePlate: String
    public let position: VehiclePosition
    /// "bus" | "train" | "ferry" | "school bus" - lowercase, unlike
    /// `route.type`.
    public let type: String
    /// Only present when `trip` is - one of "AtStop", "Arriving",
    /// "Approaching", "Leaving", "Travelling", "Unknown" (from
    /// `providers/vehiclestate`).
    public let state: String?
    public let offCourse: Bool

    public var id: String { tripID }

    /// `state` as shown to a person - the raw value is an internal token
    /// (`providers/vehiclestate`'s Go constants), not copy.
    public var humanState: String? {
        switch state {
        case "AtStop": return "At stop"
        case "Arriving": return "Arriving"
        case "Approaching": return "Approaching"
        case "Leaving": return "Leaving stop"
        case "Travelling": return "Travelling"
        case "Unknown", nil: return nil
        case let other?: return other
        }
    }

    enum CodingKeys: String, CodingKey {
        case tripID = "trip_id"
        case route, trip, occupancy
        case licensePlate = "license_plate"
        case position, type, state
        case offCourse = "off_course"
    }
}

public struct VehiclePosition: Codable, Hashable, Sendable {
    public let lat: Double
    public let lon: Double
    /// Degrees, 0-360; 0 means "no bearing data" (don't rotate the marker).
    public let bearing: Double

    public var coordinate: Coordinate { Coordinate(latitude: lat, longitude: lon) }
}

public struct VehicleTrip: Codable, Hashable, Sendable {
    public let firstStop: TripStopRef?
    public let nextStop: TripStopRef?
    public let finalStop: TripStopRef?
    public let currentStop: TripStopRef?
    public let headsign: String

    enum CodingKeys: String, CodingKey {
        case firstStop = "first_stop"
        case nextStop = "next_stop"
        case finalStop = "final_stop"
        case currentStop = "current_stop"
        case headsign
    }
}
