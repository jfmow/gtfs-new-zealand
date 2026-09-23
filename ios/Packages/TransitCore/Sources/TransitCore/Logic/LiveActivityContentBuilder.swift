import Foundation

/// The journey Live Activity's content, in the exact JSON shape the widget's
/// `JourneyActivityAttributes.ContentState` decodes - and the shape the
/// backend's `journeyActivityState` (backend/providers/notifications/
/// live_activity_state.go) pushes while the app is closed. Built on-device
/// by `LiveActivityContentBuilder` while the app is open; the wording and
/// rules there mirror the Go builder so hand-offs between the two never
/// visibly change the Lock Screen.
public struct LiveActivityContent: Codable, Equatable, Sendable {
    public struct NextLeg: Codable, Equatable, Sendable {
        public var routeShortName: String
        public var routeColorHex: String
        public var departureUnix: Double
        public var connectMinutes: Int
    }

    public struct LegChip: Codable, Equatable, Sendable {
        public var mode: String
        public var shortName: String
        public var colorHex: String
    }

    public var version = 3
    public var legIndex = 0
    public var phase = "walking"
    public var routeShortName = ""
    public var routeColorHex = ""
    public var headsign = ""
    public var primaryText = ""
    public var secondaryText = ""
    public var countdownLabel = ""
    public var targetUnix: Double = 0
    public var delayMinutes = 0
    public var status = "onTime"
    public var stopsAway: Int?
    public var arrivalUnix: Double = 0
    public var progressFraction: Double = 0
    public var totalLegs = 0
    public var platform: String?
    public var nextLeg: NextLeg?
    public var legChain: [LegChip] = []
    public var updatedUnix: Double = 0
    public var isRealtime = false
    // v3 - structured fields for the widget's phase row.
    public var boardStopName: String?
    public var alightStopName: String?
    public var nextStopName: String?
    /// Stops ridden, board -> alight.
    public var rideStops: Int?
    public var walkMinutes: Int?
    public var walkMeters: Int?
    public var hasVehicle: Bool?
    /// GTFS-RT occupancy status (0 empty ... 6 full), when the vehicle reports it.
    public var occupancy: Int?

    public init() {}
}

/// Where the rider is, as the on-device `JourneyProgressModel` sees it.
public struct LiveActivityProgress: Sendable {
    public var legIndex: Int
    /// walking | waiting | boarding | onboard - nil before the journey starts.
    public var phase: String?
    public var arrived: Bool
    /// Stops before the stop that matters right now (boarding stop while
    /// waiting, alighting stop while onboard) - 0 means it's the next stop.
    public var stopsAway: Int?
    public var nextStopName: String?
    public var isRealtime: Bool
    /// The ride's live vehicle is placed on its trip.
    public var hasVehicle: Bool
    /// Stops from the ride's boarding stop to its alighting stop.
    public var rideStops: Int?
    public var occupancy: Int?

    public init(legIndex: Int, phase: String?, arrived: Bool, stopsAway: Int? = nil, nextStopName: String? = nil, isRealtime: Bool = false,
                hasVehicle: Bool = false, rideStops: Int? = nil, occupancy: Int? = nil) {
        self.legIndex = legIndex
        self.phase = phase
        self.arrived = arrived
        self.stopsAway = stopsAway
        self.nextStopName = nextStopName
        self.isRealtime = isRealtime
        self.hasVehicle = hasVehicle
        self.rideStops = rideStops
        self.occupancy = occupancy
    }
}

public enum LiveActivityContentBuilder {
    /// `legs` should be the live-adjusted legs (JourneyPlanLiveAdjuster), so
    /// their departure/arrival times already include realtime delays.
    public static func build(legs: [JourneyLeg], progress: LiveActivityProgress, now: Date = Date()) -> LiveActivityContent {
        var c = LiveActivityContent()
        c.totalLegs = legs.count
        c.legChain = legChain(legs)
        c.updatedUnix = now.timeIntervalSince1970.rounded(.down)
        c.isRealtime = progress.isRealtime
        c.arrivalUnix = unix(legs.last?.arrivalTime.date) ?? c.updatedUnix

        let idx = progress.legIndex
        guard !legs.isEmpty, !progress.arrived, legs.indices.contains(idx) else {
            c.legIndex = max(0, legs.count - 1)
            c.phase = "arrived"
            c.status = "arrived"
            c.primaryText = "You've arrived"
            c.targetUnix = c.arrivalUnix
            c.progressFraction = 1
            return c
        }

        c.legIndex = idx
        let leg = legs[idx]
        if leg.mode == "walk" {
            fillWalking(&c, legs: legs, idx: idx, progress: progress, now: now)
        } else {
            fillTransit(&c, legs: legs, idx: idx, progress: progress, now: now)
        }
        c.progressFraction = progressFraction(idx: idx, count: legs.count, leg: leg, now: now)
        return c
    }

    // MARK: - Phases

