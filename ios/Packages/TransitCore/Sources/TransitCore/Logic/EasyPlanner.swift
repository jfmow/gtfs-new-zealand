import Foundation

/// A rider-facing way to travel - the `modes` planner option. The route
/// types match `travelModeRouteTypes` on the backend
/// (`providers/notifications/travel_modes.go`); "train" is anything on rails.
public enum TravelMode: String, CaseIterable, Codable, Hashable, Sendable {
    case bus, train, ferry

    public var routeTypes: Set<Int> {
        switch self {
        case .bus: [3, 11, 700, 702, 704, 711, 712, 715]
        case .train: [0, 1, 2, 5, 7, 12, 100, 101, 102, 106, 109, 400, 401, 900]
        case .ferry: [4, 1000, 1200]
        }
    }

    public init?(routeType: Int) {
        guard let mode = Self.allCases.first(where: { $0.routeTypes.contains(routeType) }) else { return nil }
        self = mode
    }

    public var label: String {
        switch self {
        case .bus: "Bus"
        case .train: "Train"
        case .ferry: "Ferry"
        }
    }

    public var systemImage: String {
        switch self {
        case .bus: "bus.fill"
        case .train: "tram.fill"
        case .ferry: "ferry.fill"
        }
    }

    /// The modes a region runs, from its route list, in `allCases` order.
    public static func available(in routes: some Sequence<Route>) -> [TravelMode] {
        let found = Set(routes.compactMap { TravelMode(routeType: $0.routeType) })
        return allCases.filter(found.contains)
    }

    /// The `modes` query value ("bus,train"); empty = any mode.
    public static func queryValue(_ modes: some Collection<TravelMode>) -> String {
        allCases.filter(modes.contains).map(\.rawValue).joined(separator: ",")
    }
}

/// Planner options for the step-by-step planner's "walk less, fewer changes"
/// answer, and the looser fallbacks tried when that finds nothing.
public struct EasyPlannerOptions: Equatable, Sendable {
    public var maxWalkKm: Double
    public var walkSpeed: Double
    public var maxTransfers: Int
    public var minTransferSec: Int

    public init(maxWalkKm: Double, walkSpeed: Double, maxTransfers: Int, minTransferSec: Int) {
        self.maxWalkKm = maxWalkKm
        self.walkSpeed = walkSpeed
        self.maxTransfers = maxTransfers
        self.minTransferSec = minTransferSec
    }

    /// A slower pace, a short walk, at most one change, two spare minutes at it.
    public static let gentle = EasyPlannerOptions(maxWalkKm: 0.6, walkSpeed: 3.6, maxTransfers: 1, minTransferSec: 120)
    /// Still a slower pace with spare change time, but the planner's usual
    /// reach - the fallback when `gentle` finds nothing.
    public static let relaxed = EasyPlannerOptions(maxWalkKm: 1.0, walkSpeed: 3.6, maxTransfers: 3, minTransferSec: 60)
    /// The full planner's defaults.
    public static let standard = EasyPlannerOptions(maxWalkKm: 1.0, walkSpeed: 4.8, maxTransfers: 5, minTransferSec: 0)
}

/// Picks the one journey to recommend to a rider who'd rather not compare
/// options. Each plan gets a "bother" score in minutes: time spent (from now,
/// or from leaving home for an arrive-by trip), plus 10 minutes per change and
/// 15 minutes per km walked. A direct bus that's a little slower beats a
/// quicker trip with a change.
public enum EasyPlanRanking {
    static let transferPenaltyMin = 10.0
    static let walkPenaltyMinPerKm = 15.0
    /// For arrive-by, a plan that gets there at least this early is preferred
    /// over one that cuts it fine.
    static let comfortableSlack: TimeInterval = 5 * 60

    /// `plans` reordered with the recommendation first, the rest by departure.
    /// `arriveBy` is the arrive-by target, nil for "as soon as I can".
    public static func ranked(_ plans: [JourneyPlan], arriveBy: Date?, now: Date = Date()) -> [JourneyPlan] {
        guard let best = recommended(plans, arriveBy: arriveBy, now: now) else { return plans }
        let rest = plans.filter { $0.id != best.id }.sorted {
            ($0.departureTime.date ?? .distantPast) < ($1.departureTime.date ?? .distantPast)
        }
        return [best] + rest
    }

    public static func recommended(_ plans: [JourneyPlan], arriveBy: Date?, now: Date = Date()) -> JourneyPlan? {
        var pool = plans
        if let arriveBy {
            let onTime = plans.filter { ($0.arrivalTime.date ?? .distantFuture) <= arriveBy }
            let comfortable = onTime.filter { ($0.arrivalTime.date ?? .distantFuture) <= arriveBy.addingTimeInterval(-comfortableSlack) }
            pool = !comfortable.isEmpty ? comfortable : (!onTime.isEmpty ? onTime : plans)
        }
        return pool.min { score($0, arriveBy: arriveBy, now: now) < score($1, arriveBy: arriveBy, now: now) }
    }

