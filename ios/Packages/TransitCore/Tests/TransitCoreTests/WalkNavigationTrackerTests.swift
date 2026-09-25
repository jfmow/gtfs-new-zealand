import XCTest
@testable import TransitCore

final class WalkNavigationTrackerTests: XCTestCase {
    private func step(_ lat: Double, _ lon: Double, type: String = "turn") -> DirectionStep {
        DirectionStep(instruction: "test", modifier: "left", type: type, name: "", distance: 10, lat: lat, lon: lon)
    }

    func testAdvancesStepWhenWithinThreshold() {
        let tracker = WalkNavigationTracker()
        let steps = [
            step(-36.8485, 174.7633, type: "depart"),
            step(-36.8490, 174.7640, type: "turn"),
            step(-36.8495, 174.7650, type: "arrive"),
        ]

        // Reaching a step's own coordinate means "that manoeuvre is done" -
        // being exactly on step 1's coordinate advances *past* it, to step
        // 2, matching the web port's semantics exactly.
        let snapshot = tracker.update(steps: steps, location: Coordinate(latitude: -36.8490, longitude: 174.7640))
        XCTAssertEqual(snapshot.currentStepIndex, 2)
        XCTAssertFalse(snapshot.arrived)
    }

    func testStaysOnCurrentStepWhenNotYetClose() {
        let tracker = WalkNavigationTracker()
        let steps = [
            step(-36.8485, 174.7633, type: "depart"),
            step(-36.8490, 174.7640, type: "turn"),
            step(-36.8495, 174.7650, type: "arrive"),
        ]

        // Roughly midway between step 0 and step 1 - not within 25m of
        // anything yet, so no advance.
        let snapshot = tracker.update(steps: steps, location: Coordinate(latitude: -36.84875, longitude: 174.76365))
        XCTAssertEqual(snapshot.currentStepIndex, 0)
        XCTAssertGreaterThan(snapshot.distanceToNextManeuver, 25)
    }

    func testArrivesAtFinalStep() {
        let tracker = WalkNavigationTracker()
        let steps = [
            step(-36.8485, 174.7633, type: "depart"),
            step(-36.8495, 174.7650, type: "arrive"),
        ]
        _ = tracker.update(steps: steps, location: Coordinate(latitude: -36.8485, longitude: 174.7633))
        let snapshot = tracker.update(steps: steps, location: Coordinate(latitude: -36.8495, longitude: 174.7650))
        XCTAssertTrue(snapshot.arrived)
        XCTAssertEqual(snapshot.distanceToNextManeuver, 0)
    }

    func testDoesNotAdvanceWhenFar() {
        let tracker = WalkNavigationTracker()
        let steps = [
            step(-36.8485, 174.7633, type: "depart"),
            step(-36.9, 174.9, type: "arrive"), // ~20km away
        ]
        // Not exactly on step 0's own coordinate (which would immediately
        // advance past it) - just generally near the start, far from the
        // ~20km-away arrival step.
        let snapshot = tracker.update(steps: steps, location: Coordinate(latitude: -36.849, longitude: 174.7643))
        XCTAssertEqual(snapshot.currentStepIndex, 0)
        // ~105m from step 0's own coordinate (the still-current target) -
        // outside the 25m arrival threshold, so it hasn't advanced.
        XCTAssertGreaterThan(snapshot.distanceToNextManeuver, 25)
    }

    func testResetClearsState() {
        let tracker = WalkNavigationTracker()
        let steps = [step(-36.8485, 174.7633, type: "depart"), step(-36.8495, 174.7650, type: "arrive")]
        _ = tracker.update(steps: steps, location: Coordinate(latitude: -36.8495, longitude: 174.7650))
        tracker.reset()
        let snapshot = tracker.update(steps: steps, location: Coordinate(latitude: -36.849, longitude: 174.7643))
        XCTAssertEqual(snapshot.currentStepIndex, 0)
        XCTAssertFalse(snapshot.arrived)
    }
}
