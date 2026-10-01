import XCTest
@testable import TransitCore

final class DepartureDetectorTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_700_000_000)
    /// About 111 m per 0.001° of latitude.
    private let start = Coordinate(latitude: -36.880, longitude: 174.720)
    private let stop = Coordinate(latitude: -36.890, longitude: 174.720) // ~1.1 km south

    private func at(_ metresSouth: Double) -> Coordinate {
        Coordinate(latitude: start.latitude - metresSouth / 111_000, longitude: start.longitude)
    }

    func testAtHomeIsNotSetOff() {
        var detector = DepartureDetector()
        for i in 0..<10 {
            XCTAssertNil(detector.update(start: start, boardStop: stop, location: at(Double(i * 5)), accuracy: 10, at: base.addingTimeInterval(Double(i) * 30)))
        }
    }

    func testWalkingAwayFromTheStartSetsOffAtTheLastFixThere() {
        var detector = DepartureDetector()
        detector.update(start: start, boardStop: stop, location: at(20), accuracy: 10, at: base)
        detector.update(start: start, boardStop: stop, location: at(90), accuracy: 10, at: base.addingTimeInterval(60))
        XCTAssertNil(detector.update(start: start, boardStop: stop, location: at(130), accuracy: 10, at: base.addingTimeInterval(90)))
        let left = detector.update(start: start, boardStop: stop, location: at(200), accuracy: 10, at: base.addingTimeInterval(120))
        XCTAssertEqual(left, base.addingTimeInterval(60), "back-dated to when they were last at the start")
        // Sticks, even walking back.
        XCTAssertEqual(detector.update(start: start, boardStop: stop, location: at(0), accuracy: 10, at: base.addingTimeInterval(600)), left)
    }

    func testTrackingStartedElsewhereSetsOffOnceCloserToTheStop() {
        var detector = DepartureDetector()
        // Planned from home, but already 400 m down the road.
        XCTAssertNil(detector.update(start: start, boardStop: stop, location: at(400), accuracy: 10, at: base))
        XCTAssertNil(detector.update(start: start, boardStop: stop, location: at(500), accuracy: 10, at: base.addingTimeInterval(60)))
        XCTAssertEqual(detector.update(start: start, boardStop: stop, location: at(560), accuracy: 10, at: base.addingTimeInterval(90)), base.addingTimeInterval(90))
    }

    func testAtTheStopIsSetOff() {
        var detector = DepartureDetector()
        XCTAssertNotNil(detector.update(start: start, boardStop: stop, location: stop, accuracy: 10, at: base))
    }

    func testPoorFixesAreIgnored() {
        var detector = DepartureDetector()
        detector.update(start: start, boardStop: stop, location: at(10), accuracy: 10, at: base)
        XCTAssertNil(detector.update(start: start, boardStop: stop, location: at(400), accuracy: 500, at: base.addingTimeInterval(30)))
        XCTAssertNil(detector.update(start: start, boardStop: stop, location: nil, accuracy: nil, at: base.addingTimeInterval(60)))
    }

    func testRestoredKeepsTheTime() {
        var detector = DepartureDetector(setOffAt: base)
        XCTAssertEqual(detector.update(start: start, boardStop: stop, location: start, accuracy: 10, at: base.addingTimeInterval(60)), base)
    }
}
