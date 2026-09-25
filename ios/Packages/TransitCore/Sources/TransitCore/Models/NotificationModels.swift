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

/// `notifications/find-client` - the backend marshals its client struct
/// without JSON tags, hence the capitalised keys.
public struct StopSubscriptionState: Codable, Sendable, Equatable {
    public let routes: [String]?
    public let causes: [String]?
    public let minSeverity: String
    public let notifyCancellations: Bool

    enum CodingKeys: String, CodingKey {
        case routes = "Routes"
        case causes = "Causes"
        case minSeverity = "MinSeverity"
        case notifyCancellations = "NotifyCancellations"
    }
}

/// The alert-type groups the subscription pickers offer - the web's
/// `ALERT_CAUSE_GROUPS` (lib/alert-causes.ts). The backend only filters on
/// raw GTFS causes; grouping is purely a picker concern.
public enum AlertCauseGroup: String, CaseIterable, Sendable {
    case delaysCancellations = "delays_cancellations"
    case safetyIncidents = "safety_incidents"
    case weather
    case plannedWorks = "planned_works"

    public var label: String {
        switch self {
        case .delaysCancellations: return "Delays & cancellations"
        case .safetyIncidents: return "Safety & incidents"
        case .weather: return "Weather"
        case .plannedWorks: return "Planned works"
        }
    }

    public var causes: [String] {
        switch self {
        case .delaysCancellations: return ["TECHNICAL_PROBLEM", "MEDICAL_EMERGENCY", "OTHER_CAUSE", "UNKNOWN_CAUSE"]
        case .safetyIncidents: return ["ACCIDENT", "POLICE_ACTIVITY", "STRIKE", "DEMONSTRATION"]
        case .weather: return ["WEATHER"]
        case .plannedWorks: return ["MAINTENANCE", "CONSTRUCTION", "HOLIDAY"]
        }
    }

    /// Groups whose every cause is selected - a group only reads "on" when
    /// all of it is (`groupKeysFor`).
    public static func groups(for causes: [String]) -> Set<AlertCauseGroup> {
        Set(allCases.filter { group in group.causes.allSatisfy(causes.contains) })
    }

    public static func causes(for groups: Set<AlertCauseGroup>) -> [String] {
        allCases.filter(groups.contains).flatMap(\.causes)
    }
}

/// "All alert types · warning+ · no cancellations" - the manage sheet's
/// detail line (`subscriptionDetail` on the web).
public enum SubscriptionDetail {
    public static func text(causes: [String]?, minSeverity: String, notifyCancellations: Bool, extra: String? = nil) -> String {
        var parts: [String] = []
        if let extra { parts.append(extra) }
        if let causes, !causes.isEmpty {
            let groups = AlertCauseGroup.groups(for: causes).count
            parts.append(groups > 0 ? "\(groups) alert type\(groups == 1 ? "" : "s")" : "Custom alert types")
        } else {
            parts.append("All alert types")
        }
        if !minSeverity.isEmpty { parts.append("\(minSeverity.lowercased())+") }
        if !notifyCancellations { parts.append("no cancellations") }
        return parts.joined(separator: " · ")
    }

    /// `journeyReminderDetail` on the web.
    public static func text(for reminder: JourneyReminderDTO) -> String {
        var parts = [JourneyReminderMath.weekdayMaskLabel(reminder.recurrence)]
        parts.append("\(reminder.timeType == "arriveat" ? "arrive by" : "leave") \(reminder.targetHHMM)")
        if reminder.status == "pending_resolve" {
            parts.append("finding your trip…")
        } else if reminder.status == "scheduled" {
            parts.append("next \(reminder.serviceDate)")
        } else if let local = reminder.nextLeaveLocal, !local.isEmpty {
            parts.append("leave ~\(local)")
        }
        if !reminder.recurrence.isEmpty, let until = reminder.recurrenceUntil, !until.isEmpty {
            parts.append("until \(until)")
        }
        return parts.joined(separator: " · ")
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

/// `POST .../notifications/test` response - whether the server could push
/// to this device, and why not if it couldn't.
public struct PushTestResult: Codable, Sendable, Equatable {
    public let platform: String
    public let hasToken: Bool
    public let env: String
    public let sent: Bool
    public let error: String
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
