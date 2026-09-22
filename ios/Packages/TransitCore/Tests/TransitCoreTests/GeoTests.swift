import XCTest
@testable import TransitCore

final class GeoTests: XCTestCase {
    func testHaversineDistanceZeroForSamePoint() {
        let point = Coordinate(latitude: -36.8485, longitude: 174.7633)
        XCTAssertEqual(Geo.haversineDistanceMeters(point, point), 0, accuracy: 0.001)
    }

    func testHaversineDistanceKnownPair() {
        // Britomart to Papatoetoe Train Station, ~16.6 km as the crow flies.
        let britomart = Coordinate(latitude: -36.8442, longitude: 174.7645)
        let papatoetoe = Coordinate(latitude: -36.97766, longitude: 174.84925)
        let distance = Geo.haversineDistanceMeters(britomart, papatoetoe)
        XCTAssertEqual(distance, 16_600, accuracy: 500)
    }
}
