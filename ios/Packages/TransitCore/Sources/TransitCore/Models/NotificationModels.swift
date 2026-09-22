import Foundation

/// `GET .../notifications/mine` - every stop + route subscription for this
/// device, plus its recent notification history. Field names confirmed
/// against the Go structs in `providers/notifications/notifications.go`
/// (2026-09-22, same session that wrote them).
public struct MySubscriptions: Codable, Sendable {
    public let stops: [StopSubscription]?
    public let routes: [RouteSubscription]?
    public let recentNotifications: [RecentNotificationEntry]?

    enum CodingKeys: String, CodingKey {
        case stops, routes
        case recentNotifications = "recent_notifications"
    }
}

public struct StopSubscription: Codable, Sendable, Identifiable {
    public let parentStopID: String
    public let routes: [String]?
    public let causes: [String]?
    public let minSeverity: String
    public let notifyCancellations: Bool

    public var id: String { parentStopID }

    enum CodingKeys: String, CodingKey {
        case parentStopID = "parent_stop_id"
        case routes, causes
        case minSeverity = "min_severity"
        case notifyCancellations = "notify_cancellations"
    }
}

public struct RouteSubscription: Codable, Sendable, Identifiable {
    public let routeID: String
    public let causes: [String]?
    public let minSeverity: String
    public let notifyCancellations: Bool

    public var id: String { routeID }

    enum CodingKeys: String, CodingKey {
        case routeID = "route_id"
        case causes
        case minSeverity = "min_severity"
        case notifyCancellations = "notify_cancellations"
    }
}

public struct RecentNotificationEntry: Codable, Sendable, Identifiable {
    public let id: String
    public let seenAt: Int64?
    public let title: String?
    public let body: String?
    public let url: String?
    public let dismissed: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case seenAt = "seen_at"
        case title, body, url, dismissed
    }
}

/// A resolved leave-by reminder - `journeyReminderDTO` on the backend
/// (`providers/notifications/journey_reminders.go`).
public struct JourneyReminderDTO: Codable, Sendable, Identifiable {
    public let id: Int
    public let kind: String
    public let status: String
    public let startLabel: String
    public let endLabel: String
    public let timeType: String
    public let targetHHMM: String
    public let recurrence: String
    public let serviceDate: String
    public let offsets: [Int]?
    public let routeShortName: String?
    public let boardStopName: String?
    public let recurrenceUntil: String?
    public let nextLeaveUnix: Int64?
    public let nextLeaveLocal: String?

    enum CodingKeys: String, CodingKey {
        case id, kind, status, recurrence, offsets
        case startLabel = "start_label"
        case endLabel = "end_label"
        case timeType = "time_type"
        case targetHHMM = "target_hhmm"
        case serviceDate = "service_date"
        case routeShortName = "route_short_name"
        case boardStopName = "board_stop_name"
        case recurrenceUntil = "recurrence_until"
        case nextLeaveUnix = "next_leave_unix"
        case nextLeaveLocal = "next_leave_local"
    }
}

/// `POST .../devices/register` / `.../update-token` response.
public struct DeviceRegistrationResult: Codable, Sendable {
    public let id: Int
}

/// `POST .../notifications/journey-reminder` response.
public struct JourneyReminderCreated: Codable, Sendable {
    public let id: Int
    public let status: String
    public let kind: String
    public let serviceDate: String
    public let nextLeaveUnix: Int64?
    public let nextLeaveLocal: String?

    enum CodingKeys: String, CodingKey {
        case id, status, kind
        case serviceDate = "service_date"
        case nextLeaveUnix = "next_leave_unix"
        case nextLeaveLocal = "next_leave_local"
    }
}
