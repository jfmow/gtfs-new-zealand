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

/// Everything a tracked journey polls for, in one request - `GET
/// /{region}/realtime/journey?tripId=a,b`: the live vehicles on its trips
/// (as `realtime/live`) and each trip's predicted stop times (as
/// `realtime/stop-times`).
public struct JourneyLive: Decodable, Sendable {
    /// Nil when the server couldn't read the feed; empty when none of the
    /// trips has a vehicle out.
    public let vehicles: [Vehicle]?
    /// By trip id - a trip whose times couldn't be worked out is missing.
    public let stopTimes: [String: [StopTimeUpdate]]

    enum CodingKeys: String, CodingKey {
        case vehicles
        case stopTimes = "stop_times"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        vehicles = try c.decodeIfPresent([Vehicle].self, forKey: .vehicles)
        stopTimes = try c.decodeIfPresent([String: [StopTimeUpdate]].self, forKey: .stopTimes) ?? [:]
    }
}
