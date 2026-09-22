import Foundation

public enum Geo {
    /// Great-circle distance in metres - `lib/utils.ts`'s `haversineDistance`.
    public static func haversineDistanceMeters(_ a: Coordinate, _ b: Coordinate) -> Double {
        let earthRadiusMeters = 6_371_000.0
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let deltaLat = (b.latitude - a.latitude) * .pi / 180
        let deltaLon = (b.longitude - a.longitude) * .pi / 180

        let sinLat = sin(deltaLat / 2)
        let sinLon = sin(deltaLon / 2)
        let h = sinLat * sinLat + cos(lat1) * cos(lat2) * sinLon * sinLon
        let c = 2 * atan2(sqrt(h), sqrt(1 - h))
        return earthRadiusMeters * c
    }
}