    static func score(_ plan: JourneyPlan, arriveBy: Date?, now: Date) -> Double {
        let departure = plan.departureTime.date ?? now
        let arrival = plan.arrivalTime.date ?? departure
        // Arrive-by: the time from leaving home to the target (an early arrival
        // is time spent waiting). Otherwise: how soon they get there.
        let minutes = arriveBy.map { $0.timeIntervalSince(departure) } ?? arrival.timeIntervalSince(now)
        let walkKm = plan.legs.reduce(0) { $1.mode == "walk" ? $0 + $1.distanceKm : $0 }
        return minutes / 60 + Double(plan.transfers) * transferPenaltyMin + walkKm * walkPenaltyMinPerKm
    }
}

/// A journey written out as numbered plain-English steps for the
/// step-by-step planner's result card.
public struct EasyJourneyStep: Equatable, Sendable {
    public enum Kind: Equatable, Sendable { case walk, ride(TravelMode?) }

    public var kind: Kind
    /// The instruction, e.g. "Catch the 70 bus at 10:01 am".
    public var headline: String
    /// Where and what next, e.g. "From Queen Street, stop 7021. Get off at
    /// Ellerslie at 10:15 am."
    public var detail: String?

    public init(kind: Kind, headline: String, detail: String? = nil) {
        self.kind = kind
        self.headline = headline
        self.detail = detail
    }

    /// The steps for `plan`. `destinationName` names the last walk (the
    /// planner's "To" label).
    public static func steps(for plan: JourneyPlan, destinationName: String) -> [EasyJourneyStep] {
        var steps: [EasyJourneyStep] = []
        for (index, leg) in plan.legs.enumerated() {
            if leg.mode == "transit" {
                steps.append(rideStep(leg))
                continue
            }
            let minutes = max(1, Int((leg.duration.timeInterval / 60).rounded()))
            // A zero-length hop between two platforms isn't worth a step.
            if leg.distanceKm < 0.02, index > 0, index < plan.legs.count - 1 { continue }
            let target: String
            if let stop = leg.toStop {
                target = stopName(stop)
            } else if index == plan.legs.count - 1 {
                target = destinationName
            } else {
                target = "the stop"
            }
            let metres = Int((leg.distanceKm * 1000 / 10).rounded()) * 10
            steps.append(EasyJourneyStep(
                kind: .walk,
                headline: "Walk \(minutes) min to \(target)",
                detail: metres > 0 ? "About \(metres) metres." + (leg.toStop.map { stopCodeSentence($0) } ?? "") : nil
            ))
        }
        return steps
    }

    static func rideStep(_ leg: JourneyLeg) -> EasyJourneyStep {
        let mode = leg.route.flatMap { TravelMode(routeType: $0.routeType) }
        let name = leg.route.map(\.routeShortName).flatMap { $0.isEmpty ? nil : $0 } ?? leg.routeID
        // A bus is known by the number on its front; a train or ferry line's
        // code (AT's "S-C", "DEV") means little, so it's only a detail.
        let vehicle: String
        switch mode {
        case .bus: vehicle = "the \(name) bus"
        case .train: vehicle = "the train"
        case .ferry: vehicle = "the ferry"
        case nil: vehicle = "the \(name)"
        }
        var headline = "Catch \(vehicle)"
        if let departure = leg.departureTime.date { headline += " at \(clock(departure))" }

        var detail: [String] = []
        if let from = leg.fromStop {
            if mode != .bus, !from.platformNumber.isEmpty {
                detail.append("From platform \(from.platformNumber) at \(stopName(from)).")
            } else {
                detail.append("From \(stopName(from))." + stopCodeSentence(from))
            }
        }
        if mode == .train || mode == .ferry, !name.isEmpty {
            detail.append("It's the \(name) line.")
        }
        if let to = leg.toStop {
            var getOff = "Get off at \(stopName(to))"
            if let arrival = leg.arrivalTime.date { getOff += " at \(clock(arrival))" }
            detail.append(getOff + ".")
        }
        return EasyJourneyStep(kind: .ride(mode), headline: headline, detail: detail.isEmpty ? nil : detail.joined(separator: " "))
    }

    static func stopName(_ stop: Stop) -> String {
        stop.stopName.trimmingCharacters(in: .whitespaces)
    }

    /// " Stop 7021." - the number on a bus stop's sign. Stations and wharves
    /// are known by name (and platform) instead.
    static func stopCodeSentence(_ stop: Stop) -> String {
        guard !stop.stopCode.isEmpty, stop.stopType.isEmpty || stop.stopType == "bus" else { return "" }
        return " Stop \(stop.stopCode)."
    }

    /// "10:01 am" in New Zealand time.
    public static func clock(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        formatter.amSymbol = "am"
        formatter.pmSymbol = "pm"
        formatter.timeZone = TimeFormatting.nzTimeZone
        formatter.locale = Locale(identifier: "en_NZ")
        return formatter.string(from: date)
    }
}
