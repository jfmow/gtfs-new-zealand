import Foundation

/// Typed wrappers over `APIClient.get`/`postForm` for every endpoint needed
/// by the read-only screens and the journey planner. Notification/device
/// endpoints are added alongside the push/reminders work (later phase) -
/// `APIClient.postForm` is already general enough for them.
extension APIClient {
    // MARK: - Stops

    public func stops(includeChildren: Bool = false, type: StopType = .all) async throws -> [Stop] {
        try await get("stops", query: [
            .init(name: "children", value: includeChildren ? "true" : "false"),
            .init(name: "stop_type", value: type.rawValue),
        ])
    }

    public func stopsForTrip(tripID: String) async throws -> [TripStopRef] {
        try await get("stops/\(Self.pathSegment(tripID))")
    }

    public func closestStops(to coordinate: Coordinate) async throws -> [Stop] {
        try await get("stops/closest-stop", query: [
            .init(name: "lat", value: String(coordinate.latitude)),
            .init(name: "lon", value: String(coordinate.longitude)),
        ])
    }

    public func stop(stopID: String) async throws -> Stop {
        try await get("stops/stop/\(Self.pathSegment(stopID))")
    }

    public func findStop(matching query: String, includeChildren: Bool = false) async throws -> [StopSearchResult] {
        try await get("stops/find-stop/\(Self.pathSegment(query))", query: [
            .init(name: "children", value: includeChildren ? "true" : "false"),
        ])
    }

    // MARK: - Routes

    public func routes() async throws -> [String: Route] {
        try await get("routes")
    }

    public func route(routeID: String) async throws -> Route {
        try await get("routes/\(Self.pathSegment(routeID))")
    }

    public func findRoute(matching query: String) async throws -> [RouteSearchResult] {
        try await get("routes/find-route/\(Self.pathSegment(query))")
    }

    // MARK: - Departures board

    public func departures(stop: String, limit: Int = 200) async throws -> [Departure] {
        try await get("services/\(Self.pathSegment(stop))", query: [.init(name: "limit", value: String(limit))])
    }

    public func schedule(stop: String, date: Date) async throws -> [Departure] {
        try await get("services/\(Self.pathSegment(stop))/schedule", query: [
            .init(name: "date", value: String(Int64(date.timeIntervalSince1970))),
        ])
    }

    // MARK: - Journey planning

    public func planJourney(_ request: JourneyPlanRequest) async throws -> [JourneyPlan] {
        try await get("services/plan", query: request.queryItems)
    }

    /// Reopens a previously-computed plan by its id (a share link, a
    /// notification deeplink, or a resumed in-progress journey) - kept
    /// server-side for ~6h after arrival.
    public func plan(id: String) async throws -> [JourneyPlan] {
        try await get("services/plan/\(Self.pathSegment(id))")
    }

    // MARK: - Realtime

    public func liveVehicles(tripIDs: [String] = [], type: VehicleFilterType = .all) async throws -> [Vehicle] {
        var query = [URLQueryItem(name: "type", value: type.rawValue)]
        if !tripIDs.isEmpty {
            query.append(.init(name: "tripId", value: tripIDs.joined(separator: ",")))
        }
        return try await get("realtime/live", query: query)
    }

    public func stopTimes(tripID: String) async throws -> [StopTimeUpdate] {
        try await get("realtime/stop-times", query: [.init(name: "tripId", value: tripID)])
    }

    public func alerts(forStop stop: String, todayOnly: Bool = false) async throws -> AlertsForStop {
        try await get("realtime/alerts/\(Self.pathSegment(stop))", query: todayOnly ? [.init(name: "today", value: "true")] : [])
    }

    public func alerts(forRoute routeID: String) async throws -> [TransitAlert] {
        try await get("realtime/alerts/route/\(Self.pathSegment(routeID))")
    }

    public func findMyVehicle(near coordinate: Coordinate) async throws -> [NearbyVehicle] {
        try await get("realtime/find-my-vehicle/\(Self.pathSegment(String(coordinate.latitude)))/\(Self.pathSegment(String(coordinate.longitude)))")
    }

    // MARK: - Map

    public func routeShape(tripID: String? = nil, routeID: String? = nil) async throws -> RouteShape {
        var query: [URLQueryItem] = []
        if let tripID { query.append(.init(name: "tripId", value: tripID)) }
        if let routeID { query.append(.init(name: "routeId", value: routeID)) }
        return try await get("map/geojson/shapes", query: query)
    }

    public func walkingDirections(from: Coordinate, to: Coordinate) async throws -> WalkingDirections {
        try await get("map/nav", query: [
            .init(name: "startLat", value: String(from.latitude)),
            .init(name: "startLon", value: String(from.longitude)),
            .init(name: "endLat", value: String(to.latitude)),
            .init(name: "endLon", value: String(to.longitude)),
            .init(name: "method", value: "walking"),
        ])
    }

    public func searchLocations(matching query: String, limit: Int = 5) async throws -> [LocationSearchResult] {
        try await get("map/search", query: [
            .init(name: "q", value: query),
            .init(name: "limit", value: String(limit)),
        ])
    }

