import XCTest
@testable import TransitCore

final class FormattingTests: XCTestCase {
    func testConvert24hTo12h() {
        XCTAssertEqual(TimeFormatting.convert24hTo12h("16:15:00"), "4:15pm")
        XCTAssertEqual(TimeFormatting.convert24hTo12h("00:05:00"), "12:05am")
        XCTAssertEqual(TimeFormatting.convert24hTo12h("12:00:00"), "12:00pm")
    }

    func testConvert24hTo12hWrapsPastMidnight() {
        // GTFS allows hours >= 24 for a service that starts before and ends
        // after midnight on the same service day.
        XCTAssertEqual(TimeFormatting.convert24hTo12h("25:30:00"), "1:30am")
        XCTAssertEqual(TimeFormatting.convert24hTo12h("24:00:00"), "12:00am")
    }

    func testConvert24hTo12hRejectsMalformedInput() {
        XCTAssertNil(TimeFormatting.convert24hTo12h("not-a-time"))
    }

    func testTimeTillArrivalString() {
        XCTAssertEqual(TimeFormatting.timeTillArrivalString(minutes: -5), "Departed")
        XCTAssertEqual(TimeFormatting.timeTillArrivalString(minutes: 0), "Now")
        XCTAssertEqual(TimeFormatting.timeTillArrivalString(minutes: 0.4), "Now")
        XCTAssertEqual(TimeFormatting.timeTillArrivalString(minutes: 8), "8 min")
        XCTAssertEqual(TimeFormatting.timeTillArrivalString(minutes: 65), "1 hr 5 min")
        XCTAssertEqual(TimeFormatting.timeTillArrivalString(minutes: 120), "2 hr")
        XCTAssertEqual(TimeFormatting.timeTillArrivalString(minutes: 60 * 24), "1 day")
        XCTAssertEqual(TimeFormatting.timeTillArrivalString(minutes: 60 * 24 * 3), "3 days")
    }

    func testFormatDuration() {
        XCTAssertEqual(TimeFormatting.formatDuration(GoDuration(nanoseconds: 65 * 1_000_000_000)), "1 min")
        XCTAssertEqual(TimeFormatting.formatDuration(GoDuration(nanoseconds: 2077 * 1_000_000_000)), "35 min")
        XCTAssertEqual(TimeFormatting.formatDuration(GoDuration(nanoseconds: 7320 * 1_000_000_000)), "2h 2m")
        XCTAssertEqual(TimeFormatting.formatDuration(GoDuration(nanoseconds: 7200 * 1_000_000_000)), "2h")
    }

    func testFormatDistance() {
        XCTAssertEqual(TimeFormatting.formatDistance(meters: 350), "350 m")
        XCTAssertEqual(TimeFormatting.formatDistance(meters: 1500), "1.50 km")
    }

    func testNZServiceDateAndHHMMUsePacificAuckland() {
        // 2026-06-15 12:00 UTC is 2026-06-16 00:00 NZST (UTC+12, no DST in June).
        let date = Date(timeIntervalSince1970: 1_781_524_800)
        XCTAssertEqual(TimeFormatting.nzServiceDate(date), "20260616")
        XCTAssertEqual(TimeFormatting.nzHHMM(date), "00:00")
    }
}
