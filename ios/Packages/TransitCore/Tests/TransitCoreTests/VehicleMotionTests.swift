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

    func testGlidesToEachNewPositionOverTheReportInterval() {
        var m = motion()
        m.feed(point(100), stopped: false, at: t0)
        _ = m.step(to: t0)
        m.feed(point(250), stopped: false, at: t0 + 15)
        XCTAssertEqual(m.speed, 10, accuracy: 0.5)
        // Moving steadily towards the new position, not jumping to it...
        var previous = along(m.step(to: t0 + 15)!.coordinate)
        for s in 16...29 {
            let shown = along(m.step(to: t0 + TimeInterval(s))!.coordinate)
            XCTAssertGreaterThan(shown, previous)
            XCTAssertLessThan(shown - previous, 20)
            previous = shown
        }
        // ...and there (plus a short coast) by the time the next one is due.
        XCTAssertGreaterThan(previous, 240)
        XCTAssertLessThanOrEqual(previous, 250 + 15 + 1)
    }

    func testDoesNotRunThroughALightItStoppedAt() {
        var m = motion()
        // 10 m/s, reporting every 15 s, then pulls up at a light at 1450.
        m.feed(point(1150), stopped: false, at: t0)
        _ = m.step(to: t0)
        m.feed(point(1300), stopped: false, at: t0 + 15)
        for s in 15...30 { _ = m.step(to: t0 + TimeInterval(s)) }
        m.feed(point(1450), stopped: false, at: t0 + 30)
        var furthest = 0.0
        for s in 30...90 {
            m.feed(point(1450), stopped: false, at: t0 + TimeInterval(s))
            furthest = max(furthest, along(m.step(to: t0 + TimeInterval(s))!.coordinate))
        }
        XCTAssertLessThanOrEqual(furthest, 1450 + 15 + 1)
        XCTAssertGreaterThan(furthest, 1440)
    }

    func testNeverPassesTheNextStop() {
        var m = motion()
        // Reported 10 m short of the stop at 20 m/s - the coast would overshoot.
        m.feed(point(790), stopped: false, at: t0)
        _ = m.step(to: t0)
        m.feed(point(990), stopped: false, at: t0 + 10)
        var last = 0.0
        for s in 10...60 { last = along(m.step(to: t0 + TimeInterval(s))!.coordinate) }
        XCTAssertLessThanOrEqual(last, 1001)
        XCTAssertGreaterThan(last, 990)
    }

    func testCoastsOnlyAFewMetresPastTheLastPosition() {
        var m = motion()
        m.feed(point(1100), stopped: false, at: t0)
        _ = m.step(to: t0)
        m.feed(point(1150), stopped: false, at: t0 + 10) // 5 m/s
        var last = 0.0
        for s in 10...120 { last = along(m.step(to: t0 + TimeInterval(s))!.coordinate) }
        XCTAssertLessThanOrEqual(last, 1150 + 15 + 1)
    }

    func testDoesNotReverseWhenAFixIsSlightlyBehind() {
        var m = motion()
        m.feed(point(1100), stopped: false, at: t0)
        _ = m.step(to: t0)
        m.feed(point(1300), stopped: false, at: t0 + 20)
        var shown = 0.0
        for s in 20...30 { shown = along(m.step(to: t0 + TimeInterval(s))!.coordinate) }
        // The next report says it only got to 1350 (we showed ~1400).
        m.feed(point(1350), stopped: false, at: t0 + 30)
        let after = along(m.step(to: t0 + 31)!.coordinate)
        XCTAssertGreaterThanOrEqual(after, shown - 0.5)
    }

    func testRepeatedPositionMeansStopped() {
        var m = motion()
        m.feed(point(1100), stopped: false, at: t0)
        m.feed(point(1300), stopped: false, at: t0 + 20)
        XCTAssertGreaterThan(m.speed, 0)
        m.feed(point(1300), stopped: false, at: t0 + 40)
        m.feed(point(1300), stopped: false, at: t0 + 55)
        XCTAssertEqual(m.speed, 0)
    }

    func testAtStopStateZeroesSpeed() {
        var m = motion()
        m.feed(point(1100), stopped: false, at: t0)
        m.feed(point(1300), stopped: true, at: t0 + 20)
        XCTAssertEqual(m.speed, 0)
    }

    func testOffRouteShowsTheRawPosition() {
        var m = motion()
        let detour = point(600, offset: 300)
        m.feed(detour, stopped: false, at: t0)
        let shown = m.step(to: t0)!.coordinate
        XCTAssertEqual(shown.latitude, detour.latitude, accuracy: 1e-9)
        XCTAssertEqual(shown.longitude, detour.longitude, accuracy: 1e-9)
    }

    func testRiderGPSDrivesTheVehicleWhileAboard() {
        var m = motion()
        m.feed(point(1100), stopped: false, at: t0)
        _ = m.step(to: t0)
        m.rider(point(1120, offset: 5), speed: 12, at: t0 + 2)
        XCTAssertEqual(m.speed, 12)
        // A lagging feed position doesn't drag it back while the rider's GPS is fresh.
        m.feed(point(1105), stopped: false, at: t0 + 3)
        XCTAssertEqual(m.speed, 12)
        var shown = 0.0
        for s in 3...6 { shown = along(m.step(to: t0 + TimeInterval(s))!.coordinate) }
        XCTAssertEqual(shown, 1120 + 12 * 4, accuracy: 15)
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