    public func reverseGeocode(_ coordinate: Coordinate) async throws -> ReverseGeocodeResult {
        try await get("map/reverse", query: [
            .init(name: "lat", value: String(coordinate.latitude)),
            .init(name: "lon", value: String(coordinate.longitude)),
        ])
    }
}

public enum StopType: String, Sendable {
    case all, bus, train, ferry
}

public enum VehicleFilterType: String, Sendable {
    case all, bus = "Bus", train = "Train", ferry = "Ferry"
}

public struct RouteSearchResult: Codable, Hashable, Sendable {
    public let name: String
    public let routeID: String

    public init(name: String, routeID: String) {
        self.name = name
        self.routeID = routeID
    }

    enum CodingKeys: String, CodingKey {
        case name
        case routeID = "route_id"
    }
}

public struct NearbyVehicle: Codable, Hashable, Sendable {
    public let distanceFromVehicle: Double
    public let routeID: String
    public let tripHeadsign: String
    public let tripID: String

    enum CodingKeys: String, CodingKey {
        case distanceFromVehicle = "distance_from_vehicle"
        case routeID = "routeId"
        case tripHeadsign = "tripHeadsign"
        case tripID = "tripId"
    }
}

/// `GET /{region}/map/nav?method=walking` - turn-by-turn walking directions
/// from OSRM. Shape per the Go handler's `GeoJSONResponse`
/// (`backend/providers/navigation.go`); confirmed against a live response
/// (2026-09-23) - `instructions` is one comma-joined string (each step's
/// own `instruction` is what's actually useful), `steps` is a real object
/// array, not `[[Double]]`.
public struct WalkingDirections: Codable, Hashable, Sendable {
    public let type: String
    public let features: [GeoJSONFeature]
    public let instructions: String
    public let steps: [DirectionStep]
    public let duration: Double
    public let distance: Double

    /// The route's line, flattened from every feature's geometry - for
    /// drawing on the map.
    public var lineCoordinates: [Coordinate] {
        features.flatMap(\.geometry.lineCoordinates)
    }
}

/// One turn-by-turn instruction - `"depart"`/`"arrive"`/`"turn"`/`"end of
/// road"`/etc for `type`, `"left"`/`"right"`/`""` for `modifier`.
public struct DirectionStep: Codable, Hashable, Sendable, Identifiable {
    public let instruction: String
    public let modifier: String
    public let type: String
    public let name: String
    public let distance: Double
    public let lat: Double
    public let lon: Double

    public var id: String { "\(lat),\(lon),\(type),\(distance)" }
    public var coordinate: Coordinate { Coordinate(latitude: lat, longitude: lon) }
}

/// Parameters for `POST /{region}/services/plan`. Mirrors the web planner's
/// `search-form.tsx` defaults.
public struct JourneyPlanRequest: Sendable {
    public enum TimeType: String, Sendable { case now, departat, arriveat }

    public var start: Coordinate
    public var end: Coordinate
    public var date: Date
    public var timeType: TimeType
    public var maxWalkKm: Double
    public var walkSpeed: Double
    public var maxTransfers: Int
    public var minResults: Int
    public var onlyRoutes: [String]
    /// Only these ways to travel; empty = any.
    public var modes: Set<TravelMode>
    /// Extra seconds at every change of vehicle (0 = the planner's usual minute).
    public var minTransferSec: Int

    public init(
        start: Coordinate,
        end: Coordinate,
        date: Date = Date(),
        timeType: TimeType = .now,
        maxWalkKm: Double = 1.0,
        walkSpeed: Double = 4.8,
        maxTransfers: Int = 5,
        minResults: Int = 3,
        onlyRoutes: [String] = [],
        modes: Set<TravelMode> = [],
        minTransferSec: Int = 0
    ) {
        self.start = start
        self.end = end
        self.date = date
        self.timeType = timeType
        self.maxWalkKm = maxWalkKm
        self.walkSpeed = walkSpeed
        self.maxTransfers = maxTransfers
        self.minResults = minResults
        self.onlyRoutes = onlyRoutes
        self.modes = modes
        self.minTransferSec = minTransferSec
    }

    var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = [
            .init(name: "startLat", value: String(start.latitude)),
            .init(name: "startLon", value: String(start.longitude)),
            .init(name: "endLat", value: String(end.latitude)),
            .init(name: "endLon", value: String(end.longitude)),
            .init(name: "date", value: ISO8601DateFormatter().string(from: date)),
            .init(name: "timeType", value: timeType.rawValue),
            .init(name: "maxWalkKm", value: String(maxWalkKm)),
            .init(name: "walkSpeed", value: String(walkSpeed)),
            .init(name: "maxTransfers", value: String(maxTransfers)),
            .init(name: "minResults", value: String(minResults)),
        ]
        if !onlyRoutes.isEmpty {
            items.append(.init(name: "onlyRoutes", value: onlyRoutes.joined(separator: ",")))
        }
        if !modes.isEmpty {
            items.append(.init(name: "modes", value: TravelMode.queryValue(modes)))
        }
        if minTransferSec > 0 {
            items.append(.init(name: "minTransferSec", value: String(minTransferSec)))
        }
        return items
    }
}
