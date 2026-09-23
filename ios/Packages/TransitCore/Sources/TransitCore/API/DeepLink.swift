import Foundation

/// A parsed inbound link - a share link, a resumed journey, or a push
/// notification's deeplink. Mirrors the web app's routes and query-param
/// schema so the same links work on both platforms.
///
/// Accepts three shapes:
/// - the `transit://` custom scheme (`transit://journey?id=...&region=at`)
/// - a universal link (`https://<domain>/journey?...`, once Associated
///   Domains is set up)
/// - a bare web path (`/?s=Britomart 11814`, `/vehicles?tripId=...`) - what
///   the backend puts in every push payload's `url`, since the same
///   notification rows serve the web app too.
public enum DeepLink: Equatable, Sendable, Identifiable {
    case journey(id: String, region: String?)
    /// `/journey?id=...&track=1` - open straight into live tracking (the
    /// web's share links, the resume prompt, a Live Activity tap).
    case trackJourney(id: String, region: String?)
    case trip(tripID: String, region: String?)
    /// A stop's departure board - `/?s=<name + code>`.
    case stop(query: String)
    /// A stop's service alerts - `/alerts?s=<name + code>`.
    case stopAlerts(query: String)
    /// A route's service alerts - `/alerts/route/<routeId>`.
    case routeAlerts(routeID: String)
    /// The planner, prefilled - `/plan?startLat=...` (recurring leave-by
    /// reminders link here, since there's no fixed plan id to reopen).
    case plan(PlanPrefill)
    /// The notifications inbox / settings - `/notifications`, `/settings`.
    case notifications

    public var id: String {
        switch self {
        case .journey(let id, let region): return "journey:\(region ?? "")/\(id)"
        case .trackJourney(let id, let region): return "track:\(region ?? "")/\(id)"
        case .trip(let tripID, let region): return "trip:\(region ?? "")/\(tripID)"
        case .stop(let query): return "stop:\(query)"
        case .stopAlerts(let query): return "stop-alerts:\(query)"
        case .routeAlerts(let routeID): return "route-alerts:\(routeID)"
        case .plan(let prefill): return "plan:\(prefill.startLat),\(prefill.startLon)->\(prefill.endLat),\(prefill.endLon)"
        case .notifications: return "notifications"
        }
    }

    public var region: String? {
        switch self {
        case .journey(_, let region), .trackJourney(_, let region), .trip(_, let region): return region
        case .plan(let prefill): return prefill.region
        default: return nil
        }
    }

    /// Parses a push payload's `url` - usually a bare web path whose query
    /// values may contain raw spaces (the backend doesn't always encode
    /// stop names), which `URL(string:)` rejects outright.
    public init?(string: String) {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let url = URL(string: trimmed) ?? URL(string: trimmed.replacingOccurrences(of: " ", with: "%20")) {
            self.init(url: url)
        } else {
            return nil
        }
    }

    public init?(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }

        // `transit://journey?...` -> host="journey", the route. A universal
        // link or bare path has its route in the path instead.
        let route: String
        if components.scheme?.lowercased() == "transit" {
            let host = components.host ?? ""
            let rest = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            route = (rest.isEmpty ? host : "\(host)/\(rest)").lowercased()
        } else {
            route = components.path
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                .lowercased()
        }

        var query: [String: String] = [:]
        for item in components.queryItems ?? [] {
            if let value = item.value { query[item.name] = value }
        }

        switch route {
        case "journey":
            guard let id = query["id"], !id.isEmpty else { return nil }
            let track = query["track"] == "1" || query["track"] == "true"
            self = track ? .trackJourney(id: id, region: query["region"]) : .journey(id: id, region: query["region"])
        case "trip", "vehicles":
            guard let tripID = query["tripId"], !tripID.isEmpty else { return nil }
            self = .trip(tripID: tripID, region: query["region"])
        case "", "stop":
            guard let stop = query["s"], !stop.isEmpty else { return nil }
            self = .stop(query: stop)
        case "alerts":
            guard let stop = query["s"], !stop.isEmpty else { return nil }
            self = .stopAlerts(query: stop)
        case "plan":
            guard let prefill = PlanPrefill(query: query) else { return nil }
            self = .plan(prefill)
        case "notifications", "settings":
            self = .notifications
        default:
            if route.hasPrefix("alerts/route/") {
                let routeID = String(route.dropFirst("alerts/route/".count))
                // Keep the original casing - route ids are case-sensitive.
                let original = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                let originalID = original.split(separator: "/").last.map(String.init) ?? routeID
                guard !originalID.isEmpty else { return nil }
                self = .routeAlerts(routeID: originalID)
                return
            }
            return nil
        }
    }
}

/// The planner form's contents, as carried by a `/plan?...` link - see
/// `leave-reminder-dialog.tsx`'s `recurringDeeplink` for the producer.
public struct PlanPrefill: Equatable, Hashable, Sendable {
    public var startLat: Double
    public var startLon: Double
    public var startLabel: String
    public var endLat: Double
    public var endLon: Double
    public var endLabel: String
    public var maxWalkKm: Double?
    public var walkSpeed: Double?
    public var maxTransfers: Int?
    public var minResults: Int?
    /// "now" | "leaveat" | "arriveat" (web vocabulary).
    public var timeType: String?
    public var onlyRoutes: [String]
    public var region: String?

    init?(query: [String: String]) {
        guard let startLat = query["startLat"].flatMap(Double.init),
              let startLon = query["startLon"].flatMap(Double.init),
              let endLat = query["endLat"].flatMap(Double.init),
              let endLon = query["endLon"].flatMap(Double.init)
        else { return nil }
        self.startLat = startLat
        self.startLon = startLon
        self.startLabel = query["startLabel"].flatMap { $0.isEmpty ? nil : $0 } ?? "Start"
        self.endLat = endLat
        self.endLon = endLon
        self.endLabel = query["endLabel"].flatMap { $0.isEmpty ? nil : $0 } ?? "Destination"
        self.maxWalkKm = query["maxWalkKm"].flatMap(Double.init)
        self.walkSpeed = query["walkSpeed"].flatMap(Double.init)
        self.maxTransfers = query["maxTransfers"].flatMap(Int.init)
        self.minResults = query["minResults"].flatMap(Int.init)
        self.timeType = query["timeType"]
        self.onlyRoutes = (query["onlyRoutes"] ?? "").split(separator: ",").map(String.init).filter { !$0.isEmpty }
        self.region = query["region"]
    }
}
