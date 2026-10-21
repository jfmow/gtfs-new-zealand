import XCTest
@testable import TransitCore

/// The leave-by reminder form must match the web's `addJourneyReminder`
/// (frontend/lib/notifications.ts) field for field - the old iOS version
/// always sent timeType=arriveat and "Start"/"Destination" labels.
final class JourneyReminderRequestTests: XCTestCase {
    private let base: Date = {
        var c = DateComponents()
        c.year = 2026; c.month = 9; c.day = 24; c.hour = 8; c.minute = 0
        c.timeZone = TimeZone(identifier: "Pacific/Auckland")
        return Calendar(identifier: .gregorian).date(from: c)!
    }()

    private func stop(_ id: String, _ name: String) -> Stop {
        Stop(stopID: id, parentStation: "", stopName: name, stopCode: "1", stopHeadsign: "",
             stopLat: 0, stopLon: 0, platformNumber: "", stopSequence: 0, isChildStop: true,
             locationType: 0, stopType: "bus", wheelchairBoarding: 0)
    }

    private var plan: JourneyPlan {
        let route = Route(routeID: "70-201", agencyID: "", routeShortName: "70", routeLongName: "", routeType: 3, routeColor: "", vehicleType: "Bus")
        let walk = JourneyLeg(
            mode: "walk", fromStop: nil, toStop: stop("s1", "Britomart"), tripID: "", routeID: "", route: nil,
            departureTime: GoTime(date: base), arrivalTime: GoTime(date: base.addingTimeInterval(300)),
            duration: GoDuration(nanoseconds: 300_000_000_000), distanceKm: 0.3, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: nil), scheduledArrivalTime: GoTime(date: nil),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true)
        let ride = JourneyLeg(
            mode: "transit", fromStop: stop("s1", "Britomart"), toStop: stop("s2", "Newmarket"), tripID: "trip-70", routeID: "70-201", route: route,
            departureTime: GoTime(date: base.addingTimeInterval(480)), arrivalTime: GoTime(date: base.addingTimeInterval(1500)),
            duration: GoDuration(nanoseconds: 1_020_000_000_000), distanceKm: 4, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: base.addingTimeInterval(480)), scheduledArrivalTime: GoTime(date: base.addingTimeInterval(1500)),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true)
        return JourneyPlan(id: "plan-1", startLat: -36.84, startLon: 174.76, endLat: -36.87, endLon: 174.77,
                           departureTime: GoTime(date: base), arrivalTime: GoTime(date: base.addingTimeInterval(1500)),
                           totalDuration: GoDuration(nanoseconds: 1_500_000_000_000), transfers: 0, transferStops: nil,
                           legs: [walk, ride], routeGeoJSON: nil)
    }

    private let home = JourneyReminderRequest.Place(label: "Home St", coordinate: Coordinate(latitude: -36.84, longitude: 174.76))
    private let uni = JourneyReminderRequest.Place(label: "Uni", coordinate: Coordinate(latitude: -36.87, longitude: 174.77))

    func testFixedTripMatchesWebFields() throws {
        let request = try XCTUnwrap(JourneyReminderRequest.make(
            plan: plan, start: home, end: uni, arriveBy: false,
            maxWalkKm: 1, walkSpeed: 4.8, maxTransfers: 2, onlyRoutes: [],
            offsets: [15, 0], recurrence: "", recurrenceUntil: nil, regionSlug: "at"))
        let form = request.formFields

        XCTAssertEqual(form["kind"], "fixed_trip")
        XCTAssertEqual(form["timeType"], "departat")
        XCTAssertEqual(form["startLabel"], "Home St")
        XCTAssertEqual(form["endLabel"], "Uni")
        XCTAssertEqual(form["targetHHMM"], "08:08")
        XCTAssertEqual(form["serviceDate"], "20260924")
        XCTAssertEqual(form["boardTripId"], "trip-70")
        XCTAssertEqual(form["boardStopId"], "s1")
        XCTAssertEqual(form["routeShortName"], "70")
        XCTAssertEqual(form["boardStopName"], "Britomart")
        XCTAssertEqual(form["accessSeconds"], "480")
        XCTAssertEqual(form["offsets"], "[15,0]")
        XCTAssertEqual(form["maxWalkKm"], "1")
        XCTAssertEqual(form["walkSpeed"], "4.8")
        XCTAssertEqual(form["deeplink"], "/journey?id=plan-1&region=at")
        XCTAssertNil(form["recurrence"])
        XCTAssertNil(form["onlyRoutes"])
    }

    func testArriveByTargetsArrival() throws {
        let request = try XCTUnwrap(JourneyReminderRequest.make(
            plan: plan, start: home, end: uni, arriveBy: true,
            maxWalkKm: 1, walkSpeed: 4.8, maxTransfers: 2, onlyRoutes: [],
            offsets: [0], recurrence: "", recurrenceUntil: nil, regionSlug: nil))
        XCTAssertEqual(request.formFields["timeType"], "arriveat")
        XCTAssertEqual(request.formFields["targetHHMM"], "08:25")
    }

    func testRecurringIsJourneyRequestWithPlanDeeplink() throws {
        let request = try XCTUnwrap(JourneyReminderRequest.make(
            plan: plan, start: home, end: uni, arriveBy: false,
            maxWalkKm: 1, walkSpeed: 4.8, maxTransfers: 2, onlyRoutes: ["70-201"],
            offsets: [30, 0], recurrence: "1111100", recurrenceUntil: "2026-12-01", regionSlug: "at"))
        let form = request.formFields

        XCTAssertEqual(form["kind"], "journey_request")
        XCTAssertEqual(form["recurrence"], "1111100")
        XCTAssertEqual(form["recurrenceUntil"], "20261201")
        XCTAssertEqual(form["onlyRoutes"], #"["70-201"]"#)
        XCTAssertNil(form["boardTripId"])

        // The deeplink reopens the planner with the same search.
        guard case .plan(let prefill) = DeepLink(string: try XCTUnwrap(form["deeplink"])) else {
            return XCTFail("deeplink should parse as a planner prefill: \(form["deeplink"] ?? "")")
        }
        XCTAssertEqual(prefill.startLabel, "Home St")
        XCTAssertEqual(prefill.endLabel, "Uni")
        XCTAssertEqual(prefill.maxTransfers, 2)
        XCTAssertEqual(prefill.onlyRoutes, ["70-201"])
    }

    func testWatchForChangesSendsAlertMode() throws {
        var request = try XCTUnwrap(JourneyReminderRequest.make(
            plan: plan, start: home, end: uni, arriveBy: false,
            maxWalkKm: 1, walkSpeed: 4.8, maxTransfers: 2, onlyRoutes: [],
            offsets: [60], recurrence: "1111100", recurrenceUntil: nil, regionSlug: "at"))
        XCTAssertNil(request.formFields["alertMode"], "the default leave-by reminder sends no mode")
        request.alertMode = .changes
        XCTAssertEqual(request.formFields["alertMode"], "changes")
        XCTAssertEqual(request.formFields["offsets"], "[60]")
    }

    func testReliabilityRideKeysAndDecoding() throws {
        // The walk has no key; the ride is route|stop|scheduled departure.
        XCTAssertEqual(JourneyReliability.rideKeys(plan.legs),
                       [nil, "70-201|s1|\(Int(base.addingTimeInterval(480).timeIntervalSince1970))"])

        let json = #"{"rides":[{"samples":40,"on_time_pct":82,"early_pct":3,"late_pct":15,"typical_min":2,"cancelled_pct":10,"summary":"Usually 1–3 min late","detail":"82% on time · 1 in 10 cancelled","level":"poor"},null]}"#
        let decoded = try JSONDecoder().decode(RidesReliability.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.rides.count, 2)
        XCTAssertEqual(decoded.rides[0]?.level, .poor)
        XCTAssertEqual(decoded.rides[0]?.cancelledPct, 10)
        XCTAssertNil(decoded.rides[1])
    }

    func testChangeKeysOnlyBetweenRides() {
        // One ride: no change.
        XCTAssertTrue(JourneyReliability.changeKeys(plan.legs).isEmpty)
        // Ride arriving 8:25, walk 2 min, ride leaving 8:30: 3 min slack.
        let route = Route(routeID: "22N-201", agencyID: "", routeShortName: "22N", routeLongName: "", routeType: 3, routeColor: "", vehicleType: "Bus")
        let walk = JourneyLeg(
            mode: "walk", fromStop: stop("s2", "Newmarket"), toStop: stop("s3", "Broadway"), tripID: "", routeID: "", route: nil,
            departureTime: GoTime(date: base.addingTimeInterval(1500)), arrivalTime: GoTime(date: base.addingTimeInterval(1620)),
            duration: GoDuration(nanoseconds: 120_000_000_000), distanceKm: 0.1, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: nil), scheduledArrivalTime: GoTime(date: nil),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true)
        let second = JourneyLeg(
            mode: "transit", fromStop: stop("s3", "Broadway"), toStop: stop("s4", "Ponsonby"), tripID: "trip-22", routeID: "22N-201", route: route,
            departureTime: GoTime(date: base.addingTimeInterval(1800)), arrivalTime: GoTime(date: base.addingTimeInterval(2400)),
            duration: GoDuration(nanoseconds: 600_000_000_000), distanceKm: 3, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: base.addingTimeInterval(1800)), scheduledArrivalTime: GoTime(date: base.addingTimeInterval(2400)),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true)
        let keys = JourneyReliability.changeKeys([plan.legs[1], walk, second])
        XCTAssertEqual(keys.keys.sorted(), [2])
        XCTAssertTrue(keys[2]!.hasPrefix("70-201|s2|"), keys[2]!)
        XCTAssertTrue(keys[2]!.hasSuffix("|180"), keys[2]!)
    }

    func testNoTransitLegMeansNoReminder() {
        var walkOnly = plan
        walkOnly.legs = [plan.legs[0]]
        XCTAssertNil(JourneyReminderRequest.make(
            plan: walkOnly, start: home, end: uni, arriveBy: false, maxWalkKm: 1, walkSpeed: 4.8, maxTransfers: 2,
            onlyRoutes: [], offsets: [0], recurrence: "", recurrenceUntil: nil, regionSlug: nil))
    }

    func testWeekdayMaskLabels() {
        XCTAssertEqual(JourneyReminderMath.weekdayMaskLabel(""), "Once")
        XCTAssertEqual(JourneyReminderMath.weekdayMaskLabel("1111100"), "Weekdays")
        XCTAssertEqual(JourneyReminderMath.weekdayMaskLabel("0000011"), "Weekends")
        XCTAssertEqual(JourneyReminderMath.weekdayMaskLabel("1111111"), "Every day")
        XCTAssertEqual(JourneyReminderMath.weekdayMaskLabel("1010000"), "Mon, Wed")
    }

    func testLeaveTimeSubtractsAccessWalk() {
        XCTAssertEqual(JourneyReminderMath.leaveTime(plan), base)
    }
}
