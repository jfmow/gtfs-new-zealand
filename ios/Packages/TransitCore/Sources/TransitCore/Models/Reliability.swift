import Foundation

/// How a route usually runs at a stop at that time of the week -
/// `reliability.Stat` on the backend (`providers/reliability/stats.go`).
public struct ReliabilityStat: Codable, Hashable, Sendable {
    public enum Level: String, Codable, Sendable { case good, fair, poor }

    public let samples: Int
    /// Between 1 min early and 5 min late.
    public let onTimePct: Int
    public let earlyPct: Int
    public let latePct: Int
    /// Median delay in minutes (negative = early).
    public let typicalMin: Int
    public let cancelledPct: Int?
    /// "Usually on time", "Usually 3–5 min late", "Often early".
    public let summary: String
    /// "82% on time · 1 in 10 cancelled".
    public let detail: String
    public let level: Level

    enum CodingKeys: String, CodingKey {
        case samples, summary, detail, level
        case onTimePct = "on_time_pct"
        case earlyPct = "early_pct"
        case latePct = "late_pct"
        case typicalMin = "typical_min"
        case cancelledPct = "cancelled_pct"
    }
}

/// The real wait at a frequent service against the timetable's -
/// `reliability.Wait`.
public struct ReliabilityWait: Codable, Hashable, Sendable {
    public let headwayMin: Double
    public let timetableWaitMin: Double
    public let realWaitMin: Double

    enum CodingKeys: String, CodingKey {
        case headwayMin = "headway_min"
        case timetableWaitMin = "timetable_wait_min"
        case realWaitMin = "real_wait_min"
    }
}

/// `GET reliability/stop`.
public struct StopReliability: Codable, Sendable {
    /// Route id -> stat.
    public let routes: [String: ReliabilityStat]
    /// Route id -> real wait, for frequent routes. Absent from older servers.
    public let waits: [String: ReliabilityWait]?
}

/// How often a change between two rides works out -
/// `reliability.Connection`.
public struct ReliabilityConnection: Codable, Hashable, Sendable {
    /// 0-1.
    public let chance: Double
    /// "Works 9 times in 10".
    public let summary: String
    public let level: ReliabilityStat.Level
}

/// `GET reliability/connections`.
public struct ConnectionsReliability: Codable, Sendable {
    public let changes: [ReliabilityConnection?]
}

/// `GET reliability/rides`.
public struct RidesReliability: Codable, Sendable {
    /// Aligned with the rides asked for; nil where there's too little data.
    public let rides: [ReliabilityStat?]
}

public enum JourneyReliability {
    /// "routeA|stopA|unixA|routeB|stopB|unixB|slack" for each change, by the
    /// index of the ride changed to - the web's `changeKeys`.
    public static func changeKeys(_ legs: [JourneyLeg]) -> [Int: String] {
        var out: [Int: String] = [:]
        var prev = -1
        for (i, leg) in legs.enumerated() where leg.mode != "walk" {
            defer { prev = i }
            guard prev >= 0 else { continue }
            let a = legs[prev]
            guard !a.routeID.isEmpty, let alight = a.toStop, !leg.routeID.isEmpty, let board = leg.fromStop,
                  let arrive = a.scheduledArrivalTime.date ?? a.arrivalTime.date,
                  let depart = leg.scheduledDepartureTime.date ?? leg.departureTime.date
            else { continue }
            let walk = legs[(prev + 1)..<i].filter { $0.mode == "walk" }.reduce(0) { $0 + $1.duration.timeInterval }
            let slack = Int((depart.timeIntervalSince(arrive) - walk).rounded())
            out[i] = [a.routeID, alight.stopID, String(Int(arrive.timeIntervalSince1970)),
                      leg.routeID, board.stopID, String(Int(depart.timeIntervalSince1970)), String(slack)].joined(separator: "|")
        }
        return out
    }

    /// "route|stop|unix" for each leg - nil for walks (and rides missing a
    /// route or stop), so results line up with `legs`.
    public static func rideKeys(_ legs: [JourneyLeg]) -> [String?] {
        legs.map { leg in
            guard leg.mode != "walk", !leg.routeID.isEmpty, let stop = leg.fromStop,
                  let departs = leg.scheduledDepartureTime.date ?? leg.departureTime.date
            else { return nil }
            return "\(leg.routeID)|\(stop.stopID)|\(Int(departs.timeIntervalSince1970))"
        }
    }
}
