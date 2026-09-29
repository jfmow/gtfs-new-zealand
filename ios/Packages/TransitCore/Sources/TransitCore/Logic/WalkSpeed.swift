import Foundation

/// Walking paces (km/h) the planner offers. Mirrors the backend's
/// `NormalizeWalkSpeed` and the web's `lib/walk-speed.ts`.
public enum WalkSpeed {
    public static let slow = 2.8
    public static let normal = 4.0
    public static let brisk = 5.0

    /// The old 3 / 4.8 / 5.5 choices proved too quick - saved trips, reminders
    /// and old links still carry them, so move them onto the new scale.
    public static func normalized(_ speed: Double) -> Double {
        switch speed {
        case 3: return slow
        case 4.8: return normal
        case 5.5: return brisk
        case ...0: return normal
        default: return speed
        }
    }
}
