import XCTest
@testable import TransitCore

final class GoTypesTests: XCTestCase {
    func testGoDurationDecodesNanosecondsAndConvertsToTimeInterval() throws {
        let duration = try JSONDecoder().decode(GoDuration.self, from: Data("2077000000000".utf8))
        XCTAssertEqual(duration.nanoseconds, 2_077_000_000_000)
        XCTAssertEqual(duration.timeInterval, 2077, accuracy: 0.001)
    }

    func testGoTimeDecodesWithFractionalSeconds() throws {
        let time = try JSONDecoder().decode(GoTime.self, from: Data("\"2026-09-22T16:24:00.838434226+12:00\"".utf8))
        XCTAssertNotNil(time.date)
    }

    func testGoTimeDecodesWithoutFractionalSeconds() throws {
        let time = try JSONDecoder().decode(GoTime.self, from: Data("\"2026-09-22T16:27:00+12:00\"".utf8))
        XCTAssertNotNil(time.date)
    }

    func testGoTimeZeroValueDecodesToNilDate() throws {
        let time = try JSONDecoder().decode(GoTime.self, from: Data("\"0001-01-01T00:00:00Z\"".utf8))
        XCTAssertNil(time.date, "Go's zero time.Time must not decode to a bogus 1st-century Date")
        XCTAssertEqual(time.raw, "0001-01-01T00:00:00Z")
    }

    func testGoEpochMillisConvertsToDate() throws {
        let millis = try JSONDecoder().decode(GoEpochMillis.self, from: Data("1790049880000".utf8))
        XCTAssertEqual(millis.date.timeIntervalSince1970, 1_790_049_880, accuracy: 0.001)
    }
}
