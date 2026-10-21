import XCTest
@testable import TransitCore

final class FareTypeChoicesTests: XCTestCase {
    func testEachRegionKeepsItsOwnChoice() {
        var stored = ""
        XCTAssertEqual(FareTypeChoices.choice(in: stored, region: "at"), .adult)
        stored = FareTypeChoices.setting(.child, for: "at", in: stored)
        stored = FareTypeChoices.setting(.supergold, for: "wel", in: stored)
        XCTAssertEqual(stored, "at=child;wel=supergold")
        XCTAssertEqual(FareTypeChoices.choice(in: stored, region: "at"), .child)
        XCTAssertEqual(FareTypeChoices.choice(in: stored, region: "wel"), .supergold)
        XCTAssertEqual(FareTypeChoices.choice(in: stored, region: "christ"), .adult)
        stored = FareTypeChoices.setting(.adult, for: "at", in: stored)
        XCTAssertEqual(FareTypeChoices.choice(in: stored, region: "at"), .adult)
        XCTAssertEqual(FareTypeChoices.choice(in: "at=nonsense", region: "at"), .adult)
    }

    func testDecodesRegionOptions() throws {
        let json = #"{"types":[{"value":"adult","label":"Standard","detail":"Metrocard or contactless"},{"value":"youth","label":"Youth","detail":"19-24"}]}"#
        let decoded = try JSONDecoder().decode(FareTypesResponse.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.types.map(\.value), ["adult", "youth"])
        XCTAssertEqual(decoded.types[0].label, "Standard")
    }
}
