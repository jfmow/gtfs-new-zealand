import XCTest
@testable import TransitCore

final class JourneyPlanRankingTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_000_000)

    private func makePlan(id: String, departureOffset: TimeInterval, arrivalOffset: TimeInterval, transfers: Int, walkKm: Double) -> JourneyPlan {
        let walkLeg = JourneyLeg(
            mode: "walk", fromStop: nil, toStop: nil, tripID: "", routeID: "", route: nil,
            departureTime: GoTime(date: base), arrivalTime: GoTime(date: base),
            duration: GoDuration(nanoseconds: 0), distanceKm: walkKm, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: nil), scheduledArrivalTime: GoTime(date: nil),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true
        )
        return JourneyPlan(
            id: id, startLat: 0, startLon: 0, endLat: 0, endLon: 0,
            departureTime: GoTime(date: base.addingTimeInterval(departureOffset)),
            arrivalTime: GoTime(date: base.addingTimeInterval(arrivalOffset)),
            totalDuration: GoDuration(nanoseconds: 0), transfers: transfers, transferStops: nil,
            legs: [walkLeg], routeGeoJSON: nil
        )
    }

    func testKeepsAllWhenNoneDominates() {
        // Faster-but-more-transfers vs slower-but-direct: neither dominates.
        let fast = makePlan(id: "fast", departureOffset: 0, arrivalOffset: 1000, transfers: 2, walkKm: 0.2)
        let direct = makePlan(id: "direct", departureOffset: 0, arrivalOffset: 1500, transfers: 0, walkKm: 0.2)
        let result = JourneyPlanRanking.pruneDominatedPlans([fast, direct]).map(\.id)
        XCTAssertEqual(Set(result), ["fast", "direct"])
    }

    func testDropsStrictlyWorsePlan() {
        // "slow" departs no earlier, arrives later, same transfers/walk as
        // "fast" - strictly worse on arrival, so it's dominated.
        let fast = makePlan(id: "fast", departureOffset: 0, arrivalOffset: 1000, transfers: 1, walkKm: 0.5)
        let slow = makePlan(id: "slow", departureOffset: 0, arrivalOffset: 2000, transfers: 1, walkKm: 0.5)
        let result = JourneyPlanRanking.pruneDominatedPlans([fast, slow]).map(\.id)
        XCTAssertEqual(result, ["fast"])
    }

    func testFullTieKeepsOnlyTheEarlierListedPlan() {
        let a = makePlan(id: "a", departureOffset: 0, arrivalOffset: 1000, transfers: 1, walkKm: 0.5)
        let b = makePlan(id: "b", departureOffset: 0, arrivalOffset: 1000, transfers: 1, walkKm: 0.5)
        let result = JourneyPlanRanking.pruneDominatedPlans([a, b]).map(\.id)
        XCTAssertEqual(result, ["a"])
    }

    func testFewerThanTwoPlansIsUnchanged() {
        let only = makePlan(id: "only", departureOffset: 0, arrivalOffset: 1000, transfers: 0, walkKm: 0)
        XCTAssertEqual(JourneyPlanRanking.pruneDominatedPlans([only]).map(\.id), ["only"])
        XCTAssertEqual(JourneyPlanRanking.pruneDominatedPlans([]).map(\.id), [])
    }
}