    private static func fillWalking(_ c: inout LiveActivityContent, legs: [JourneyLeg], idx: Int, progress: LiveActivityProgress, now: Date) {
        let leg = legs[idx]
        c.phase = "walking"
        c.headsign = stopLabel(leg.toStop)
        if let d = leg.departureTime.date, let a = leg.arrivalTime.date {
            c.walkMinutes = max(1, Int((a.timeIntervalSince(d) / 60).rounded()))
        }
        if leg.distanceKm > 0 { c.walkMeters = Int((leg.distanceKm * 1000).rounded()) }

        guard let f = nextTransit(legs, after: idx) else {
            c.primaryText = leg.toStop.map { $0.stopName.isEmpty ? "Walk to your destination" : "Walk to \($0.stopName)" } ?? "Walk to your destination"
            c.secondaryText = "Arrive about \(clock(leg.arrivalTime.date))"
            c.countdownLabel = "Arrive in"
            c.targetUnix = unix(leg.arrivalTime.date) ?? c.arrivalUnix
            c.status = "onTime"
            return
        }

        let next = legs[f]
        c.routeShortName = shortName(next)
        c.routeColorHex = next.route?.routeColor ?? ""
        c.platform = platform(next)
        fillRide(&c, next, progress: progress)
        if progress.hasVehicle, let away = progress.stopsAway, away >= 0 { c.stopsAway = away }
        c.status = status(next, phase: "waiting")
        c.delayMinutes = delayMinutes(next)
        let boardAt = stopLabel(next.fromStop)
        let isFirstWalk = previousTransit(legs, before: idx) == nil

        if isFirstWalk, let leaveBy = leg.departureTime.date, now < leaveBy.addingTimeInterval(-30) {
            c.primaryText = "Leave by \(clock(leaveBy))"
            c.secondaryText = "Walk to \(boardAt) for the \(routeLabel(next))"
            c.countdownLabel = "Leave in"
            c.targetUnix = unix(leaveBy) ?? 0
            return
        }

        c.primaryText = "Walk to \(boardAt)"
        c.secondaryText = "\(routeLabel(next)) departs \(clock(next.departureTime.date))\(platformSuffix(c.platform))"
        c.countdownLabel = "Departs in"
        c.targetUnix = unix(next.departureTime.date) ?? 0

        if let p = previousTransit(legs, before: idx) {
            applyConnection(&c, legs: legs, from: p, to: f)
        }
    }

    private static func fillTransit(_ c: inout LiveActivityContent, legs: [JourneyLeg], idx: Int, progress: LiveActivityProgress, now: Date) {
        let leg = legs[idx]
        let route = routeLabel(leg)
        c.routeShortName = shortName(leg)
        c.routeColorHex = leg.route?.routeColor ?? ""
        c.headsign = stopLabel(leg.toStop)
        fillRide(&c, leg, progress: progress)

        let onboard = progress.phase == "onboard"
        if !onboard {
            c.phase = progress.phase == "boarding" || progress.stopsAway == 0 ? "boarding" : "waiting"
            c.platform = platform(leg)
            c.countdownLabel = "Departs in"
            c.targetUnix = unix(leg.departureTime.date) ?? 0
            c.delayMinutes = delayMinutes(leg)
            c.status = status(leg, phase: "waiting")
            c.primaryText = c.phase == "boarding" ? "Your \(route) is arriving" : "Board the \(route)"
            var secondary = "at \(stopLabel(leg.fromStop))\(platformSuffix(c.platform))"
            if let away = progress.stopsAway, away >= 0 {
                c.stopsAway = away
                if away > 0 { secondary += " · \(stops(away)) away" }
            }
            c.secondaryText = secondary
        } else {
            c.phase = "onboard"
            c.countdownLabel = "Arrives in"
            c.targetUnix = unix(leg.arrivalTime.date) ?? 0
            c.delayMinutes = delayMinutes(leg)
            c.status = status(leg, phase: "onboard")
            let alight = stopLabel(leg.toStop)

            if let away = progress.stopsAway, away >= 0 {
                c.stopsAway = away
                if away == 0 {
                    c.primaryText = "Get off at the next stop"
                    c.secondaryText = alight
                } else {
                    c.primaryText = "Get off at \(alight)"
                    c.secondaryText = "\(stops(away + 1)) to go"
                    if let next = progress.nextStopName, !next.isEmpty {
                        c.secondaryText += " · next \(next)"
                    }
                }
            } else {
                c.primaryText = "Get off at \(alight)"
                c.secondaryText = "Arrive \(clock(leg.arrivalTime.date))"
            }

            if let f = nextTransit(legs, after: idx) {
                applyConnection(&c, legs: legs, from: idx, to: f)
            }
        }
    }

