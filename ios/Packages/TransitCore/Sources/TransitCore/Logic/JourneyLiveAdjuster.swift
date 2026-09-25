import Foundation

/// Shifts a `JourneyPlan`'s leg times to realtime predictions - ported 1:1
/// from `components/journey/helpers.ts`'s `buildLiveJourney` (2026-09-22).
public enum JourneyPlanLiveAdjuster {
    /// Returns a copy of `plan` with each transit leg's departure/arrival (and
    /// the plan-level totals) shifted to `realtime/stop-times` predictions
    /// where available. Walk legs are re-anchored to their adjacent transit
    /// leg (their own duration is fixed); waits fall out of the shifted
    /// times. Returns `plan` unchanged if nothing usable is available.
    public static func buildLiveJourney(_ plan: JourneyPlan, stopTimesByTripID: [String: [StopTimeUpdate]]) -> JourneyPlan {
        guard !stopTimesByTripID.isEmpty else { return plan }

        var legs = plan.legs
        var changed = false

        for i in legs.indices {
            let leg = legs[i]
            guard leg.mode == "transit", !leg.tripID.isEmpty,
                  let stopTimes = stopTimesByTripID[leg.tripID]
            else { continue }

            let boardTargetMs = leg.departureTime.date.map { $0.timeIntervalSince1970 * 1000 } ?? 0
            let alightTargetMs = leg.arrivalTime.date.map { $0.timeIntervalSince1970 * 1000 } ?? 0
            guard let board = stopTimeFor(stopTimes, legStop: leg.fromStop, targetMs: boardTargetMs),
                  let alight = stopTimeFor(stopTimes, legStop: leg.toStop, targetMs: alightTargetMs),
                  board.departureTime.milliseconds != 0, alight.arrivalTime.milliseconds != 0
            else { continue }

            let departDate = board.departureTime.date
            let arriveMillis = max(alight.arrivalTime.milliseconds, board.departureTime.milliseconds)
            let arriveDate = Date(timeIntervalSince1970: Double(arriveMillis) / 1000)

            legs[i].departureTime = GoTime(date: departDate)
            legs[i].arrivalTime = GoTime(date: arriveDate)
            legs[i].duration = GoDuration(nanoseconds: Int64((arriveDate.timeIntervalSince1970 - departDate.timeIntervalSince1970) * 1_000_000_000))

            if alight.scheduledTime.milliseconds != 0 {
                let delaySeconds = Int(((Double(alight.arrivalTime.milliseconds) - Double(alight.scheduledTime.milliseconds)) / 1000).rounded())
                legs[i].delaySeconds = delaySeconds
                legs[i].realtimeStatus = delaySeconds > 60 ? "delayed" : (delaySeconds < -60 ? "early" : "on_time")
            }
            changed = true
        }

        guard changed else { return plan }

        // Re-anchor walk legs (fixed duration) to their transit neighbour.
        let originalLegs = plan.legs
        for i in legs.indices where legs[i].mode == "walk" {
            let durationSeconds = originalLegs[i].duration.timeInterval
            if i + 1 < legs.count, legs[i + 1].mode == "transit", let nextDeparture = legs[i + 1].departureTime.date {
                // Leading walk: land ~2 min before the train (matches the
                // backend's deferOriginWalk), not the instant it leaves. A
                // transfer walk stays tight so the buffer can't overlap the
                // previous leg.
                let buffer: TimeInterval = i == 0 ? 120 : 0
                let arrive = nextDeparture.addingTimeInterval(-buffer)
                legs[i].arrivalTime = GoTime(date: arrive)
                legs[i].departureTime = GoTime(date: arrive.addingTimeInterval(-durationSeconds))
            } else if i - 1 >= 0, legs[i - 1].mode == "transit", let prevArrival = legs[i - 1].arrivalTime.date {
                legs[i].departureTime = GoTime(date: prevArrival)
                legs[i].arrivalTime = GoTime(date: prevArrival.addingTimeInterval(durationSeconds))
            }
        }

        guard let firstDeparture = legs.first?.departureTime.date, let lastArrival = legs.last?.arrivalTime.date else {
            return plan
        }

        var updated = plan
        updated.legs = legs
        updated.departureTime = GoTime(date: firstDeparture)
        updated.arrivalTime = GoTime(date: lastArrival)
        updated.totalDuration = GoDuration(nanoseconds: Int64((lastArrival.timeIntervalSince1970 - firstDeparture.timeIntervalSince1970) * 1_000_000_000))
        return updated
    }

    /// A trip can visit the same stop/station twice (line reversals) - picks
    /// the occurrence whose time is closest to the plan leg's own time for
    /// this stop, matching by child stop id, then parent station, then a
    /// (rarer) direct parent-to-parent match.
    private static func stopTimeFor(_ stopTimes: [StopTimeUpdate], legStop: Stop?, targetMs: Double) -> StopTimeUpdate? {
        guard let legStop else { return nil }
        let matches = stopTimes.filter {
            $0.childStopID == legStop.stopID
                || (!legStop.parentStation.isEmpty && $0.parentStopID == legStop.parentStation)
                || $0.parentStopID == legStop.stopID
        }
        if matches.count <= 1 { return matches.first }

        func time(_ s: StopTimeUpdate) -> Int64 {
            if s.scheduledTime.milliseconds != 0 { return s.scheduledTime.milliseconds }
            if s.arrivalTime.milliseconds != 0 { return s.arrivalTime.milliseconds }
            return s.departureTime.milliseconds
        }
        return matches.min { abs(Double(time($0)) - targetMs) < abs(Double(time($1)) - targetMs) }
    }
}
