import ActivityKit
import Foundation

/// The Live Activity for one vehicle counted down to the rider's stop -
/// started from the trip tracker when they set a reminder (get on, get off,
/// arriving). Built by the app (`mobile/src/lib/trip-live.ts`) while it's
/// open and pushed by the backend (`tripActivityState` in
/// trip_activity.go) while it isn't. Copied in modules/transit-native/ios
/// and targets/widgets - keep the two the same.
public struct TripActivityAttributes: ActivityAttributes {
    /// Every field decodes leniently (missing -> default), so a push from an
    /// older or newer server still renders.
    public struct ContentState: Codable, Hashable {
        public var version: Int
        /// coming | next (your stop is its next stop) | gone | cancelled
        public var phase: String
        /// When it's due at your stop (Unix s).
        public var targetUnix: Double
        public var delayMinutes: Int
        /// Stops before yours - 0 when yours is next. Only with a placed vehicle.
        public var stopsAway: Int?
        public var nextStopName: String?
        public var hasVehicle: Bool
        public var isRealtime: Bool
        public var skipped: Bool
        public var occupancy: Int?
        public var updatedUnix: Double

        public var targetDate: Date { Date(timeIntervalSince1970: targetUnix) }

        enum CodingKeys: String, CodingKey {
            case version, phase, targetUnix, delayMinutes, stopsAway, nextStopName, hasVehicle, isRealtime, skipped, occupancy, updatedUnix
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            version = (try? c.decodeIfPresent(Int.self, forKey: .version)) ?? 1
            phase = (try? c.decodeIfPresent(String.self, forKey: .phase)) ?? "coming"
            targetUnix = (try? c.decodeIfPresent(Double.self, forKey: .targetUnix)) ?? 0
            delayMinutes = (try? c.decodeIfPresent(Int.self, forKey: .delayMinutes)) ?? 0
            stopsAway = try? c.decodeIfPresent(Int.self, forKey: .stopsAway)
            nextStopName = try? c.decodeIfPresent(String.self, forKey: .nextStopName)
            hasVehicle = (try? c.decodeIfPresent(Bool.self, forKey: .hasVehicle)) ?? false
            isRealtime = (try? c.decodeIfPresent(Bool.self, forKey: .isRealtime)) ?? false
            skipped = (try? c.decodeIfPresent(Bool.self, forKey: .skipped)) ?? false
            occupancy = try? c.decodeIfPresent(Int.self, forKey: .occupancy)
            updatedUnix = (try? c.decodeIfPresent(Double.self, forKey: .updatedUnix)) ?? 0
        }
    }

    public var tripID: String
    public var regionSlug: String
    public var stopID: String
    public var stopName: String
    public var routeShortName: String
    public var routeColorHex: String
    public var headsign: String
    /// bus | train | ferry; empty when unknown.
    public var vehicleMode: String
    /// get_off (you're on it) | arrival (you're waiting for it, or just watching)
    public var kind: String

    /// Opens the trip's tracker with this stop as yours.
    public var tripURL: URL? {
        var c = URLComponents()
        c.scheme = "transit"
        c.host = "trip"
        c.queryItems = [
            URLQueryItem(name: "tripId", value: tripID),
            URLQueryItem(name: "stop", value: stopID),
            URLQueryItem(name: "region", value: regionSlug),
        ]
        return c.url
    }
}
