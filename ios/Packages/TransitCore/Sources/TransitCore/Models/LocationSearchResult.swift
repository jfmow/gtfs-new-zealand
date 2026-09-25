import Foundation

/// One match from `GET /{region}/map/search` (a Nominatim-backed place/stop
/// autocomplete, used by the journey planner's from/to fields - not the same
/// endpoint as `StopSearchResult`, which is stops-only). Field names/shape
/// confirmed against a live response (2026-09-22).
///
/// FIXED BUG (found 2026-09-22, root cause of "address search doesn't work"
/// in the planner): `boundingBox` was previously typed `[Double]?`, but
/// Nominatim actually sends it as an array of numeric *strings* (e.g.
/// `["-36.8729445","-36.8714952","174.7746452","174.7769123"]`) - confirmed
/// against a live `map/search?q=Westfield Newmarket` response. `JSONDecoder`
/// doesn't coerce string->Double, so any result with a populated bounding
/// box (i.e. any real address/POI match, as opposed to the rarer case where
/// it's absent) failed to decode; since this is decoded as part of an array
/// of results, that one bad element failed the *whole* array, and
/// `LocationField`'s `try? ... ?? []` swallowed the error into a silent
/// empty result list - so typing an address never showed anything, with no
/// visible error anywhere. `[String]?` matches the wire format.
public struct LocationSearchResult: Codable, Hashable, Sendable, Identifiable {
    public let id: Int64
    public let label: String
    public let lat: Double
    public let lon: Double
    public let type: String
    public let importance: Double
    public let boundingBox: [String]?

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
