import Foundation

/// Notices the rider setting off on a journey's first walk, from their GPS.
///
/// Until then the leave time follows the first ride's live departure (a
/// ride running early moves it earlier, and the rider needs telling). From
/// then on it's history: the walk runs from when they actually left, and a
/// ride that moves changes how much time they have spare - not when they
/// "should" leave (2026-10-02: the tracker kept moving the leave time of a
/// rider already halfway to the station).
///
/// Set off is any of, with a fix good to `maxAccuracyMeters`:
/// - seen at the start, then `moveMeters` away from it;
/// - `moveMeters` closer to the stop than when tracking began (the journey
///   was planned from somewhere else, or tracking started mid-walk);
/// - at the stop.
///
/// Once set it never clears - mirrored by the server (`left_unix` sticks).
public struct DepartureDetector: Equatable, Sendable {
    public private(set) var setOffAt: Date?
    private var startDistanceToStop: Double?
    private var lastAtStart: Date?

    static let moveMeters: Double = 150
    static let atStartMeters: Double = 100
    static let atStopMeters: Double = 40
    static let maxAccuracyMeters: Double = 100
    /// Back-dating "left" to the last fix at the start only goes back this
    /// far - past it, the app was suspended in between and that fix says
    /// little about when they actually went.
    static let backdateLimit: TimeInterval = 5 * 60

    public init(setOffAt: Date? = nil) {
        self.setOffAt = setOffAt
    }

    /// Feeds one GPS fix. Returns when the rider set off, once they have.
    @discardableResult
    public mutating func update(start: Coordinate, boardStop: Coordinate, location: Coordinate?, accuracy: Double?, at time: Date) -> Date? {
        if let setOffAt { return setOffAt }
        guard let location, (accuracy ?? 0) <= Self.maxAccuracyMeters else { return nil }

        let fromStart = Geo.haversineDistanceMeters(location, start)
        let toStop = Geo.haversineDistanceMeters(location, boardStop)
        if startDistanceToStop == nil { startDistanceToStop = toStop }
        if fromStart <= Self.atStartMeters { lastAtStart = time }

        let leftStart = lastAtStart != nil && fromStart >= Self.moveMeters
        let closer = (startDistanceToStop ?? toStop) - toStop >= Self.moveMeters
        guard leftStart || closer || toStop <= Self.atStopMeters else { return nil }

        if let lastAtStart, time.timeIntervalSince(lastAtStart) <= Self.backdateLimit {
            setOffAt = lastAtStart
        } else {
            setOffAt = time
        }
        return setOffAt
    }
}
