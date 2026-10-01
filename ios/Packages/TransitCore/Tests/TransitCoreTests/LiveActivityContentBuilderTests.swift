import XCTest
@testable import TransitCore

/// Mirrors backend/providers/notifications/live_activity_test.go - same plan
/// shape, same expected wording - so the on-device and server builders stay
/// in step. If one of these changes, change the Go test too.
final class LiveActivityContentBuilderTests: XCTestCase {
    /// 9:00am in Auckland.
    private let base: Date = {
        var c = DateComponents()
        c.year = 2026; c.month = 1; c.day = 1; c.hour = 9
        c.timeZone = TimeZone(identifier: "Pacific/Auckland")
        return Calendar(identifier: .gregorian).date(from: c)!
    }()

    private func stop(_ id: String, _ name: String, platform: String = "") -> Stop {
        Stop(stopID: id, parentStation: "", stopName: name, stopCode: "1", stopHeadsign: "",
             stopLat: 0, stopLon: 0, platformNumber: platform, stopSequence: 0, isChildStop: true,
             locationType: 0, stopType: "bus", wheelchairBoarding: 0)
    }

    private func route(_ name: String, _ color: String) -> Route {
        Route(routeID: name, agencyID: "", routeShortName: name, routeLongName: "", routeType: 3, routeColor: color, vehicleType: "Bus")
    }

