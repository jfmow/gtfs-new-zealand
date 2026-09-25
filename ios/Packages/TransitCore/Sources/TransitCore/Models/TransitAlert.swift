import Foundation

/// A service alert - `AlertResponseData` on the backend
/// (`backend/providers/realtime.go:868`). Named `TransitAlert` rather than
/// `Alert` to avoid colliding with SwiftUI's `Alert` view. Field names/types
/// confirmed against the Go struct tags (2026-09-22); the causes/effects/
/// severities are GTFS-RT `Alert_Cause`/`Alert_Effect`/`Alert_SeverityLevel`
/// enum names (e.g. "CONSTRUCTION", "NO_SERVICE", "WARNING"), not human text.
public struct TransitAlert: Codable, Hashable, Sendable {
    /// Only present on a route-scoped alert list; absent when alerts are
    /// already grouped by route (see `AlertsForStop`).
    public let routeID: String?
    /// Epoch seconds.
    public let startDate: Int
    /// Epoch seconds. `<= 0` means open-ended (no end date was set).
    public let endDate: Int
    public let cause: String
    public let effect: String
    public let title: String
    public let description: String
    public let severity: String

    enum CodingKeys: String, CodingKey {
        case routeID = "route_id"
        case startDate = "start_date"
        case endDate = "end_date"
        case cause, effect, title, description, severity
    }
}

/// `GET /{region}/realtime/alerts/{stopName}` - alerts grouped by the route
/// they affect, plus which routes actually serve this stop (so a route with
/// no current alerts can still show as a tab with "no alerts").
public struct AlertsForStop: Codable, Hashable, Sendable {
    public let alerts: [String: [TransitAlert]]
    public let routesToDisplay: [String]

    enum CodingKeys: String, CodingKey {
        case alerts
        case routesToDisplay = "routes_to_display"
    }
}
