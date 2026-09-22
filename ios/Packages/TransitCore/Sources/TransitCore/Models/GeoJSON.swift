import Foundation

/// A GeoJSON geometry - only `LineString` is actually produced by this API,
/// so `coordinates` is always one array of positions. A position is usually
/// `[lon, lat]`, but `/map/geojson/shapes` adds a third element (cumulative
/// distance in km along the shape) - so this decodes `[[Double]]` rather
/// than a fixed-size pair and exposes `lineCoordinates` for the common case.
/// Confirmed against live `services/plan` and `map/geojson/shapes` responses
/// (2026-09-22).
public struct GeoJSONGeometry: Codable, Hashable, Sendable {
    public let type: String
    public let coordinates: [[Double]]

    public var lineCoordinates: [Coordinate] {
        coordinates.compactMap { position in
            guard position.count >= 2 else { return nil }
            return Coordinate(latitude: position[1], longitude: position[0])
        }
    }
}

public struct GeoJSONFeature: Codable, Hashable, Sendable {
    public let type: String
    public let geometry: GeoJSONGeometry
    /// e.g. `{"mode":"walk","distance_meters":89.5,"duration_seconds":64.4,
    /// "to_stop_id":"..."}` on a `JourneyPlan.routeGeoJSON` feature - shape
    /// varies by feature/endpoint, hence `JSONValue`.
    public let properties: [String: JSONValue]?
}

public struct GeoJSONFeatureCollection: Codable, Hashable, Sendable {
    public let type: String
    public let features: [GeoJSONFeature]
}

/// A single trip's/route's shape - `GET /{region}/map/geojson/shapes`.
public struct RouteShape: Codable, Hashable, Sendable {
    /// Hex colour with no leading '#' - often empty.
    public let color: String
    public let geojson: GeoJSONFeature
}