    private func leg(_ mode: String, route: Route? = nil, from: Stop? = nil, to: Stop?, dep: TimeInterval, arr: TimeInterval, delay: Int? = nil, usable: Bool = true) -> JourneyLeg {
        JourneyLeg(
            mode: mode, fromStop: from, toStop: to, tripID: route == nil ? "" : "trip-\(route!.routeShortName)", routeID: route?.routeID ?? "", route: route,
            departureTime: GoTime(date: base.addingTimeInterval(dep)), arrivalTime: GoTime(date: base.addingTimeInterval(arr)),
            duration: GoDuration(nanoseconds: Int64((arr - dep) * 1_000_000_000)), distanceKm: 0, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: nil), scheduledArrivalTime: GoTime(date: nil),
            realtimeStatus: nil, delaySeconds: delay, tripUsable: usable
        )
    }

    /// Walk 5 min to Britomart, ride the 70 9:08-9:25, walk 5 min.
    private func testLegs(delay: Int? = nil) -> [JourneyLeg] {
        let shift = TimeInterval(delay ?? 0)
        return [
            leg("walk", to: stop("walk-end", "Britomart"), dep: 0 + shift, arr: 300 + shift),
            leg("transit", route: route("70", "0073bd"), from: stop("board", "Britomart", platform: "3"), to: stop("alight", "Newmarket"),
                dep: 480 + shift, arr: 1500 + shift, delay: delay),
            leg("walk", to: stop("dest", "Destination"), dep: 1500 + shift, arr: 1800 + shift),
        ]
    }

    private func progress(_ leg: Int, _ phase: String?, stopsAway: Int? = nil) -> LiveActivityProgress {
        LiveActivityProgress(legIndex: leg, phase: phase, arrived: false, stopsAway: stopsAway)
    }

    func testBeforeLeavingCountsDownToLeaveBy() {
        let c = LiveActivityContentBuilder.build(legs: testLegs(), progress: progress(0, "walking"), now: base.addingTimeInterval(-600))
        XCTAssertEqual(c.primaryText, "Leave by 9:00am")
        XCTAssertEqual(c.countdownLabel, "Leave in")
        XCTAssertEqual(c.targetUnix, base.timeIntervalSince1970)
        XCTAssertEqual(c.routeShortName, "70")
        XCTAssertNil(c.urgent)
    }

    /// A late ride moves the leave-by time, rounded down to the minute, and
    /// the card says why. Mirrors TestActivity_LateRideMovesLeaveByAndSaysWhy.
    func testLateRideMovesLeaveByAndSaysWhy() {
        let c = LiveActivityContentBuilder.build(legs: testLegs(delay: 150), progress: progress(0, "walking"), now: base.addingTimeInterval(-600))
        XCTAssertEqual(c.primaryText, "Leave by 9:02am")
        XCTAssertEqual(c.targetUnix, base.addingTimeInterval(120).timeIntervalSince1970)
        XCTAssertEqual(c.secondaryText, "Walk to Britomart for the 70 · running 3 min late")
    }

    func testGetReadyInTheLastFiveMinutes() {
        let c = LiveActivityContentBuilder.build(legs: testLegs(), progress: progress(0, "walking"), now: base.addingTimeInterval(-240))
        XCTAssertEqual(c.primaryText, "Get ready to leave")
        XCTAssertEqual(c.secondaryText, "Leave by 9:00am · walk to Britomart for the 70")
        XCTAssertEqual(c.countdownLabel, "Leave in")
        XCTAssertEqual(c.urgent, true)
    }

    func testAfterLeaveByCountsDownToDeparture() {
        let c = LiveActivityContentBuilder.build(legs: testLegs(), progress: progress(0, "walking"), now: base.addingTimeInterval(10))
        XCTAssertEqual(c.primaryText, "Leave now")
        XCTAssertEqual(c.secondaryText, "Walk to Britomart · 70 departs 9:08am · Platform 3")
        XCTAssertEqual(c.countdownLabel, "Departs in")
        XCTAssertEqual(c.targetUnix, base.addingTimeInterval(480).timeIntervalSince1970)
        XCTAssertEqual(c.urgent, true)

        // Past the leave-now window it's a plain walk.
        let later = LiveActivityContentBuilder.build(legs: testLegs(), progress: progress(0, "walking"), now: base.addingTimeInterval(200))
        XCTAssertEqual(later.primaryText, "Walk to Britomart")
        XCTAssertEqual(later.secondaryText, "70 departs 9:08am · Platform 3")
        XCTAssertNil(later.urgent)
    }

    /// The old on-device builder targeted the leg's arrival while waiting.
    func testWaitingCountsDownToDeparture() {
        let c = LiveActivityContentBuilder.build(legs: testLegs(), progress: progress(1, "waiting"), now: base.addingTimeInterval(360))
        XCTAssertEqual(c.phase, "waiting")
        XCTAssertEqual(c.primaryText, "Board the 70")
        XCTAssertEqual(c.targetUnix, base.addingTimeInterval(480).timeIntervalSince1970)
        XCTAssertEqual(c.platform, "3")
    }

    func testDelayedRideReportsDelay() {
        let c = LiveActivityContentBuilder.build(legs: testLegs(delay: 300), progress: progress(1, "waiting"), now: base.addingTimeInterval(360))
        XCTAssertEqual(c.status, "delayed")
        XCTAssertEqual(c.delayMinutes, 5)
        XCTAssertEqual(c.targetUnix, base.addingTimeInterval(780).timeIntervalSince1970)
    }

    func testApproachingShowsStopsAway() {
        let c = LiveActivityContentBuilder.build(legs: testLegs(), progress: progress(1, "waiting", stopsAway: 2), now: base.addingTimeInterval(360))
        XCTAssertEqual(c.stopsAway, 2)
        XCTAssertEqual(c.secondaryText, "at Britomart · Platform 3 · 2 stops away")
    }

    func testGetOffNextStop() {
        let c = LiveActivityContentBuilder.build(legs: testLegs(), progress: progress(1, "onboard", stopsAway: 0), now: base.addingTimeInterval(1200))
        XCTAssertEqual(c.primaryText, "Get off at the next stop")
        XCTAssertEqual(c.secondaryText, "Newmarket")
        XCTAssertEqual(c.countdownLabel, "Arrives in")
    }

    /// Mirrors TestActivity_V3RideFields.
    func testV3RideFields() {
        let p = LiveActivityProgress(legIndex: 1, phase: "onboard", arrived: false, stopsAway: 3, nextStopName: "Grafton",
                                     isRealtime: true, hasVehicle: true, rideStops: 9, occupancy: 1)
        let c = LiveActivityContentBuilder.build(legs: testLegs(), progress: p, now: base.addingTimeInterval(900))
        XCTAssertEqual(c.version, 3)
        XCTAssertEqual(c.boardStopName, "Britomart")
        XCTAssertEqual(c.alightStopName, "Newmarket")
        XCTAssertEqual(c.nextStopName, "Grafton")
        XCTAssertEqual(c.rideStops, 9)
        XCTAssertEqual(c.hasVehicle, true)
        XCTAssertEqual(c.occupancy, 1)
    }

    /// Mirrors TestActivity_WalkingShowsWalkAndApproachingVehicle.
    func testWalkingShowsWalkAndApproachingVehicle() {
        let p = LiveActivityProgress(legIndex: 0, phase: "walking", arrived: false, stopsAway: 5, isRealtime: true, hasVehicle: true)
        let c = LiveActivityContentBuilder.build(legs: testLegs(), progress: p, now: base.addingTimeInterval(60))
        XCTAssertEqual(c.phase, "walking")
        XCTAssertEqual(c.walkMinutes, 5)
        XCTAssertEqual(c.stopsAway, 5)
        XCTAssertEqual(c.boardStopName, "Britomart")
    }

    func testArrived() {
        let c = LiveActivityContentBuilder.build(legs: testLegs(), progress: LiveActivityProgress(legIndex: 3, phase: nil, arrived: true), now: base.addingTimeInterval(1900))
        XCTAssertEqual(c.status, "arrived")
        XCTAssertEqual(c.primaryText, "You've arrived")
        XCTAssertEqual(c.progressFraction, 1)
    }

    func testMissedConnection() {
        // Ride A 4 min late: arrives 9:14, 2 min walk, B leaves 9:14.
        let legs = [
            leg("transit", route: route("A", "111111"), from: stop("s1", "One"), to: stop("s2", "Two"), dep: 240, arr: 840, delay: 240),
            leg("walk", to: stop("s3", "Three"), dep: 840, arr: 960),
            leg("transit", route: route("B", "222222"), from: stop("s3", "Three"), to: stop("s4", "Four"), dep: 840, arr: 1800),
        ]
        let c = LiveActivityContentBuilder.build(legs: legs, progress: progress(0, "onboard"), now: base.addingTimeInterval(480))
        XCTAssertEqual(c.status, "missedConnection")
        XCTAssertEqual(c.nextLeg?.routeShortName, "B")
        XCTAssertEqual(c.nextLeg?.connectMinutes, -2)
    }

    func testCancelledLeg() {
        var legs = testLegs()
        legs[1] = leg("transit", route: route("70", "0073bd"), from: stop("board", "Britomart"), to: stop("alight", "Newmarket"), dep: 480, arr: 1500, usable: false)
        let c = LiveActivityContentBuilder.build(legs: legs, progress: progress(1, "waiting"), now: base.addingTimeInterval(360))
        XCTAssertEqual(c.status, "cancelled")
    }

    /// Same key set the Go test checks - the widget decodes both.
    func testJSONKeysMatchServerContract() throws {
        let c = LiveActivityContentBuilder.build(legs: testLegs(), progress: progress(1, "waiting"), now: base.addingTimeInterval(360))
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(c)) as? [String: Any]
        for key in ["version", "legIndex", "phase", "primaryText", "secondaryText", "countdownLabel", "targetUnix", "arrivalUnix", "status", "legChain", "updatedUnix"] {
            XCTAssertNotNil(object?[key], "missing \(key)")
        }
        XCTAssertEqual((object?["legChain"] as? [Any])?.count, 3)
    }

    /// A payload in the Go builder's exact output shape decodes.
    func testDecodesServerPayload() throws {
        let json = #"{"version":2,"legIndex":1,"phase":"waiting","routeShortName":"70","routeColorHex":"0073bd","headsign":"Newmarket","primaryText":"Board the 70","secondaryText":"at Britomart · Platform 3","countdownLabel":"Departs in","targetUnix":1767211680,"delayMinutes":0,"status":"onTime","arrivalUnix":1767213000,"progressFraction":0.33,"totalLegs":3,"platform":"3","legChain":[{"mode":"walk","shortName":"","colorHex":""},{"mode":"transit","shortName":"70","colorHex":"0073bd"},{"mode":"walk","shortName":"","colorHex":""}],"updatedUnix":1767211560,"isRealtime":true}"#
        let c = try JSONDecoder().decode(LiveActivityContent.self, from: Data(json.utf8))
        XCTAssertEqual(c.primaryText, "Board the 70")
        XCTAssertNil(c.stopsAway)
        XCTAssertNil(c.nextLeg)
        XCTAssertTrue(c.isRealtime)
    }

    // MARK: - Setting off (mirrors left_journey_test.go)

    /// testLegs with the first walk running from `left` - what
    /// JourneyPlanLiveAdjuster does with `setOffAt`.
    private func legs(leftAt left: TimeInterval, delay: Int? = nil) -> [JourneyLeg] {
        var legs = testLegs(delay: delay)
        legs[0].departureTime = GoTime(date: base.addingTimeInterval(left))
        legs[0].arrivalTime = GoTime(date: base.addingTimeInterval(left + 300))
        return legs
    }

    private func onTheWay(_ left: TimeInterval) -> LiveActivityProgress {
        LiveActivityProgress(legIndex: 0, phase: "walking", arrived: false, setOffAt: base.addingTimeInterval(left))
    }

    private var atStart: LiveActivityProgress {
        LiveActivityProgress(legIndex: 0, phase: "walking", arrived: false, stillAtStart: true)
    }

    func testOnTheWayShowsSpareTimeNotALeaveTime() {
        let c = LiveActivityContentBuilder.build(legs: legs(leftAt: -120), progress: onTheWay(-120), now: base.addingTimeInterval(60))
        XCTAssertEqual(c.primaryText, "Walk to Britomart")
        XCTAssertEqual(c.secondaryText, "70 departs 9:08am · Platform 3 · 5 min spare")
        XCTAssertNil(c.urgent)
        XCTAssertEqual(c.segmentStartUnix, base.addingTimeInterval(-120).timeIntervalSince1970)
    }

    func testOnTheWayRideRunningEarly() {
        // Left 9:00, at the stop 9:05; the 70 now leaves 9:02.
        let c = LiveActivityContentBuilder.build(legs: legs(leftAt: 0, delay: -360), progress: onTheWay(0), now: base.addingTimeInterval(60))
        XCTAssertEqual(c.status, "missedConnection")
        XCTAssertEqual(c.secondaryText, "You'll likely miss the 70 at 9:02am")
        XCTAssertFalse(c.primaryText.contains("Leave"))
    }

    func testStillAtStartKeepsLeaveNowWhileCatchable() {
        let held = LiveActivityContentBuilder.build(legs: testLegs(), progress: atStart, now: base.addingTimeInterval(180))
        XCTAssertEqual(held.primaryText, "Leave now")
        XCTAssertEqual(held.urgent, true)
        let unknown = LiveActivityContentBuilder.build(legs: testLegs(), progress: progress(0, "walking"), now: base.addingTimeInterval(190))
        XCTAssertEqual(unknown.primaryText, "Walk to Britomart")
    }

    func testStillAtStartRideGoneEarlySaysTooLate() {
        // Running 5 min early: the 70 leaves 9:03, 5 min walk away, 8:59:30 now.
        let c = LiveActivityContentBuilder.build(legs: testLegs(delay: -300), progress: atStart, now: base.addingTimeInterval(-30))
        XCTAssertEqual(c.primaryText, "Too late for the 70")
        XCTAssertEqual(c.secondaryText, "It departs 9:03am · running 5 min early · 5 min walk away")
        XCTAssertEqual(c.status, "missedConnection")
        XCTAssertNil(c.urgent)
    }
}
