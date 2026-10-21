import Foundation

/// Client-side filtering/sorting for a stop's departures board - ported from
/// `components/services/index.tsx`. The backend's `time_till_arrival` is the
/// authoritative, day-aware sort key; nothing here re-parses `arrivalTime`.
public enum DepartureBoard {
    /// Drops rows that have clearly finished being relevant (well past
    /// arrival), then sorts departed rows first, ascending `timeTillArrival`
    /// within each group - matching the web board's ordering. A row the feed
    /// says has departed only lingers for a minute: it sorts to the top, so
    /// leaving it longer pushes what you can still catch down the board.
    public static func filterAndSort(_ departures: [Departure]) -> [Departure] {
        let filtered = departures.filter { departure in
            let cutoff = (departure.canceled || departure.skipped) ? -20.0 : departure.departed ? -1.0 : -2.0
            return departure.timeTillArrival >= cutoff
        }
        return filtered.sorted { a, b in
            if a.departed != b.departed {
                return a.departed && !b.departed
            }
            return a.timeTillArrival < b.timeTillArrival
        }
    }

    /// Two of a route arriving within this of each other, with this long a
    /// wait for the one after, are bunched.
    public static let bunchedWithinMin = 2.0
    public static let bunchedGapAfterMin = 10.0

    /// Departures running right behind another of their route (same
    /// headsign) with a long gap after - "two come at once, then nothing" -
    /// as trip id -> minutes until the next one. Live services only; the
    /// web board's `findBunched`.
    public static func bunched(_ departures: [Departure]) -> [String: Int] {
        var lines: [String: [Departure]] = [:]
        for d in departures where (d.locationTracking || d.tripUpdateTracking) && !d.canceled && !d.skipped && !d.departed {
            lines["\(d.route.id)|\(d.headsign)", default: []].append(d)
        }
        var out: [String: Int] = [:]
        for line in lines.values {
            let sorted = line.sorted { $0.timeTillArrival < $1.timeTillArrival }
            guard sorted.count >= 3 else { continue }
            for i in 1..<(sorted.count - 1) {
                let before = sorted[i].timeTillArrival - sorted[i - 1].timeTillArrival
                let after = sorted[i + 1].timeTillArrival - sorted[i].timeTillArrival
                if before <= bunchedWithinMin && after >= bunchedGapAfterMin {
                    out[sorted[i].tripID] = Int(after.rounded())
                }
            }
        }
        return out
    }
}
