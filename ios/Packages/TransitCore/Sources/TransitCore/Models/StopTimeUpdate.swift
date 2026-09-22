import Foundation

/// One stop's realtime prediction for a single trip - `GET
/// /{region}/realtime/stop-times?tripId=`. Unlike `Departure`, times here are
/// epoch milliseconds, not "HH:MM:SS" strings. Field names/shape confirmed
/// against a live response (2026-09-22).
public struct StopTimeUpdate: Codable, Hashable, Sendable, Identifiable {
    public let parentStopID: String
    public let childStopID: String
    public let arrivalTime: GoEpochMillis
    public let departureTime: GoEpochMillis
    public let scheduledTime: GoEpochMillis
    public let skipped: Bool
    public let passed: Bool
    /// Metres along the route shape from the vehicle's current position to
    /// this stop - 0 once passed.
    public let dist: Double

    public var id: String { childStopID }

    enum CodingKeys: String, CodingKey {
        case parentStopID = "parent_stop_id"
        case childStopID = "child_stop_id"
        case arrivalTime = "arrival_time"
        case departureTime = "departure_time"
        case scheduledTime = "scheduled_time"
        case skipped, passed, dist
    }
}
