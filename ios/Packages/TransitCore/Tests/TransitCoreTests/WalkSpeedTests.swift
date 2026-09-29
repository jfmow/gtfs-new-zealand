import TransitCore
import XCTest

final class WalkSpeedTests: XCTestCase {
    func testEarlierScalesMoveToTheCurrentOne() {
        for (old, new) in [(3.0, WalkSpeed.slow), (4.8, WalkSpeed.normal), (5.5, WalkSpeed.brisk),
                           (2.8, WalkSpeed.slow), (4.0, WalkSpeed.normal), (5.0, WalkSpeed.brisk)] {
            XCTAssertEqual(WalkSpeed.normalized(old), new, "\(old)")
        }
        XCTAssertEqual(WalkSpeed.normalized(0), WalkSpeed.normal)
        XCTAssertEqual(WalkSpeed.normalized(3.2), 3.2)
    }

    func testCurrentScaleIsStable() {
        for speed in [WalkSpeed.slow, WalkSpeed.normal, WalkSpeed.brisk] {
            XCTAssertEqual(WalkSpeed.normalized(speed), speed)
        }
    }
}
