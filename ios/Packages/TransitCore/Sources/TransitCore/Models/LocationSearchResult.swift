import Foundation

/// One match from `GET /{region}/map/search` (a Nominatim-backed place/stop
/// autocomplete, used by the journey planner's from/to fields - not the same
/// endpoint as `StopSearchResult`, which is stops-only). Field names/shape
/// confirmed against a live response (2026-09-22); `boundingBox` was always
/// null in samples so its element order/units are unconfirmed - treat it as
/// opaque until a non-null example is seen.
public struct LocationSearchResult: Codable, Hashable, Sendable, Identifiable {
    public let id: Int64
    public let label: String
    public let lat: Double
    public let lon: Double
    public let type: String
    public let importance: Double
    public let boundingBox: [Double]?

    public var coordinate: Coordinate { Coordinate(latitude: lat, longitude: lon) }

    enum CodingKeys: String, CodingKey {
        case id, label, lat, lon, type, importance
        case boundingBox = "boundingBox"
    }
}

/// `GET /{region}/map/reverse` - a human-readable label for a coordinate.
public struct ReverseGeocodeResult: Codable, Hashable, Sendable {
    public let name: String
}
