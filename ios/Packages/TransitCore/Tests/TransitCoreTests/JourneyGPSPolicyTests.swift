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
