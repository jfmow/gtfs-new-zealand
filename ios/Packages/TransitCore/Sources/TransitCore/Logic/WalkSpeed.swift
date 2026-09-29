import Foundation

/// Walking paces (km/h) the planner offers. Mirrors the backend's
/// `NormalizeWalkSpeed` and the web's `lib/walk-speed.ts`.
public enum WalkSpeed {
    public static let slow = 2.5
    public static let normal = 3.6
    public static let brisk = 4.5

    /// Earlier scales (3 / 4.8 / 5.5, then 2.8 / 4 / 5) proved too quick -
    /// saved trips, reminders and old links still carry them, so move them
    /// onto the current scale.
    public static func normalized(_ speed: Double) -> Double {
        switch speed {
        case 3, 2.8: return slow
        case 4.8, 4: return normal
        case 5.5, 5: return brisk
        case ...0: return normal
        default: return speed
        }
    }
}
