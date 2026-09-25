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
