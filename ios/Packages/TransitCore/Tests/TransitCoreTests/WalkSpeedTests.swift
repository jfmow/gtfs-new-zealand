import TransitCore
import XCTest

final class WalkSpeedTests: XCTestCase {
    func testLegacySpeedsMoveToTheSlowerScale() {
        XCTAssertEqual(WalkSpeed.normalized(3), WalkSpeed.slow)
        XCTAssertEqual(WalkSpeed.normalized(4.8), WalkSpeed.normal)
        XCTAssertEqual(WalkSpeed.normalized(5.5), WalkSpeed.brisk)
        XCTAssertEqual(WalkSpeed.normalized(0), WalkSpeed.normal)
        XCTAssertEqual(WalkSpeed.normalized(3.2), 3.2)
    }
}
