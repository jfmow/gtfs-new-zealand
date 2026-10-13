import XCTest
@testable import TransitCore

final class JourneyGPSPolicyTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func canRest(
        appActive: Bool = false, offline: Bool = false, phase: JourneyProgressModel.Phase? = .onboard,
        boarded: Bool = true, level: JourneyProgressModel.TrackingLevel = .live, liveFresh: Bool = true,
        stopsAway: Int? = 8, minutesToAlight: Double? = 15
    ) -> Bool {
        JourneyGPSPolicy.canRest(
            appActive: appActive, offline: offline, phase: phase, boarded: boarded, trackingLevel: level,
            liveFresh: liveFresh, stopsAway: stopsAway,
            alightAt: minutesToAlight.map { now.addingTimeInterval($0 * 60) }, now: now
        )
    }

    func testRestsOnALiveRideFarFromTheStop() {
        XCTAssertTrue(canRest())
    }

    func testKeepsGPSOnScreen() {
        XCTAssertFalse(canRest(appActive: true))
    }

    func testKeepsGPSOffline() {
        XCTAssertFalse(canRest(offline: true))
    }

    func testKeepsGPSUntilOnBoard() {
        XCTAssertFalse(canRest(phase: .walking, boarded: false))
        XCTAssertFalse(canRest(phase: .waiting, boarded: false))
        XCTAssertFalse(canRest(phase: .boarding, boarded: false))
    }

    func testKeepsGPSWithoutAFreshLiveVehicle() {
        XCTAssertFalse(canRest(level: .estimated))
        XCTAssertFalse(canRest(level: .predicted))
        XCTAssertFalse(canRest(level: .scheduled))
        XCTAssertFalse(canRest(liveFresh: false))
        XCTAssertFalse(canRest(stopsAway: nil))
    }

    func testBackOnNearingTheStop() {
        XCTAssertTrue(canRest(stopsAway: JourneyGPSPolicy.resumeStopsAway + 1))
        XCTAssertFalse(canRest(stopsAway: JourneyGPSPolicy.resumeStopsAway))
        XCTAssertFalse(canRest(stopsAway: 0))
    }

    func testBackOnShortlyBeforeArrival() {
        // Plenty of stops left, but they're close together.
        XCTAssertFalse(canRest(stopsAway: 10, minutesToAlight: 4))
        XCTAssertFalse(canRest(minutesToAlight: nil))
    }
}

final class JourneyGPSPolicyModeTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func mode(
        appActive: Bool = false, phase: JourneyProgressModel.Phase? = .walking, boarded: Bool = false,
        level: JourneyProgressModel.TrackingLevel = .scheduled, stopsAway: Int? = nil, minutesToAlight: Double? = nil,
        waitingToSetOff: Bool = false, minutesToLeave: Double? = nil
    ) -> JourneyGPSPolicy.Mode {
        JourneyGPSPolicy.mode(
            appActive: appActive, offline: false, phase: phase, boarded: boarded, trackingLevel: level,
            liveFresh: true, stopsAway: stopsAway, alightAt: minutesToAlight.map { now.addingTimeInterval($0 * 60) },
            waitingToSetOff: waitingToSetOff, leaveAt: minutesToLeave.map { now.addingTimeInterval($0 * 60) }, now: now
        )
    }

    func testPreciseOnScreen() {
        XCTAssertEqual(mode(appActive: true), .precise)
        XCTAssertEqual(mode(appActive: true, waitingToSetOff: true, minutesToLeave: 30), .precise)
        XCTAssertEqual(mode(appActive: true, phase: .onboard, boarded: true, level: .live, stopsAway: 8, minutesToAlight: 15), .precise)
    }

    func testRestsOnALiveRide() {
        XCTAssertEqual(mode(phase: .onboard, boarded: true, level: .live, stopsAway: 8, minutesToAlight: 15), .resting)
    }

    func testPreciseOnARideItCantRestOn() {
        XCTAssertEqual(mode(phase: .onboard, boarded: true, level: .estimated, stopsAway: 8, minutesToAlight: 15), .precise)
        XCTAssertEqual(mode(phase: .onboard, boarded: true, level: .live, stopsAway: 2, minutesToAlight: 3), .precise)
        XCTAssertEqual(mode(phase: .boarding), .precise)
    }

    func testCoarseAtTheStartWellBeforeLeaving() {
        XCTAssertEqual(mode(waitingToSetOff: true, minutesToLeave: 25), .coarse)
        XCTAssertEqual(mode(waitingToSetOff: true, minutesToLeave: 10), .pedestrian)
        XCTAssertEqual(mode(waitingToSetOff: true, minutesToLeave: -2), .pedestrian)
        XCTAssertEqual(mode(waitingToSetOff: true, minutesToLeave: nil), .pedestrian)
        // Already set off - however early.
        XCTAssertEqual(mode(waitingToSetOff: false, minutesToLeave: 25), .pedestrian)
    }

    func testPedestrianWalkingOrWaiting() {
        XCTAssertEqual(mode(phase: .walking), .pedestrian)
        XCTAssertEqual(mode(phase: .waiting), .pedestrian)
    }

    func testOnlyPedestrianAndPrecisePlaceTheRider() {
        XCTAssertFalse(JourneyGPSPolicy.Mode.resting.placesRider)
        XCTAssertFalse(JourneyGPSPolicy.Mode.coarse.placesRider)
        XCTAssertTrue(JourneyGPSPolicy.Mode.pedestrian.placesRider)
        XCTAssertTrue(JourneyGPSPolicy.Mode.precise.placesRider)
    }

    private func near(_ phase: JourneyProgressModel.Phase?, stopsAway: Int? = nil, minutes: Double?) -> Bool {
        JourneyGPSPolicy.isMomentNear(phase: phase, stopsAway: stopsAway, nextMomentAt: minutes.map { now.addingTimeInterval($0 * 60) }, now: now)
    }

    func testMomentNear() {
        XCTAssertFalse(near(.walking, minutes: 20))
        XCTAssertTrue(near(.walking, minutes: 5))
        XCTAssertTrue(near(.waiting, minutes: -1))
        XCTAssertTrue(near(.boarding, minutes: 20))
        XCTAssertFalse(near(.onboard, stopsAway: 8, minutes: 15))
        XCTAssertTrue(near(.onboard, stopsAway: 3, minutes: 15))
        XCTAssertTrue(near(.onboard, stopsAway: 8, minutes: 4))
        XCTAssertTrue(near(.waiting, minutes: nil))
    }
}
