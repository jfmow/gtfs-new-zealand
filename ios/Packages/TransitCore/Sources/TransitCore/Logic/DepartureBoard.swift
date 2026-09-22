import Foundation

/// Client-side filtering/sorting for a stop's departures board - ported from
/// `components/services/index.tsx`. The backend's `time_till_arrival` is the
/// authoritative, day-aware sort key; nothing here re-parses `arrivalTime`.
public enum DepartureBoard {
    /// Drops rows that have clearly finished being relevant (well past
    /// arrival), then sorts departed rows first, ascending `timeTillArrival`
    /// within each group - matching the web board's ordering.
    public static func filterAndSort(_ departures: [Departure]) -> [Departure] {
        let filtered = departures.filter { departure in
            let cutoff = (departure.canceled || departure.skipped) ? -20.0 : -2.0
            return departure.timeTillArrival >= cutoff
        }
        return filtered.sorted { a, b in
            if a.departed != b.departed {
                return a.departed && !b.departed
            }
            return a.timeTillArrival < b.timeTillArrival
        }
    }
}
