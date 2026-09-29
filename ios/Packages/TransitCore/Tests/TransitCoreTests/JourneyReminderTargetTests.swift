import TransitCore
import XCTest

final class JourneyReminderTargetTests: XCTestCase {
    private func reminder(recurrence: String = "", planID: String? = nil, deeplink: String? = nil, targetUnix: Int64? = nil) throws -> JourneyReminderDTO {
        var json: [String: Any] = [
            "id": 1, "kind": recurrence.isEmpty ? "fixed_trip" : "journey_request", "status": "armed",
            "start_label": "Home", "end_label": "Work", "time_type": "arriveat", "target_hhmm": "08:30",
            "recurrence": recurrence, "service_date": "20260930",
        ]
        if let planID { json["plan_id"] = planID }
        if let deeplink { json["deeplink"] = deeplink }
        if let targetUnix { json["target_unix"] = targetUnix }
        return try JSONDecoder().decode(JourneyReminderDTO.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private let planLink = "/plan?startLat=-36.84&startLon=174.76&startLabel=Home&endLat=-36.87&endLon=174.77&endLabel=Work&timeType=arriveat"

    func testOneOffOpensItsJourney() throws {
        let r = try reminder(planID: "abc", deeplink: "/journey?id=abc&region=at")
        XCTAssertEqual(r.target, .journey(planID: "abc"))
        XCTAssertFalse(r.isRepeating)
    }

    func testRepeatPlannedForTheDayOpensThatJourney() throws {
        let r = try reminder(recurrence: "1111100", planID: "today-plan", deeplink: planLink)
        XCTAssertEqual(r.target, .journey(planID: "today-plan"))
        XCTAssertTrue(r.isRepeating)
    }

    func testRepeatNotYetPlannedOpensThePlannerForItsNextOccurrence() throws {
        let next = Date().addingTimeInterval(86_400).timeIntervalSince1970.rounded(.down)
        let r = try reminder(recurrence: "1111100", planID: "", deeplink: planLink, targetUnix: Int64(next))
        guard case .planner(let prefill)? = r.target else { return XCTFail("expected the planner") }
        XCTAssertEqual(prefill.startLabel, "Home")
        XCTAssertEqual(prefill.timeType, "arriveat")
        XCTAssertEqual(prefill.date, Date(timeIntervalSince1970: next))
    }

    func testPastOccurrencePlansForNow() throws {
        let r = try reminder(recurrence: "1111111", deeplink: planLink, targetUnix: 1_000)
        guard case .planner(let prefill)? = r.target else { return XCTFail("expected the planner") }
        XCTAssertNil(prefill.date)
    }

    func testOldServerWithoutLinksHasNoTarget() throws {
        XCTAssertNil(try reminder(recurrence: "1111100").target)
    }

    func testPlanLinkDateParam() {
        guard case .plan(let prefill)? = DeepLink(string: planLink + "&date=2026-09-30T08:30:00Z") else { return XCTFail() }
        XCTAssertEqual(prefill.date, ISO8601DateFormatter().date(from: "2026-09-30T08:30:00Z"))
    }

    func testRelativeDay() {
        let cal = Calendar(identifier: .gregorian)
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        XCTAssertEqual(JourneyReminderMath.relativeDay(now.addingTimeInterval(60), now: now, calendar: cal), "today")
        XCTAssertEqual(JourneyReminderMath.relativeDay(cal.date(byAdding: .day, value: 1, to: now)!, now: now, calendar: cal), "tomorrow")
        XCTAssertNotEqual(JourneyReminderMath.relativeDay(cal.date(byAdding: .day, value: 3, to: now)!, now: now, calendar: cal), "tomorrow")
    }
}
