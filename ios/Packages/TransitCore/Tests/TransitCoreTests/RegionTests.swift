import XCTest
@testable import TransitCore

final class RegionTests: XCTestCase {
    func testBySlugFindsKnownRegions() {
        XCTAssertEqual(Region.bySlug("at")?.slug, "at")
        XCTAssertEqual(Region.bySlug("wel")?.slug, "wel")
        XCTAssertEqual(Region.bySlug("christ")?.slug, "christ")
    }

    func testBySlugReturnsNilForUnknownSlug() {
        XCTAssertNil(Region.bySlug("nowhere"))
    }

    func testBaseURLsHaveTheRegionPrefix() {
        for region in Region.all {
            XCTAssertTrue(region.baseURL.path.hasSuffix("/\(region.slug)"), "\(region.slug) base URL is \(region.baseURL)")
        }
    }
}
