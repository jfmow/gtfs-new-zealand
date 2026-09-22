import XCTest
@testable import TransitCore

/// Decodes fixtures captured directly from a local backend run of this
/// session's own Phase 1 `/devices/*` and `/notifications/*` endpoints
/// (2026-09-22) - not yet deployed to production, so these shapes were
/// verified by curl against `localhost:8090`, not the live API.
final class NotificationModelsTests: XCTestCase {
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
