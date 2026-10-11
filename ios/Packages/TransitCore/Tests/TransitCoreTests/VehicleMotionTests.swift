import XCTest
@testable import TransitCore

final class VehicleMotionTests: XCTestCase {
    // A straight 2 km road running east, with stops at 0, 1 km and 2 km.
    private let latitude = -36.85
    private var metresPerDegree: Double { 111_320 * cos(latitude * .pi / 180) }
    private func point(_ metres: Double, offset: Double = 0) -> Coordinate {
        Coordinate(latitude: latitude + offset / 111_320, longitude: 174.76 + metres / metresPerDegree)
    }
    private func along(_ c: Coordinate) -> Double { (c.longitude - 174.76) * metresPerDegree }

    private func motion() -> VehicleMotion {
        let line = RouteLine([point(0), point(500), point(1000), point(1500), point(2000)])!
        return VehicleMotion(line: line, stops: [point(0), point(1000), point(2000)], vehicleType: "bus")
    }

    private let t0 = Date(timeIntervalSince1970: 1_000_000)

    func testShowsTheFeedPositionWithoutRiderGPS() {
        var m = motion()
        m.feed(point(1100), at: t0)
        XCTAssertEqual(along(m.step(to: t0)!.coordinate), 1100, accuracy: 1)
        m.feed(point(1300), at: t0 + 15)
        // No guessing ahead between reports - it stays put until the next.
        for s in 15...45 {
            XCTAssertEqual(along(m.step(to: t0 + TimeInterval(s))!.coordinate), 1300, accuracy: 1)
        }
    }

    func testRiderGPSDrivesTheVehicleWhileAboard() {
        var m = motion()
        m.feed(point(1100), at: t0)
        _ = m.step(to: t0)
        m.rider(point(1120, offset: 5), speed: 12, at: t0 + 2)
        XCTAssertEqual(m.speed, 12)
        // A lagging feed position doesn't drag it back while the rider's GPS is fresh.
        m.feed(point(1105), at: t0 + 3)
        XCTAssertEqual(m.speed, 12)
        var shown = 0.0
        for s in 3...6 { shown = along(m.step(to: t0 + TimeInterval(s))!.coordinate) }
        XCTAssertEqual(shown, 1120 + 12 * 4, accuracy: 15)
    }

    func testRiderGPSStopsExtrapolatingAfterFiveSeconds() {
        var m = motion()
        m.feed(point(1100), at: t0)
        _ = m.step(to: t0)
        m.rider(point(1100), speed: 10, at: t0)
        var last = 0.0
        for s in 1...7 { last = along(m.step(to: t0 + TimeInterval(s))!.coordinate) }
        XCTAssertLessThanOrEqual(last, 1100 + 10 * 5 + 1)
    }

    func testRiderGPSNeverCarriesItPastTheNextStop() {
        var m = motion()
        m.feed(point(980), at: t0)
        _ = m.step(to: t0)
        m.rider(point(990), speed: 20, at: t0)
        var last = 0.0
        for s in 1...5 { last = along(m.step(to: t0 + TimeInterval(s))!.coordinate) }
        XCTAssertLessThanOrEqual(last, 1001)
    }

    func testFallsBackToTheFeedWhenRiderGPSGoesStale() {
        var m = motion()
        m.feed(point(1100), at: t0)
        m.rider(point(1120), speed: 10, at: t0)
        _ = m.step(to: t0 + 1)
        m.feed(point(1400), at: t0 + 20)
        XCTAssertEqual(along(m.step(to: t0 + 20)!.coordinate), 1400, accuracy: 1)
    }

    func testOffRouteShowsTheRawPosition() {
        var m = motion()
        let detour = point(600, offset: 300)
        m.feed(detour, at: t0)
        let shown = m.step(to: t0)!.coordinate
        XCTAssertEqual(shown.latitude, detour.latitude, accuracy: 1e-9)
        XCTAssertEqual(shown.longitude, detour.longitude, accuracy: 1e-9)
    }

    func testProjectionPrefersTheForwardPassOfALoop() {
        // Out 1 km east and back along the same road.
        let line = RouteLine([point(0), point(1000), point(0)])!
        let outbound = line.project(point(400), near: 300).along
        let inbound = line.project(point(400), near: 1500).along
        XCTAssertEqual(outbound, 400, accuracy: 5)
        XCTAssertEqual(inbound, 1600, accuracy: 5)
    }

    func testBearingFollowsTheShape() {
        let line = RouteLine([point(0), point(1000)])!
        XCTAssertEqual(line.bearing(at: 500), 90, accuracy: 1)
    }
}
