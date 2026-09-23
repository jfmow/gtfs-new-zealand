import Foundation

/// A leave-by reminder to create - `addJourneyReminder` in the web's
/// `lib/notifications.ts`, field for field.
///
/// Replaces `addLeaveByReminder(for:)`, which always sent `timeType=arriveat`
/// and the labels "Start"/"Destination", with no offset choice and no
/// repeating reminders.
public struct JourneyReminderRequest: Equatable, Sendable {
    public enum Kind: String, Sendable {
        /// One specific boarding trip on one day.
        case fixedTrip = "fixed_trip"
        /// Re-planned each matching day ("weekdays", custom days).
        case journeyRequest = "journey_request"
    }

    public struct Place: Equatable, Sendable {
        public var label: String
        public var coordinate: Coordinate
        public init(label: String, coordinate: Coordinate) {
            self.label = label
            self.coordinate = coordinate
        }
    }

    public var kind: Kind
    public var start: Place
    public var end: Place
    /// "departat" | "arriveat" - the backend's vocabulary.
    public var timeType: String
    public var targetHHMM: String
    public var maxWalkKm: Double
    public var walkSpeed: Double
    public var maxTransfers: Int
    public var onlyRoutes: [String]
    /// Minutes before the leave time; 0 = "when to leave".
    public var offsets: [Int]
    public var deeplink: String
    // journey_request only
    public var recurrence: String?
    public var recurrenceUntil: String?
    // fixed_trip only
    public var serviceDate: String?
    public var boardTripID: String?
    public var boardStopID: String?
    public var scheduledDepartureISO: String?
    public var routeShortName: String?
    public var boardStopName: String?
    public var accessSeconds: Int?

    /// The form body, exactly as the web sends it.
    public var formFields: [String: String] {
        var form: [String: String] = [
            "kind": kind.rawValue,
            "startLat": String(start.coordinate.latitude),
            "startLon": String(start.coordinate.longitude),
            "startLabel": start.label,
            "endLat": String(end.coordinate.latitude),
            "endLon": String(end.coordinate.longitude),
            "endLabel": end.label,
            "timeType": timeType,
            "targetHHMM": targetHHMM,
            "maxWalkKm": Self.number(maxWalkKm),
            "walkSpeed": Self.number(walkSpeed),
            "maxTransfers": String(maxTransfers),
            "offsets": "[" + offsets.map(String.init).joined(separator: ",") + "]",
            "deeplink": deeplink,
        ]
        if !onlyRoutes.isEmpty,
           let data = try? JSONEncoder().encode(onlyRoutes), let json = String(data: data, encoding: .utf8) {
            form["onlyRoutes"] = json
        }
        if let recurrence, !recurrence.isEmpty { form["recurrence"] = recurrence }
        if let recurrenceUntil, !recurrenceUntil.isEmpty { form["recurrenceUntil"] = recurrenceUntil }
        if let serviceDate { form["serviceDate"] = serviceDate }
        if let boardTripID { form["boardTripId"] = boardTripID }
        if let boardStopID { form["boardStopId"] = boardStopID }
        if let scheduledDepartureISO { form["scheduledDepartureIso"] = scheduledDepartureISO }
        if let routeShortName { form["routeShortName"] = routeShortName }
        if let boardStopName { form["boardStopName"] = boardStopName }
        if let accessSeconds { form["accessSeconds"] = String(accessSeconds) }
        return form
    }

    /// "1" rather than "1.0" for whole numbers, matching the web's strings.
    private static func number(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }

