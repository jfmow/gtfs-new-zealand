import Foundation

/// One row of a stop's departures board - `GET /{region}/services/{stop}`
/// and `.../schedule`. Called `Service`/`ServicesResponse2` on the backend
/// and in the web app; named `Departure` here since "Service" is ambiguous
/// in Swift. Field names/shape confirmed against a live response
/// (2026-09-22).
public struct Departure: Codable, Hashable, Sendable, Identifiable {
    public let tripID: String
    public let headsign: String
    /// Scheduled time as "HH:MM:SS" - can be >= "24:00:00" for a service
    /// past midnight on the same GTFS service day; see
    /// `GoDuration`/formatting helpers for how the web app handles that.
    public let arrivalTime: String
    public let platform: String
    /// Negative before the vehicle reaches this stop's position in the
    /// board's ordering; 0 means "at this stop".
    public let stopsAway: Int
    /// 0-4, or -1 if unknown.
    public let occupancy: Int
    public let canceled: Bool
    public let skipped: Bool
    public let bikesAllowed: Int
    public let wheelchairsAllowed: Int
    public let route: RouteSummary
    public let stop: TripStopRef
    public let locationTracking: Bool
    public let tripUpdateTracking: Bool
    public let departed: Bool
    /// Minutes until arrival - the authoritative, day-aware sort key (don't
    /// re-derive this from `arrivalTime`, which can be ambiguous across
    /// midnight). Negative once departed.
    public let timeTillArrival: Double
    public let stopState: String
    public let tripStarted: Bool
    public let platformChanged: Bool

    public var id: String { tripID }

    /// Whether this row can be opened in the live tracker - mirrors the web
    /// board's tap-target rule.
    public var isTrackable: Bool {
        (locationTracking || tripUpdateTracking) && !canceled && !skipped && !departed
    }

    enum CodingKeys: String, CodingKey {
        case tripID = "trip_id"
        case headsign
        case arrivalTime = "arrival_time"
        case platform
        case stopsAway = "stops_away"
        case occupancy
        case canceled
        case skipped
        case bikesAllowed = "bikes_allowed"
        case wheelchairsAllowed = "wheelchairs_allowed"
        case route
        case stop
        case locationTracking = "location_tracking"
        case tripUpdateTracking = "trip_update_tracking"
        case departed
        case timeTillArrival = "time_till_arrival"
        case stopState = "stop_state"
        case tripStarted = "trip_started"
        case platformChanged = "platform_changed"
    }
}
