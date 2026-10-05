import Foundation

/// When the journey tracker can stop asking for the rider's precise GPS -
/// the biggest battery cost of a tracked journey.
///
/// GPS only rests on a ride the live feed is following well: the rider has
/// boarded, the tracked vehicle is live (not estimated from their own GPS)
/// and its position is fresh, there's a connection, and their stop is still
/// a way off. Walking, waiting, offline, a stale feed or nearing the stop
/// all need it back on - the get-off alerts and the walk after it run from
/// the rider's GPS. Only in the background: on screen the map follows them.
public enum JourneyGPSPolicy {
    /// Back on this many stops before the rider's stop...
    public static let resumeStopsAway = 3
    /// ...or this long before the ride's arrival there, whichever is first.
    public static let resumeBeforeArrival: TimeInterval = 5 * 60

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
}
