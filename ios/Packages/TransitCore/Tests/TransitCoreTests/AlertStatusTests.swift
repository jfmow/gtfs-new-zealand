import XCTest
@testable import TransitCore

final class AlertStatusTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func makeAlert(start: Int, end: Int) -> TransitAlert {
        TransitAlert(routeID: nil, startDate: start, endDate: end, cause: "CONSTRUCTION", effect: "DETOUR", title: "t", description: "d", severity: "WARNING")
    }

    func testActiveWhenNowIsBetweenStartAndEnd() {
        let alert = makeAlert(start: Int(now.timeIntervalSince1970) - 100, end: Int(now.timeIntervalSince1970) + 100)
        XCTAssertEqual(AlertStatusCalculator.status(for: alert, now: now).label, "Active")
    }

    func testActiveWithNoEndDateAssumesOneDayWindowFromNow() {
        let nowUnix = Int(now.timeIntervalSince1970)
        let alert = makeAlert(start: nowUnix - 100, end: 0)
        XCTAssertEqual(AlertStatusCalculator.status(for: alert, now: now).label, "Active")

        // A faithful quirk of the ported JS: with no end date, the window is
        // "now + 24h" recomputed on every call, not "start + 24h" - so an
        // alert that started long ago and never got an end date reads as
        // Active forever, not Ended. That's the original app's real
        // behaviour, not a mistake in this port.
        let longAgo = makeAlert(start: nowUnix - 90_000, end: 0)
        XCTAssertEqual(AlertStatusCalculator.status(for: longAgo, now: now).label, "Active")
    }

    func testFutureAlertBuckets() {
        let nowUnix = Int(now.timeIntervalSince1970)
        XCTAssertEqual(AlertStatusCalculator.status(for: makeAlert(start: nowUnix + 3600, end: 0), now: now).label, "Today")
        XCTAssertEqual(AlertStatusCalculator.status(for: makeAlert(start: nowUnix + 86400, end: 0), now: now).label, "Tomorrow")
        XCTAssertEqual(AlertStatusCalculator.status(for: makeAlert(start: nowUnix + 86400 * 5, end: 0), now: now).label, "In 5d")
        XCTAssertEqual(AlertStatusCalculator.status(for: makeAlert(start: nowUnix + 86400 * 10, end: 0), now: now).label, "Upcoming")
    }

    func testPastAlertWithoutOverlapIsEnded() {
        let nowUnix = Int(now.timeIntervalSince1970)
        let alert = makeAlert(start: nowUnix - 200_000, end: nowUnix - 100_000)
        XCTAssertEqual(AlertStatusCalculator.status(for: alert, now: now).label, "Ended")
    }
}
