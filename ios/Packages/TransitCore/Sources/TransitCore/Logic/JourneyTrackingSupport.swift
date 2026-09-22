import Foundation

/// Small pure helpers shared by the live journey-tracking state machine -
/// ported 1:1 from `components/journey/helpers.ts` (2026-09-22).
public enum JourneyTracking {
    /// Finds a journey leg's board/alight stop within a tracked trip's own
    /// stop list, matching by id rather than sequence (`JourneyLeg`'s own
    /// `fromStop`/`toStop` sequence isn't populated by `/services/plan`).
    /// Returns the trustworthy `sequence` from the trip's stop list.
    public static func findStopSequence(in stops: [TripStopRef], for legStop: Stop?) -> Int? {
        guard let legStop else { return nil }
        return stops.first { $0.parentStopID == legStop.parentStation || $0.childStopID == legStop.stopID }?.sequence
    }

    /// Has the tracked vehicle actually pulled away from the stop at
    /// `stopSeq`?
    ///
    /// The backend's `currentStop` keeps pointing at a stop until the
    /// vehicle reaches the next one, so a strict `currentStop.sequence >
    /// stopSeq` test reports "still here" for the whole inter-stop interval
    /// after departure. This closes that gap: departed once `currentStop`
    /// is past the stop, OR `currentStop` is still the stop but `nextStop`
    /// is beyond it and the feed says the vehicle is moving ("Leaving" or
    /// "Travelling") - i.e. anything other than still dwelling there
    /// ("AtStop").
    ///
    /// Conservative at clamped boundaries / with no realtime: origin clamp
    /// (current === next === first), final clamp (current === next ===
    /// final), and state "Unknown" all return false.
    public static func hasDepartedStop(_ vehicle: Vehicle?, stopSeq: Int?) -> Bool {
        guard let trip = vehicle?.trip, let stopSeq else { return false }
        guard let current = trip.currentStop?.sequence else { return false }
        if current > stopSeq { return true }
        guard let next = trip.nextStop?.sequence else { return false }
        return current == stopSeq && next > stopSeq && (vehicle?.state == "Leaving" || vehicle?.state == "Travelling")
    }

    public struct ConnectionRisk: Equatable, Sendable {
        public enum Level: String, Sendable { case missed, tight }
        public let level: Level
        /// Minutes actually available on the platform - negative means the
        /// connecting service has already left by the time this leg's
        /// (live) departure is reached.
        public let transferMinutes: Int
    }

    /// Minimum realistic time to change services (matches the planner's own gate).
    private static let minTransferSeconds: TimeInterval = 60

    /// For the transit leg at `index`, checks whether the current (live)
    /// times still leave enough time to transfer from the previous transit
    /// leg - walking legs in between count against the gap. Returns nil for
    /// the first ride (the rider chooses when to leave) or when there's
    /// comfortable slack (>= 90s).
    public static func connectionRisk(_ legs: [JourneyLeg], at index: Int) -> ConnectionRisk? {
        guard legs.indices.contains(index), legs[index].mode == "transit" else { return nil }
        let leg = legs[index]

        var previousTransitIndex = -1
        var i = index - 1
        while i >= 0 {
            if legs[i].mode == "transit" { previousTransitIndex = i; break }
            if legs[i].mode == "walk" { i -= 1; continue }
            break
        }
        guard previousTransitIndex >= 0 else { return nil }

        var walkSeconds: TimeInterval = 0
        for j in (previousTransitIndex + 1)..<index where legs[j].mode == "walk" {
            walkSeconds += legs[j].duration.timeInterval
        }

        guard let legDeparture = leg.departureTime.date, let previousArrival = legs[previousTransitIndex].arrivalTime.date else {
            return nil
        }
        let gapSeconds = legDeparture.timeIntervalSince(previousArrival)
        let slackSeconds = gapSeconds - walkSeconds - minTransferSeconds
        guard slackSeconds < 90 else { return nil }

        let transferMinutes = Int(((gapSeconds - walkSeconds) / 60).rounded())
        return ConnectionRisk(level: slackSeconds < 0 ? .missed : .tight, transferMinutes: transferMinutes)
    }
}
