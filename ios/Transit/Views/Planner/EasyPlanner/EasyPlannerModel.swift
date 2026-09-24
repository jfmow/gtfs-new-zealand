import Foundation
import TransitCore

/// The step-by-step planner's answers and results. The mode answer and the
/// "where I am now" start are remembered for next time; the destination and
/// time are asked fresh.
@MainActor
@Observable
final class EasyPlannerModel {
    enum When: Hashable { case soon, arriveBy }
    enum StartChoice: Hashable { case here, elsewhere }
    enum Step: Hashable {
        case mode, time, start, results
        /// The full journey screen for one result ("See full details").
        case details(JourneyPlan)
        /// Live tracking, after "Start this journey".
        case track(JourneyPlan)
    }

    enum Status: Equatable {
        case idle
        case planning
        case found
        /// Nothing found, or the request failed - `message` says which.
        case failed(message: String)
    }

    // Question 1
    var destination: PlannerLocation?
    // Question 2
    var modes: Set<TravelMode> { didSet { remember() } }
    var walkLess: Bool { didSet { remember() } }
    // Question 3
    var when: When = .soon
    var arriveBy: Date = EasyPlannerModel.defaultArriveBy()
    // Question 4
    var startChoice: StartChoice { didSet { remember() } }
    var otherStart: PlannerLocation?

    // Results
    var status: Status = .idle
    var plans: [JourneyPlan] = []
    /// The start the results were planned from (a resolved "where I am now").
    var plannedStart: PlannerLocation?
    /// Said above the results when a looser search found them, e.g. "There's
    /// no way by train only, so this uses any transport."
    var fallbackNote: String?
    /// The options the shown results were planned with - reminders and saved
    /// trips reuse them.
    var plannedModes: Set<TravelMode> = []
    var plannedOptions: EasyPlannerOptions = .gentle

    var availableModes: [TravelMode] = TravelMode.allCases

    private static let modesKey = "easyPlanner.modes"
    private static let walkLessKey = "easyPlanner.walkLess"
    private static let startHereKey = "easyPlanner.startHere"

    init() {
        let defaults = UserDefaults.standard
        modes = Set((defaults.stringArray(forKey: Self.modesKey) ?? []).compactMap(TravelMode.init(rawValue:)))
        walkLess = defaults.object(forKey: Self.walkLessKey) as? Bool ?? true
        startChoice = (defaults.object(forKey: Self.startHereKey) as? Bool ?? true) ? .here : .elsewhere
    }

    private func remember() {
        let defaults = UserDefaults.standard
        defaults.set(TravelMode.allCases.filter(modes.contains).map(\.rawValue), forKey: Self.modesKey)
        defaults.set(walkLess, forKey: Self.walkLessKey)
        defaults.set(startChoice == .here, forKey: Self.startHereKey)
    }

    /// Clears this journey's answers and results; the remembered mode and
    /// start choices stay.
    func reset() {
        destination = nil
        when = .soon
        arriveBy = Self.defaultArriveBy()
        otherStart = nil
        status = .idle
        plans = []
        plannedStart = nil
        fallbackNote = nil
    }

    /// An hour from now, on the next quarter hour.
    static func defaultArriveBy(now: Date = Date()) -> Date {
        let quarter: TimeInterval = 15 * 60
        let later = now.addingTimeInterval(60 * 60)
        return Date(timeIntervalSinceReferenceDate: (later.timeIntervalSinceReferenceDate / quarter).rounded(.up) * quarter)
    }

    /// Only offer the ways to travel this region actually runs.
    func loadAvailableModes(api: APIClient) async {
        guard let routes = try? await api.routes() else { return }
        let found = TravelMode.available(in: routes.values)
        guard !found.isEmpty else { return }
        availableModes = found
        modes.formIntersection(found)
    }

    var modesSummary: String {
        let chosen = TravelMode.allCases.filter(modes.contains).map { $0.label.lowercased() }
        guard !chosen.isEmpty else { return "any transport" }
        return chosen.count == 1 ? "\(chosen[0]) only" : chosen.dropLast().joined(separator: ", ") + " or " + chosen.last!
    }

    var searchContext: PlannerSearchContext {
        PlannerSearchContext(
            start: plannedStart, end: destination, arriveBy: when == .arriveBy,
            maxWalkKm: plannedOptions.maxWalkKm, walkSpeed: plannedOptions.walkSpeed,
            maxTransfers: plannedOptions.maxTransfers, onlyRoutes: [],
            modes: plannedModes, minTransferSec: plannedOptions.minTransferSec
        )
    }

    // MARK: - Planning

    /// Plans with the rider's answers. When that finds nothing it tries
    /// again - more walking and changes, then any transport - and says what
    /// it changed, rather than leaving them at a dead end.
    func plan(environment: AppEnvironment) async {
        guard let destination else { return }
        status = .planning
        plans = []
        fallbackNote = nil

        let start: PlannerLocation
        if startChoice == .here {
            guard let here = await currentLocation(environment: environment) else {
                status = .failed(message: "We couldn't find where you are. Check that Location is turned on for this app in Settings, or choose \"Somewhere else\".")
                return
            }
            start = here
        } else {
            guard let otherStart else { return }
            start = otherStart
        }
        plannedStart = start

        var attempts: [(modes: Set<TravelMode>, options: EasyPlannerOptions, note: String?)] = [
            (modes, walkLess ? .gentle : .standard, nil),
        ]
        if walkLess {
            attempts.append((modes, .relaxed, "To find a way, this one has a bit more walking or an extra change."))
        }
        if !modes.isEmpty {
            attempts.append(([], walkLess ? .relaxed : .standard, "There's no way by \(modesSummary), so this uses any transport."))
        }

        var lastError: String?
        for attempt in attempts {
            let request = JourneyPlanRequest(
                start: start.coordinate, end: destination.coordinate,
                date: when == .arriveBy ? arriveBy : Date(),
                timeType: when == .arriveBy ? .arriveat : .now,
                maxWalkKm: attempt.options.maxWalkKm, walkSpeed: attempt.options.walkSpeed,
                maxTransfers: attempt.options.maxTransfers, minResults: 3,
                modes: attempt.modes, minTransferSec: attempt.options.minTransferSec
            )
            do {
                let found = JourneyPlanRanking.pruneDominatedPlans(try await environment.api.planJourney(request))
                guard !found.isEmpty else { continue }
                plans = EasyPlanRanking.ranked(found, arriveBy: when == .arriveBy ? arriveBy : nil)
                plannedModes = attempt.modes
                plannedOptions = attempt.options
                fallbackNote = attempt.note
                status = .found
                return
            } catch APIError.server {
                // The planner answered, with "no journey found" (sent as a
                // 500 with the reason) - try the next, looser search.
                continue
            } catch {
                lastError = "We couldn't reach the journey planner. Check your internet connection and try again."
                break
            }
        }
        status = .failed(message: lastError ?? "We couldn't find a way to get there at that time.")
    }

    /// Waits up to 10 seconds for a location fix, like the planner's "My
    /// location".
    private func currentLocation(environment: AppEnvironment) async -> PlannerLocation? {
        environment.location.requestPermission()
        environment.location.startUpdating()
        var coordinate = environment.location.coordinate
        var waited = 0
        while coordinate == nil && waited < 20 {
            try? await Task.sleep(for: .milliseconds(500))
            waited += 1
            coordinate = environment.location.coordinate
        }
        guard let coordinate else { return nil }
        let label = (try? await environment.api.reverseGeocode(coordinate).name) ?? "Where you are now"
        return PlannerLocation(label: label, coordinate: coordinate)
    }
}
