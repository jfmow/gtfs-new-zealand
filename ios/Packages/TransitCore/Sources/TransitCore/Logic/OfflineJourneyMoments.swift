import Foundation

/// The journey's key moments as clock times - for local notifications
/// scheduled ahead while the rider has no connection, so they still get
/// "your bus is due" / "your stop is coming up" when the server can't push
/// them, even if iOS suspends the app.
///
/// Timed from the live-adjusted plan (last realtime delay seen, or the
/// rider's own GPS on board). Keys match `JourneyAlertCenter`'s, so a
/// GPS-detected moment replaces its scheduled stand-in rather than
/// doubling up.
public enum OfflineJourneyMoments {
    public struct Moment: Equatable, Sendable {
        public let key: String
        public let date: Date
        public let title: String
        public let body: String
    }

    static let boardLeadSeconds: TimeInterval = 3 * 60
    static let alightLeadSeconds: TimeInterval = 2 * 60

    /// Moments still ahead of `now`, from the leg the rider is on.
    /// - Parameter onboard: The rider is already on the leg at
    ///   `progressLegIndex` - its boarding moment has passed.
    public static func upcoming(legs: [JourneyLeg], progressLegIndex: Int, onboard: Bool, now: Date) -> [Moment] {
        var moments: [Moment] = []
        for index in legs.indices where index >= max(0, progressLegIndex) && legs[index].mode == "transit" {
            let leg = legs[index]
            let name = routeName(leg)
            let skipBoard = onboard && index == progressLegIndex
            if !skipBoard, let departure = leg.departureTime.date {
                let stop = leg.fromStop.map { " at \($0.stopName)\($0.platformNumber.isEmpty ? "" : ", platform \($0.platformNumber)")" } ?? ""
                moments.append(Moment(
                    key: "\(leg.tripID):board-soon",
                    date: departure.addingTimeInterval(-boardLeadSeconds),
                    title: "The \(name) is due in 3 min",
                    body: "Get ready to board\(stop)."
                ))
            }
            if let arrival = leg.arrivalTime.date {
                let stop = leg.toStop.map { " at \($0.stopName)" } ?? ""
                moments.append(Moment(
                    key: "\(leg.tripID):alight-soon",
                    date: arrival.addingTimeInterval(-alightLeadSeconds),
                    title: "Your stop is coming up",
                    body: "Get ready to get off the \(name)\(stop)."
                ))
            }
        }
        return moments.filter { $0.date > now }
    }

    /// The boarding heads-up that's due right now (reached within the last
    /// minute), if any - for the in-app alert when there's no live vehicle
    /// to watch.
    public static func dueBoarding(legs: [JourneyLeg], progressLegIndex: Int, onboard: Bool, now: Date) -> Moment? {
        upcoming(legs: legs, progressLegIndex: progressLegIndex, onboard: onboard, now: now.addingTimeInterval(-60))
            .first { $0.key.hasSuffix(":board-soon") && $0.date <= now }
    }

    static func routeName(_ leg: JourneyLeg) -> String {
        if let name = leg.route?.routeShortName, !name.isEmpty { return name }
        return leg.routeID.isEmpty ? "service" : leg.routeID
    }
}