    /// Same as the Go builder's `fillRide`: the ride you're on, or walking
    /// or waiting to catch.
    private static func fillRide(_ c: inout LiveActivityContent, _ leg: JourneyLeg, progress: LiveActivityProgress) {
        c.boardStopName = leg.fromStop?.stopName
        c.alightStopName = leg.toStop?.stopName
        c.hasVehicle = progress.hasVehicle
        if progress.hasVehicle, let next = progress.nextStopName, !next.isEmpty { c.nextStopName = next }
        if let n = progress.rideStops, n > 0 { c.rideStops = n }
        c.occupancy = progress.occupancy
    }

    /// Same rule as `JourneyTracking.connectionRisk` and the Go builder:
    /// walking in between counts against the gap, 60s is the minimum
    /// realistic change, under 90s of slack is tight.
    private static func applyConnection(_ c: inout LiveActivityContent, legs: [JourneyLeg], from: Int, to: Int) {
        let next = legs[to]
        guard let arrive = legs[from].arrivalTime.date, let depart = next.departureTime.date else { return }
        var walk: TimeInterval = 0
        for j in (from + 1)..<to where legs[j].mode == "walk" {
            if let d = legs[j].departureTime.date, let a = legs[j].arrivalTime.date { walk += a.timeIntervalSince(d) }
        }
        let transfer = depart.timeIntervalSince(arrive) - walk
        let connect = Int((transfer / 60).rounded())
        c.nextLeg = .init(routeShortName: shortName(next), routeColorHex: next.route?.routeColor ?? "", departureUnix: depart.timeIntervalSince1970, connectMinutes: connect)

        guard c.status != "cancelled" else { return }
        if transfer < 0 {
            c.status = "missedConnection"
            c.secondaryText = "You'll likely miss the \(routeLabel(next)) at \(clock(depart))"
        } else if transfer - 60 < 90 {
            c.status = "tightConnection"
            c.secondaryText = "Then \(routeLabel(next)) at \(clock(depart)) · \(connect) min to change"
        }
    }

    // MARK: - Helpers

    private static func status(_ leg: JourneyLeg, phase: String) -> String {
        let rt = leg.realtimeStatus ?? ""
        if !leg.tripUsable || rt == "canceled" || rt == "cancelled" || (phase == "waiting" && rt == "skipped") {
            return "cancelled"
        }
        let delay = leg.delaySeconds ?? 0
        if delay >= 120 { return "delayed" }
        if delay <= -120 { return "early" }
        return "onTime"
    }

    private static func delayMinutes(_ leg: JourneyLeg) -> Int {
        Int((Double(leg.delaySeconds ?? 0) / 60).rounded())
    }

    private static func progressFraction(idx: Int, count: Int, leg: JourneyLeg, now: Date) -> Double {
        var frac = 0.0
        if let d = leg.departureTime.date, let a = leg.arrivalTime.date, a > d, now > d {
            frac = min(1, now.timeIntervalSince(d) / a.timeIntervalSince(d))
        }
        return max(0, min(1, (Double(idx) + frac) / Double(count)))
    }

    private static func legChain(_ legs: [JourneyLeg]) -> [LiveActivityContent.LegChip] {
        legs.prefix(6).map { leg in
            leg.mode == "walk"
                ? .init(mode: "walk", shortName: "", colorHex: "")
                : .init(mode: "transit", shortName: shortName(leg), colorHex: leg.route?.routeColor ?? "")
        }
    }

    private static func nextTransit(_ legs: [JourneyLeg], after i: Int) -> Int? {
        legs.indices.first { $0 > i && legs[$0].mode != "walk" }
    }

    private static func previousTransit(_ legs: [JourneyLeg], before i: Int) -> Int? {
        legs.indices.last { $0 < i && legs[$0].mode != "walk" }
    }

    private static func shortName(_ leg: JourneyLeg) -> String {
        guard leg.mode != "walk" else { return "" }
        if let name = leg.route?.routeShortName, !name.isEmpty { return name }
        return leg.routeID
    }

    private static func routeLabel(_ leg: JourneyLeg) -> String {
        let name = leg.route?.routeShortName ?? ""
        return name.isEmpty ? "service" : name
    }

    private static func stopLabel(_ stop: Stop?) -> String {
        guard let stop, !stop.stopName.isEmpty else { return "your destination" }
        return stop.stopName
    }

    private static func platform(_ leg: JourneyLeg) -> String? {
        guard let p = leg.fromStop?.platformNumber, !p.isEmpty else { return nil }
        return p
    }

    private static func platformSuffix(_ platform: String?) -> String {
        platform.map { " · Platform \($0)" } ?? ""
    }

    private static func stops(_ n: Int) -> String {
        n == 1 ? "1 stop" : "\(n) stops"
    }

    private static func unix(_ date: Date?) -> Double? {
        date.map { $0.timeIntervalSince1970.rounded(.down) }
    }

    private static let clockFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Pacific/Auckland")
        f.dateFormat = "h:mma"
        return f
    }()

    /// "9:05am" - same as the Go builder's `clock`.
    static func clock(_ date: Date?) -> String {
        guard let date else { return "" }
        return clockFormatter.string(from: date).lowercased()
    }
}
