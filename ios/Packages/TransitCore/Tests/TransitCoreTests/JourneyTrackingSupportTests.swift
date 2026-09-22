import XCTest
@testable import TransitCore

final class JourneyTrackingSupportTests: XCTestCase {
    // MARK: - findStopSequence

    private func makeStopRef(parentID: String, childID: String, sequence: Int) -> TripStopRef {
        TripStopRef(lat: 0, lon: 0, parentStopID: parentID, name: "n", platform: "1", sequence: sequence, childStopID: childID)
    }

    private func makeStop(stopID: String, parentStation: String) -> Stop {
        Stop(stopID: stopID, parentStation: parentStation, stopName: "s", stopCode: "1", stopHeadsign: "",
             stopLat: 0, stopLon: 0, platformNumber: "1", stopSequence: 0, isChildStop: true,
             locationType: 0, stopType: "train", wheelchairBoarding: 0)
    }

    func testFindStopSequenceMatchesByParentStationOrChildID() {
        let stops = [makeStopRef(parentID: "P1", childID: "C1", sequence: 1), makeStopRef(parentID: "P2", childID: "C2", sequence: 2)]

        let byParent = makeStop(stopID: "other", parentStation: "P2")
        XCTAssertEqual(JourneyTracking.findStopSequence(in: stops, for: byParent), 2)

        let byChild = makeStop(stopID: "C1", parentStation: "")
        XCTAssertEqual(JourneyTracking.findStopSequence(in: stops, for: byChild), 1)

        XCTAssertNil(JourneyTracking.findStopSequence(in: stops, for: nil))
    }

    // MARK: - hasDepartedStop

    private func makeVehicle(currentSeq: Int?, nextSeq: Int?, state: String?) -> Vehicle {
        let current = currentSeq.map { TripStopRef(lat: 0, lon: 0, parentStopID: "p", name: "n", platform: "1", sequence: $0, childStopID: "c") }
        let next = nextSeq.map { TripStopRef(lat: 0, lon: 0, parentStopID: "p", name: "n", platform: "1", sequence: $0, childStopID: "c") }
        let trip = VehicleTrip(firstStop: nil, nextStop: next, finalStop: nil, currentStop: current, headsign: "")
        return Vehicle(
            tripID: "t1", route: RouteSummary(id: "r", name: "r", color: "000", type: "Train"), trip: trip,
            occupancy: 0, licensePlate: "", position: VehiclePosition(lat: 0, lon: 0, bearing: 0),
            type: "train", state: state, offCourse: false
        )
    }

    func testHasDepartedStopWhenCurrentPastTarget() {
        let vehicle = makeVehicle(currentSeq: 5, nextSeq: 6, state: "Travelling")
        XCTAssertTrue(JourneyTracking.hasDepartedStop(vehicle, stopSeq: 3))
    }

    func testHasDepartedStopStillDwellingAtTarget() {
        let vehicle = makeVehicle(currentSeq: 3, nextSeq: 4, state: "AtStop")
        XCTAssertFalse(JourneyTracking.hasDepartedStop(vehicle, stopSeq: 3))
    }

    func testHasDepartedStopLeavingTargetCountsAsDeparted() {
        let vehicle = makeVehicle(currentSeq: 3, nextSeq: 4, state: "Leaving")
        XCTAssertTrue(JourneyTracking.hasDepartedStop(vehicle, stopSeq: 3))
    }

    func testHasDepartedStopUnknownStateIsConservative() {
        // Same seq/next as the "Leaving" case, but state Unknown must not
        // count as departed - conservative at ambiguous readings.
        let vehicle = makeVehicle(currentSeq: 3, nextSeq: 4, state: "Unknown")
        XCTAssertFalse(JourneyTracking.hasDepartedStop(vehicle, stopSeq: 3))
    }

    func testHasDepartedStopNoVehicleOrNoTripIsFalse() {
        XCTAssertFalse(JourneyTracking.hasDepartedStop(nil, stopSeq: 3))
    }

    // MARK: - connectionRisk

    private func makeLeg(mode: String, departure: Date?, arrival: Date?, durationSeconds: TimeInterval = 0) -> JourneyLeg {
        JourneyLeg(
            mode: mode, fromStop: nil, toStop: nil, tripID: mode == "transit" ? "t" : "", routeID: "", route: nil,
            departureTime: GoTime(date: departure), arrivalTime: GoTime(date: arrival),
            duration: GoDuration(nanoseconds: Int64(durationSeconds * 1_000_000_000)), distanceKm: 0, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: nil), scheduledArrivalTime: GoTime(date: nil),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true
        )
    }

    func testConnectionRiskNilForFirstLeg() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let legs = [makeLeg(mode: "transit", departure: base, arrival: base.addingTimeInterval(600))]
        XCTAssertNil(JourneyTracking.connectionRisk(legs, at: 0))
    }

    func testConnectionRiskComfortableSlackIsNil() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let legs = [
            makeLeg(mode: "transit", departure: base, arrival: base.addingTimeInterval(600)),
            makeLeg(mode: "walk", departure: nil, arrival: nil, durationSeconds: 60),
            // Gap from prior arrival to this departure is 600s; minus 60s walk minus 60s min-transfer = 480s slack, well over 90s.
            makeLeg(mode: "transit", departure: base.addingTimeInterval(1200), arrival: base.addingTimeInterval(1800)),
        ]
        XCTAssertNil(JourneyTracking.connectionRisk(legs, at: 2))
    }

    func testConnectionRiskTightAndMissed() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        // Tight: gap 100s, no walk, minus 60s min-transfer = 40s slack (0..<90 -> tight).
        let tightLegs = [
            makeLeg(mode: "transit", departure: base, arrival: base.addingTimeInterval(600)),
            makeLeg(mode: "transit", departure: base.addingTimeInterval(700), arrival: base.addingTimeInterval(1000)),
        ]
        let tight = JourneyTracking.connectionRisk(tightLegs, at: 1)
        XCTAssertEqual(tight?.level, .tight)

        // Missed: gap 30s, minus 60s min-transfer = negative slack.
        let missedLegs = [
            makeLeg(mode: "transit", departure: base, arrival: base.addingTimeInterval(600)),
            makeLeg(mode: "transit", departure: base.addingTimeInterval(630), arrival: base.addingTimeInterval(1000)),
        ]
        let missed = JourneyTracking.connectionRisk(missedLegs, at: 1)
        XCTAssertEqual(missed?.level, .missed)
    }
}