    /// Builds the request the web's `LeaveReminderDialog` would for `plan`.
    ///
    /// - Parameters:
    ///   - recurrence: 7-char Mon..Sun mask ("1111100"); empty = once.
    ///   - recurrenceUntil: "YYYY-MM-DD" or nil.
    ///   - arriveBy: the search was "arrive by" (target = the plan's arrival).
    public static func make(
        plan: JourneyPlan,
        start: Place,
        end: Place,
        arriveBy: Bool,
        maxWalkKm: Double,
        walkSpeed: Double,
        maxTransfers: Int,
        onlyRoutes: [String],
        offsets: [Int],
        recurrence: String,
        recurrenceUntil: String?,
        regionSlug: String?
    ) -> JourneyReminderRequest? {
        guard let transit = plan.legs.first(where: { $0.mode == "transit" }),
              let boardDeparture = transit.scheduledDepartureTime.date ?? transit.departureTime.date
        else { return nil }

        let targetSource = arriveBy ? (plan.arrivalTime.date ?? boardDeparture) : boardDeparture
        var request = JourneyReminderRequest(
            kind: recurrence.isEmpty ? .fixedTrip : .journeyRequest,
            start: start, end: end,
            timeType: arriveBy ? "arriveat" : "departat",
            targetHHMM: TimeFormatting.nzHHMM(targetSource),
            maxWalkKm: maxWalkKm, walkSpeed: walkSpeed, maxTransfers: maxTransfers,
            onlyRoutes: onlyRoutes, offsets: offsets, deeplink: ""
        )

        if recurrence.isEmpty {
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            request.deeplink = "/journey?id=\(plan.id)" + (regionSlug.map { "&region=\($0)" } ?? "")
            request.serviceDate = TimeFormatting.nzServiceDate(boardDeparture)
            request.boardTripID = transit.tripID
            request.boardStopID = transit.fromStop?.stopID
            request.scheduledDepartureISO = iso.string(from: boardDeparture)
            request.routeShortName = transit.route?.routeShortName.isEmpty == false ? transit.route!.routeShortName : transit.routeID
            request.boardStopName = transit.fromStop?.stopName
            request.accessSeconds = JourneyReminderMath.leadingAccessSeconds(plan)
        } else {
            request.recurrence = recurrence
            request.recurrenceUntil = recurrenceUntil.map { $0.replacingOccurrences(of: "-", with: "") }
            request.deeplink = planDeeplink(start: start, end: end, maxWalkKm: maxWalkKm, walkSpeed: walkSpeed,
                                            maxTransfers: maxTransfers, onlyRoutes: onlyRoutes, arriveBy: arriveBy)
        }
        return request
    }

    /// `recurringDeeplink` - reopens the planner with this search (parsed
    /// back by `DeepLink` -> `PlanPrefill`).
    static func planDeeplink(start: Place, end: Place, maxWalkKm: Double, walkSpeed: Double, maxTransfers: Int, onlyRoutes: [String], arriveBy: Bool) -> String {
        var c = URLComponents()
        c.path = "/plan"
        c.queryItems = [
            .init(name: "startLat", value: String(start.coordinate.latitude)),
            .init(name: "startLon", value: String(start.coordinate.longitude)),
            .init(name: "startLabel", value: start.label),
            .init(name: "endLat", value: String(end.coordinate.latitude)),
            .init(name: "endLon", value: String(end.coordinate.longitude)),
            .init(name: "endLabel", value: end.label),
            .init(name: "maxWalkKm", value: number(maxWalkKm)),
            .init(name: "walkSpeed", value: number(walkSpeed)),
            .init(name: "maxTransfers", value: String(maxTransfers)),
            .init(name: "timeType", value: arriveBy ? "arriveat" : "leaveat"),
        ]
        if !onlyRoutes.isEmpty {
            c.queryItems?.append(.init(name: "onlyRoutes", value: onlyRoutes.joined(separator: ",")))
        }
        return c.string ?? "/plan"
    }
}

public enum JourneyReminderMath {
    /// Seconds from the plan's start to boarding its first ride (scheduled)
    /// - the walk/wait the reminder counts back from.
    public static func leadingAccessSeconds(_ plan: JourneyPlan) -> Int {
        guard let transit = plan.legs.first(where: { $0.mode == "transit" }),
              let board = transit.scheduledDepartureTime.date ?? transit.departureTime.date,
              let start = plan.legs.first?.departureTime.date
        else { return 0 }
        return max(0, Int(board.timeIntervalSince(start).rounded()))
    }

    /// When the rider needs to leave for `plan` (scheduled boarding minus
    /// the access walk).
    public static func leaveTime(_ plan: JourneyPlan) -> Date? {
        guard let transit = plan.legs.first(where: { $0.mode == "transit" }),
              let board = transit.scheduledDepartureTime.date ?? transit.departureTime.date
        else { return nil }
        return board.addingTimeInterval(-Double(leadingAccessSeconds(plan)))
    }

    /// "" -> "Once", "1111100" -> "Weekdays", "0000011" -> "Weekends",
    /// "1111111" -> "Every day", else "Mon, Wed".
    public static func weekdayMaskLabel(_ mask: String) -> String {
        guard mask.contains("1") else { return "Once" }
        switch mask {
        case "1111100": return "Weekdays"
        case "0000011": return "Weekends"
        case "1111111": return "Every day"
        default:
            let labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            return zip(labels, mask).filter { $0.1 == "1" }.map(\.0).joined(separator: ", ")
        }
    }

    /// For an arrive-by search: the option that lets the rider leave latest.
    public static func latestDeparture(_ plans: [JourneyPlan]) -> JourneyPlan? {
        plans.max { ($0.departureTime.date ?? .distantPast) < ($1.departureTime.date ?? .distantPast) }
    }
}

extension APIClient {
    /// `POST /notifications/journey-reminder` - see `JourneyReminderRequest`.
    @discardableResult
    public func addJourneyReminder(_ request: JourneyReminderRequest) async throws -> JourneyReminderCreated {
        try await postForm("notifications/journey-reminder", form: request.formFields)
    }
}
