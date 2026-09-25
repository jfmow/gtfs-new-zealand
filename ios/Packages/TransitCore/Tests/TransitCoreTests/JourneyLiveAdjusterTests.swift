import XCTest
@testable import TransitCore

final class JourneyLiveAdjusterTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeStop(id: String) -> Stop {
        Stop(stopID: id, parentStation: "", stopName: id, stopCode: "1", stopHeadsign: "",
             stopLat: 0, stopLon: 0, platformNumber: "1", stopSequence: 0, isChildStop: true,
             locationType: 0, stopType: "train", wheelchairBoarding: 0)
    }

    private func makeLeg(mode: String, tripID: String, from: Stop?, to: Stop?, departure: Date, arrival: Date, durationSeconds: TimeInterval) -> JourneyLeg {
        JourneyLeg(
            mode: mode, fromStop: from, toStop: to, tripID: tripID, routeID: "R", route: nil,
            departureTime: GoTime(date: departure), arrivalTime: GoTime(date: arrival),
            duration: GoDuration(nanoseconds: Int64(durationSeconds * 1_000_000_000)), distanceKm: 0, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: nil), scheduledArrivalTime: GoTime(date: nil),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true
        )
    }

    private func makePlan(legs: [JourneyLeg]) -> JourneyPlan {
        JourneyPlan(
            id: "p1", startLat: 0, startLon: 0, endLat: 0, endLon: 0,
            departureTime: GoTime(date: legs.first?.departureTime.date),
            arrivalTime: GoTime(date: legs.last?.arrivalTime.date),
            totalDuration: GoDuration(nanoseconds: 0), transfers: 0, transferStops: nil,
            legs: legs, routeGeoJSON: nil
        )
    }

    private func stopTime(childID: String, parentID: String, arrivalMs: Int64, departureMs: Int64, scheduledMs: Int64) -> StopTimeUpdate {
        StopTimeUpdate(
            parentStopID: parentID, childStopID: childID,
            arrivalTime: GoEpochMillis(milliseconds: arrivalMs), departureTime: GoEpochMillis(milliseconds: departureMs),
            scheduledTime: GoEpochMillis(milliseconds: scheduledMs), skipped: false, passed: false, dist: 0
        )
    }

    func testReturnsUnchangedWhenNoStopTimesAvailable() {
        let leg = makeLeg(mode: "transit", tripID: "t1", from: makeStop(id: "A"), to: makeStop(id: "B"), departure: base, arrival: base.addingTimeInterval(600), durationSeconds: 600)
        let plan = makePlan(legs: [leg])
        let result = JourneyPlanLiveAdjuster.buildLiveJourney(plan, stopTimesByTripID: [:])
        XCTAssertEqual(result.departureTime.date, plan.departureTime.date)
    }

    func testShiftsTransitLegAndComputesDelay() {
        let fromStop = makeStop(id: "A")
        let toStop = makeStop(id: "B")
        let scheduledDepartMs = Int64(base.timeIntervalSince1970 * 1000)
        let scheduledArriveMs = scheduledDepartMs + 600_000

        // Vehicle is running 90s late.
        let liveDepartMs = scheduledDepartMs + 90_000
        let liveArriveMs = scheduledArriveMs + 90_000

        let leg = makeLeg(mode: "transit", tripID: "t1", from: fromStop, to: toStop, departure: base, arrival: base.addingTimeInterval(600), durationSeconds: 600)
        let plan = makePlan(legs: [leg])

        let stopTimes = [
            stopTime(childID: "A", parentID: "PA", arrivalMs: liveDepartMs, departureMs: liveDepartMs, scheduledMs: scheduledDepartMs),
            stopTime(childID: "B", parentID: "PB", arrivalMs: liveArriveMs, departureMs: liveArriveMs, scheduledMs: scheduledArriveMs),
        ]

        let result = JourneyPlanLiveAdjuster.buildLiveJourney(plan, stopTimesByTripID: ["t1": stopTimes])
        let resultLeg = result.legs[0]

        XCTAssertEqual(resultLeg.departureTime.date!.timeIntervalSince1970, Double(liveDepartMs) / 1000, accuracy: 0.001)
        XCTAssertEqual(resultLeg.arrivalTime.date!.timeIntervalSince1970, Double(liveArriveMs) / 1000, accuracy: 0.001)
        XCTAssertEqual(resultLeg.delaySeconds, 90)
        XCTAssertEqual(resultLeg.realtimeStatus, "delayed")
        XCTAssertEqual(result.departureTime.date, resultLeg.departureTime.date)
    }

    func testOnTimeAndEarlyThresholds() {
        let fromStop = makeStop(id: "A")
        let toStop = makeStop(id: "B")
        let scheduledArriveMs: Int64 = 1_700_000_600_000

        func run(delaySeconds: Int64) -> String? {
            let leg = makeLeg(mode: "transit", tripID: "t1", from: fromStop, to: toStop, departure: base, arrival: base.addingTimeInterval(600), durationSeconds: 600)
            let plan = makePlan(legs: [leg])
            let arriveMs = scheduledArriveMs + delaySeconds * 1000
            let stopTimes = [
                stopTime(childID: "A", parentID: "PA", arrivalMs: 1_700_000_000_000, departureMs: 1_700_000_000_000, scheduledMs: 1_700_000_000_000),
                stopTime(childID: "B", parentID: "PB", arrivalMs: arriveMs, departureMs: arriveMs, scheduledMs: scheduledArriveMs),
            ]
            return JourneyPlanLiveAdjuster.buildLiveJourney(plan, stopTimesByTripID: ["t1": stopTimes]).legs[0].realtimeStatus
        }

        XCTAssertEqual(run(delaySeconds: 0), "on_time")
        XCTAssertEqual(run(delaySeconds: 30), "on_time")   // within +-60s band
        XCTAssertEqual(run(delaySeconds: 61), "delayed")
        XCTAssertEqual(run(delaySeconds: -61), "early")
    }

    func testReanchorsLeadingWalkWithTwoMinuteBuffer() {
        let toStop = makeStop(id: "B")
        let walkLeg = makeLeg(mode: "walk", tripID: "", from: nil, to: nil, departure: base, arrival: base.addingTimeInterval(300), durationSeconds: 300)
        let transitLeg = makeLeg(mode: "transit", tripID: "t1", from: makeStop(id: "A"), to: toStop, departure: base.addingTimeInterval(300), arrival: base.addingTimeInterval(900), durationSeconds: 600)
        let plan = makePlan(legs: [walkLeg, transitLeg])

        // Transit leg departs 90s later than scheduled per the stop times.
        let scheduledDepartMs = Int64(base.addingTimeInterval(300).timeIntervalSince1970 * 1000)
        let liveDepartMs = scheduledDepartMs + 90_000
        let stopTimes = [
            stopTime(childID: "A", parentID: "PA", arrivalMs: liveDepartMs, departureMs: liveDepartMs, scheduledMs: scheduledDepartMs),
            stopTime(childID: "B", parentID: "PB", arrivalMs: liveDepartMs + 600_000, departureMs: liveDepartMs + 600_000, scheduledMs: scheduledDepartMs + 600_000),
        ]

        let result = JourneyPlanLiveAdjuster.buildLiveJourney(plan, stopTimesByTripID: ["t1": stopTimes])
        let resultWalk = result.legs[0]
        let resultTransit = result.legs[1]

        // Walk leg should now arrive 120s before the (shifted) transit departure.
        XCTAssertEqual(resultWalk.arrivalTime.date!.timeIntervalSince1970, resultTransit.departureTime.date!.timeIntervalSince1970 - 120, accuracy: 0.001)
        // Its own duration (300s) is preserved.
        XCTAssertEqual(resultWalk.departureTime.date!.timeIntervalSince1970, resultWalk.arrivalTime.date!.timeIntervalSince1970 - 300, accuracy: 0.001)
    }
}
