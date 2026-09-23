import XCTest
@testable import TransitCore

/// Decodes fixtures captured directly from a local backend run of this
/// session's own Phase 1 `/devices/*` and `/notifications/*` endpoints
/// (2026-09-22) - not yet deployed to production, so these shapes were
/// verified by curl against `localhost:8090`, not the live API.
final class NotificationModelsTests: XCTestCase {
    func testDecodesPushTestResult() throws {
        let json = #"{"platform":"ios","hasToken":false,"env":"sandbox","sent":false,"error":"client has no apns token"}"#
        let result = try JSONDecoder().decode(PushTestResult.self, from: Data(json.utf8))
        XCTAssertEqual(result, PushTestResult(platform: "ios", hasToken: false, env: "sandbox", sent: false, error: "client has no apns token"))
    }

    func testDecodesEmptySubscriptions() throws {
        let json = #"{"stops":null,"routes":null,"recent_notifications":[]}"#
        let decoded = try JSONDecoder().decode(MySubscriptions.self, from: Data(json.utf8))
        XCTAssertNil(decoded.stops)
        XCTAssertNil(decoded.routes)
        XCTAssertEqual(decoded.recentNotifications?.count, 0)
    }

    func testDecodesPopulatedStopSubscription() throws {
        let json = #"""
        {"stops":[{"parent_stop_id":"100-56c57897","routes":null,"causes":null,"min_severity":"","notify_cancellations":true}],"routes":null,"recent_notifications":[]}
        """#
        let decoded = try JSONDecoder().decode(MySubscriptions.self, from: Data(json.utf8))
        let stop = try XCTUnwrap(decoded.stops?.first)
        XCTAssertEqual(stop.parentStopID, "100-56c57897")
        XCTAssertNil(stop.routes)
        XCTAssertEqual(stop.minSeverity, "")
        XCTAssertTrue(stop.notifyCancellations)
    }

    func testDecodesDeviceRegistrationResult() throws {
        let json = #"{"id":7}"#
        let decoded = try JSONDecoder().decode(DeviceRegistrationResult.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.id, 7)
    }
}

final class SubscriptionPickerTests: XCTestCase {
    func testCauseGroupsRoundTrip() {
        let causes = AlertCauseGroup.causes(for: [.weather, .plannedWorks])
        XCTAssertEqual(Set(causes), ["WEATHER", "MAINTENANCE", "CONSTRUCTION", "HOLIDAY"])
        XCTAssertEqual(AlertCauseGroup.groups(for: causes), [.weather, .plannedWorks])
    }

    func testPartialGroupIsOff() {
        // Only some of a group's causes selected -> that group reads off.
        XCTAssertEqual(AlertCauseGroup.groups(for: ["ACCIDENT", "WEATHER"]), [.weather])
    }

    func testSubscriptionDetailMatchesWeb() {
        XCTAssertEqual(SubscriptionDetail.text(causes: nil, minSeverity: "", notifyCancellations: true), "All alert types")
        XCTAssertEqual(
            SubscriptionDetail.text(causes: ["WEATHER"], minSeverity: "WARNING", notifyCancellations: false, extra: "70, NX1"),
            "70, NX1 · 1 alert type · warning+ · no cancellations")
        // Causes that don't complete any group.
        XCTAssertEqual(SubscriptionDetail.text(causes: ["ACCIDENT"], minSeverity: "", notifyCancellations: true), "Custom alert types")
    }

    func testDecodesFindClientShape() throws {
        let json = #"{"Id":3,"Platform":"ios","Routes":["70-201"],"Causes":null,"MinSeverity":"SEVERE","NotifyCancellations":false}"#
        let state = try JSONDecoder().decode(StopSubscriptionState.self, from: Data(json.utf8))
        XCTAssertEqual(state.routes, ["70-201"])
        XCTAssertNil(state.causes)
        XCTAssertEqual(state.minSeverity, "SEVERE")
        XCTAssertFalse(state.notifyCancellations)
    }
}
