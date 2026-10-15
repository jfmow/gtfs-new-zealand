import Foundation

/// One candidate journey from the RAPTOR planner - `GET
/// /{region}/services/plan` and `.../plan/{id}`. `gtfs.JourneyPlan` on the
/// backend. Unlike almost everything else in this API, its fields are
/// PascalCase (a handful, added later, are snake_case) - field names/casing
/// confirmed against a live response (2026-09-22); don't "fix" the casing to
/// match the rest of the package, it has to match the wire format exactly.
public struct JourneyPlan: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let startLat: Double
    public let startLon: Double
    public let endLat: Double
    public let endLon: Double
    // `var`, not `let`: JourneyPlanLiveAdjuster.buildLiveJourney produces a
    // realtime-shifted copy of a plan by mutating a `var plan = original`
    // it took as input - see its doc comment.
    public var departureTime: GoTime
    public var arrivalTime: GoTime
    public var totalDuration: GoDuration
    public let transfers: Int
    public let transferStops: [Stop]?
    public var legs: [JourneyLeg]
    /// A FeatureCollection combining every leg's shape (each leg's
    /// `properties.mode`/`to_stop_id` distinguish its pieces) - see
    /// `GeoJSONFeatureCollection`.
    public let routeGeoJSON: GeoJSONFeatureCollection?

    public var transitLegs: [JourneyLeg] { legs.filter { $0.mode == "transit" } }

    enum CodingKeys: String, CodingKey {
        case id = "ID"
        case startLat = "StartLat"
        case startLon = "StartLon"
        case endLat = "EndLat"
        case endLon = "EndLon"
        case departureTime = "DepartureTime"
        case arrivalTime = "ArrivalTime"
        case totalDuration = "TotalDuration"
        case transfers = "Transfers"
        case transferStops = "TransferStops"
        case legs = "Legs"
        case routeGeoJSON = "RouteGeoJSON"
    }
}

/// One leg of a `JourneyPlan` - `gtfs.JourneyLeg` on the backend. `mode` is
/// `"transit"` or `"walk"`; only a transit leg has `tripID`/`routeID`/
/// `route`/`realtimeStatus`/`delaySeconds`.
public struct JourneyLeg: Codable, Hashable, Sendable {
    public let mode: String
    public let fromStop: Stop?
    public let toStop: Stop?
    public let tripID: String
    public let routeID: String
    public let route: Route?
    /// Realtime-adjusted departure/arrival - use these for display; use
    /// `scheduledDepartureTime`/`scheduledArrivalTime` only to compute delay.
    /// `var`: shifted in place by JourneyPlanLiveAdjuster.buildLiveJourney.
    public var departureTime: GoTime
    public var arrivalTime: GoTime
    public var duration: GoDuration
    public let distanceKm: Double
    public let stopSequenceID: Int
    /// Zero-valued (`date == nil`) on a walk leg, which has no schedule.
    public let scheduledDepartureTime: GoTime
    public let scheduledArrivalTime: GoTime
    /// "scheduled" | "on_time" | "delayed" | "early" | "canceled" | "skipped"
    /// - only present on a transit leg.
    public var realtimeStatus: String?
    public var delaySeconds: Int?
    /// False when this transit leg's trip has gone stale/unusable (e.g. its
    /// data disappeared from the realtime feed) - the web app flags the
    /// whole journey as "service disruption" when any leg has this false.
    public let tripUsable: Bool
    /// True when a vehicle was reporting its position on this leg's trip
    /// when the plan was made - `realtimeStatus` can read "on_time" hours
    /// before any bus is assigned. Nil on a plan from an older server.
    public var vehicleTracked: Bool? = nil

    enum CodingKeys: String, CodingKey {
        case mode = "Mode"
        case fromStop = "FromStop"
        case toStop = "ToStop"
        case tripID = "TripID"
        case routeID = "RouteID"
        case route = "Route"
        case departureTime = "DepartureTime"
        case arrivalTime = "ArrivalTime"
        case duration = "Duration"
        case distanceKm = "DistanceKm"
        case stopSequenceID = "StopSequenceID"
        case scheduledDepartureTime = "scheduled_departure_time"
        case scheduledArrivalTime = "scheduled_arrival_time"
        case realtimeStatus = "realtime_status"
        case delaySeconds = "delay_seconds"
        case tripUsable = "trip_usable"
        case vehicleTracked = "vehicle_tracked"
    }
}

public extension Array where Element == JourneyLeg {
    /// Whether the first leg is a walk that only reaches the stop the rider
    /// is already at ("Walk to Alice Wylie Reserve · 1 min · 20 m") - the
    /// timeline and map leave it out. Same 50 m "effectively the same pole"
    /// cut-off the planner uses for transfers. Kept when it's to a different
    /// platform - the rider still has to move.
    var hidesOriginWalk: Bool {
        guard count > 1, let leg = first, leg.mode == "walk", self[1].mode == "transit",
              leg.distanceKm <= 0.05, leg.duration.timeInterval <= 120 else { return false }
        if let platform = leg.toStop?.platformNumber, !platform.isEmpty {
            return leg.fromStop?.platformNumber == platform
        }
        return true
    }
}

public extension JourneyPlan {
    /// `routeGeoJSON`'s features minus the origin walk's line when
    /// `legs.hidesOriginWalk` - features skip legs with no shape, so it's
    /// matched as the first feature, a walk to the first leg's stop.
    var visibleRouteFeatures: [GeoJSONFeature] {
        guard var features = routeGeoJSON?.features else { return [] }
        if legs.hidesOriginWalk, let feature = features.first,
           (feature.properties?["mode"]?.stringValue ?? "walk") == "walk" {
            let toStop = feature.properties?["to_stop_id"]?.stringValue
            if toStop == nil || toStop == legs[0].toStop?.stopID { features.removeFirst() }
        }
        return features
    }
}
