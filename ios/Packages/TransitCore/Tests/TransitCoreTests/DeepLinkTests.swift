import XCTest
@testable import TransitCore

final class DeepLinkTests: XCTestCase {
    func testParsesJourneyLinkFromCustomScheme() throws {
        let url = try XCTUnwrap(URL(string: "transit://journey?id=abc-123&region=wel"))
        XCTAssertEqual(DeepLink(url: url), .journey(id: "abc-123", region: "wel"))
    }

    func testParsesTripLinkFromCustomScheme() throws {
        let url = try XCTUnwrap(URL(string: "transit://trip?tripId=257-870006&region=at"))
        XCTAssertEqual(DeepLink(url: url), .trip(tripID: "257-870006", region: "at"))
    }

    func testRegionIsOptional() throws {
        let url = try XCTUnwrap(URL(string: "transit://journey?id=abc-123"))
        XCTAssertEqual(DeepLink(url: url), .journey(id: "abc-123", region: nil))
    }

    func testParsesFromUniversalLinkShapeToo() throws {
        let url = try XCTUnwrap(URL(string: "https://example.com/journey?id=abc-123&region=at"))
        XCTAssertEqual(DeepLink(url: url), .journey(id: "abc-123", region: "at"))
    }

    func testMissingRequiredParamFails() throws {
        let url = try XCTUnwrap(URL(string: "transit://journey?region=at"))
        XCTAssertNil(DeepLink(url: url))
    }

    // MARK: - Push payload paths (what the backend actually sends)

    func testStopBoardPathWithRawSpaces() {
        XCTAssertEqual(DeepLink(string: "/?s=Britomart 11814"), .stop(query: "Britomart 11814"))
    }

    func testVehiclesPathIsATrip() {
        XCTAssertEqual(DeepLink(string: "/vehicles?tripId=257-870006"), .trip(tripID: "257-870006", region: nil))
    }

    func testStopAlertsPath() {
        XCTAssertEqual(DeepLink(string: "/alerts?s=Newmarket Train Station 9218"), .stopAlerts(query: "Newmarket Train Station 9218"))
    }

    func testRouteAlertsPathKeepsCase() {
        XCTAssertEqual(DeepLink(string: "/alerts/route/STH-201"), .routeAlerts(routeID: "STH-201"))
    }

    func testJourneyPathWithRegion() {
        XCTAssertEqual(DeepLink(string: "/journey?id=abc&region=wel"), .journey(id: "abc", region: "wel"))
    }

    func testNotificationsAndSettingsPaths() {
        XCTAssertEqual(DeepLink(string: "/notifications"), .notifications)
        XCTAssertEqual(DeepLink(string: "/settings"), .notifications)
    }

    func testPlanPrefillFromRecurringReminderLink() throws {
        let link = DeepLink(string: "/plan?startLat=-36.84&startLon=174.76&startLabel=Home%20St&endLat=-36.87&endLon=174.77&endLabel=Uni&maxWalkKm=1&walkSpeed=4.8&maxTransfers=2&timeType=arriveat&onlyRoutes=STH-201,EAST-201")
        guard case .plan(let prefill) = link else { return XCTFail("expected .plan, got \(String(describing: link))") }
        XCTAssertEqual(prefill.startLabel, "Home St")
        XCTAssertEqual(prefill.endLabel, "Uni")
        XCTAssertEqual(prefill.maxTransfers, 2)
        XCTAssertEqual(prefill.walkSpeed, 4.8)
        XCTAssertEqual(prefill.timeType, "arriveat")
        XCTAssertEqual(prefill.onlyRoutes, ["STH-201", "EAST-201"])
    }

    func testPlanWithoutCoordinatesFails() {
        XCTAssertNil(DeepLink(string: "/plan?startLabel=Home"))
    }

    func testUnknownRouteFails() throws {
        let url = try XCTUnwrap(URL(string: "transit://nonsense?id=abc"))
        XCTAssertNil(DeepLink(url: url))
    }
}
