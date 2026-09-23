import Foundation

/// Advances through a walking leg's turn-by-turn steps as the rider's
/// position updates - a straight port of `lib/useNavigationTracker.ts`
/// (same 25m arrival threshold, same "scan forward from the current step,
/// stop at the first one still within range" logic). Plain, stateful, and
/// UI-framework-agnostic - same shape as `JourneyProgressModel`: call
/// `update`, read the returned snapshot, store it in `@State`.
public final class WalkNavigationTracker {
    private static let arrivalThresholdMeters: Double = 25

    public struct Snapshot: Sendable, Equatable {
        public let currentStepIndex: Int
        public let distanceToNextManeuver: Double
        public let arrived: Bool
    }

    private var currentStepIndex = 0
    private var arrived = false

    public init() {}

    /// Call on every location update while walking a leg's `steps`.
    @discardableResult
    public func update(steps: [DirectionStep], location: Coordinate) -> Snapshot {
        guard !steps.isEmpty, !arrived else {
            return Snapshot(currentStepIndex: currentStepIndex, distanceToNextManeuver: 0, arrived: arrived)
        }

        for index in currentStepIndex..<steps.count {
            let step = steps[index]
            guard step.lat != 0 || step.lon != 0 else { continue }

            let distance = Geo.haversineDistanceMeters(location, step.coordinate)
            if distance < Self.arrivalThresholdMeters {
                if step.type == "arrive" {
                    arrived = true
                    currentStepIndex = index
                    return Snapshot(currentStepIndex: index, distanceToNextManeuver: 0, arrived: true)
                }

                let nextIndex = min(index + 1, steps.count - 1)
                if nextIndex > currentStepIndex {
                    currentStepIndex = nextIndex
                }
                break
            }
        }

        let target = steps[currentStepIndex]
        let distanceToNext = (target.lat != 0 || target.lon != 0)
            ? Geo.haversineDistanceMeters(location, target.coordinate)
            : 0
        return Snapshot(currentStepIndex: currentStepIndex, distanceToNextManeuver: distanceToNext, arrived: false)
    }

    /// Call when a new walking leg starts (a different set of `steps`) so a
    /// stale `currentStepIndex` from the previous leg doesn't carry over.
    public func reset() {
        currentStepIndex = 0
        arrived = false
    }
}
