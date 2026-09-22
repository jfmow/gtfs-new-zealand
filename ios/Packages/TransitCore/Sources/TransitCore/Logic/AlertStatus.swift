import Foundation

/// How an alert's status is grouped for display - drives colour/urgency in
/// the alerts UI (`pages/alerts.tsx`'s `getAlertStatus`).
public enum AlertStatusKind: String, Sendable {
    case active, soon, inactive
}

public struct AlertStatus: Sendable, Equatable {
    public let kind: AlertStatusKind
    public let label: String
}

/// Ported 1:1 from `pages/alerts.tsx`'s `getAlertStatus` (2026-09-22). A
/// missing/non-positive `endDate` falls back to "now + 24h", recomputed on
/// every call - so an alert with no end date reads as Active indefinitely
/// once its start has passed, never Ended (a quirk of the original app,
/// faithfully preserved here rather than "fixed"). `daysUntil` rounds to the
/// nearest day, not floor/ceil.
public enum AlertStatusCalculator {
    public static func status(for alert: TransitAlert, now: Date = Date()) -> AlertStatus {
        let nowSeconds = now.timeIntervalSince1970
        let startDate = Double(alert.startDate)
        let endDate = alert.endDate > 0 ? Double(alert.endDate) : nowSeconds + 86400

        if startDate <= nowSeconds, endDate >= nowSeconds {
            return AlertStatus(kind: .active, label: "Active")
        }
        if startDate > nowSeconds {
            let daysUntil = Int(((startDate - nowSeconds) / 86400).rounded())
            if daysUntil == 0 { return AlertStatus(kind: .soon, label: "Today") }
            if daysUntil == 1 { return AlertStatus(kind: .soon, label: "Tomorrow") }
            if daysUntil <= 7 { return AlertStatus(kind: .soon, label: "In \(daysUntil)d") }
            return AlertStatus(kind: .inactive, label: "Upcoming")
        }
        return AlertStatus(kind: .inactive, label: "Ended")
    }
}
