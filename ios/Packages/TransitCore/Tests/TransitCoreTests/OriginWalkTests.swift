import XCTest
@testable import TransitCore

final class OriginWalkTests: XCTestCase {
    private func stop(_ id: String, platform: String = "") -> Stop {
        Stop(stopID: id, parentStation: "", stopName: id, stopCode: "", stopHeadsign: "",
             stopLat: 0, stopLon: 0, platformNumber: platform, stopSequence: 0, isChildStop: true,
             locationType: 0, stopType: "bus", wheelchairBoarding: 0)
    }

    private func leg(_ mode: String, from: Stop? = nil, to: Stop?, seconds: Int64, km: Double) -> JourneyLeg {
        JourneyLeg(
            mode: mode, fromStop: from, toStop: to, tripID: mode == "walk" ? "" : "t", routeID: "", route: nil,
            departureTime: GoTime(date: nil), arrivalTime: GoTime(date: nil),
            duration: GoDuration(nanoseconds: seconds * 1_000_000_000), distanceKm: km, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: nil), scheduledArrivalTime: GoTime(date: nil),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true)
    }

    private func legs(walkKm: Double, from: Stop? = nil, to: Stop) -> [JourneyLeg] {
        [leg("walk", from: from, to: to, seconds: 30, km: walkKm), leg("transit", from: to, to: stop("B"), seconds: 600, km: 5)]
    }

    func testHidesShortWalkToBusStop() {
        XCTAssertTrue(legs(walkKm: 0.02, to: stop("A")).hidesOriginWalk)
    }

    func testKeepsRealWalk() {
        XCTAssertFalse(legs(walkKm: 0.3, to: stop("A")).hidesOriginWalk)
    }

    func testKeepsWalkToAnotherPlatform() {
        XCTAssertFalse(legs(walkKm: 0.02, from: stop("P1", platform: "1"), to: stop("P2", platform: "2")).hidesOriginWalk)
        XCTAssertFalse(legs(walkKm: 0.02, to: stop("P2", platform: "2")).hidesOriginWalk)
    }

    func testHidesWalkOnSamePlatform() {
        XCTAssertTrue(legs(walkKm: 0.01, from: stop("P2a", platform: "2"), to: stop("P2", platform: "2")).hidesOriginWalk)
    }

    func testWalkOnlyJourneyKeepsWalk() {
        XCTAssertFalse([leg("walk", to: nil, seconds: 30, km: 0.02)].hidesOriginWalk)
    }
}
