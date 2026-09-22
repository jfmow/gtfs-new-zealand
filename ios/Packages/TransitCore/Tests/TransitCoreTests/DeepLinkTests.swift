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

    func testUnknownRouteFails() throws {
        let url = try XCTUnwrap(URL(string: "transit://nonsense?id=abc"))
        XCTAssertNil(DeepLink(url: url))
    }
}
