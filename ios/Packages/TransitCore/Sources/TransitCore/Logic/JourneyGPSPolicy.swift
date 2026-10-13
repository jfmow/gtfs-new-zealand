import Foundation

/// How much GPS a tracked journey needs in the background, and how often it
/// has to check in - precise GPS (and the polling and progress ticks that
/// ride along with it) is the biggest battery cost of a tracked journey.
///
/// On screen it's always precise: the map follows the rider. In the
/// background, from cheapest:
/// - `resting`: coarse cell/wifi fixes only, on a ride the live feed is
///   following well - the rider has boarded, the tracked vehicle is live
///   (not estimated from their own GPS) and its position is fresh, there's
///   a connection, and their stop is still a way off.
/// - `coarse`: still at the start, well before it's time to leave - enough
///   to see them set off (`DepartureDetector` moves 150m, good to 100m).
/// - `pedestrian`: walking or waiting - GPS, but only on moving a few
///   metres, so standing at a stop or walking costs a fix every few seconds
///   rather than every second.
/// - `precise`: on board (or boarding) without a live feed to lean on, or
///   nearing the stop - the get-off alerts and the walk after it run from
///   the rider's GPS.
public enum JourneyGPSPolicy {
    public enum Mode: Int, Sendable, Comparable {
        case resting, coarse, pedestrian, precise

        public static func < (lhs: Mode, rhs: Mode) -> Bool { lhs.rawValue < rhs.rawValue }

        /// Fixes good enough to place the rider on a walk or a ride.
        public var placesRider: Bool { self >= .pedestrian }
    }

    /// Back on this many stops before the rider's stop...
    public static let resumeStopsAway = 3
    /// ...or this long before the ride's arrival there, whichever is first.
    public static let resumeBeforeArrival: TimeInterval = 5 * 60
    /// Coarse at the start until this long before the leave time.
    public static let coarseUntilLeave: TimeInterval = 10 * 60
    /// A moment (leaving, getting on, getting off) this close puts the
    /// background back on its quick pace - see `isMomentNear`.
    public static let momentLead: TimeInterval = 5 * 60

    public static func mode(
        appActive: Bool,
        offline: Bool,
        phase: JourneyProgressModel.Phase?,
        boarded: Bool,
        trackingLevel: JourneyProgressModel.TrackingLevel,
        liveFresh: Bool,
        stopsAway: Int?,
        alightAt: Date?,
        waitingToSetOff: Bool,
        leaveAt: Date?,
        now: Date
    ) -> Mode {
        guard !appActive else { return .precise }
        if canRest(
            appActive: appActive, offline: offline, phase: phase, boarded: boarded, trackingLevel: trackingLevel,
            liveFresh: liveFresh, stopsAway: stopsAway, alightAt: alightAt, now: now
        ) { return .resting }
        if waitingToSetOff, let leaveAt, leaveAt.timeIntervalSince(now) > coarseUntilLeave { return .coarse }
        if phase == .walking || phase == .waiting { return .pedestrian }
        return .precise
    }

    public static func canRest(
        appActive: Bool,
        offline: Bool,
        phase: JourneyProgressModel.Phase?,
        boarded: Bool,
        trackingLevel: JourneyProgressModel.TrackingLevel,
        liveFresh: Bool,
        stopsAway: Int?,
        alightAt: Date?,
        now: Date
    ) -> Bool {
        guard !appActive, !offline, phase == .onboard, boarded,
              trackingLevel == .live, liveFresh,
              let stopsAway, stopsAway > resumeStopsAway,
              let alightAt, alightAt.timeIntervalSince(now) > resumeBeforeArrival
        else { return false }
        return true
    }

    /// The next journey moment is close: boarding, a few stops from getting
    /// off, or `momentLead` from `nextMomentAt` (the leave time, the next
    /// ride's departure, getting off). The background polls and works out
    /// progress at its quick pace then, and slower otherwise. Not knowing
    /// when the next moment is counts as close.
    public static func isMomentNear(
        phase: JourneyProgressModel.Phase?,
        stopsAway: Int?,
        nextMomentAt: Date?,
        now: Date
    ) -> Bool {
        if phase == .boarding { return true }
        if phase == .onboard, let stopsAway, stopsAway <= resumeStopsAway { return true }
        guard let nextMomentAt else { return true }
        return nextMomentAt.timeIntervalSince(now) <= momentLead
    }
}
