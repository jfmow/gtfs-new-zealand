import Foundation

/// The live journey-tracking state machine - which leg the rider is on,
/// whether they've boarded, what "phase" they're in, and what to follow on
/// the map. Ported as faithfully as possible from `route-detail-sheet.tsx`
/// (2026-09-22) - the single most subtle piece of logic in the web app,
/// heavily comment-preserved here for the same reason it was there: getting
/// this wrong shows the rider the wrong leg or stops tracking prematurely.
///
/// This is a class, not a pure function, because two pieces of state are
/// genuinely a ratchet/hysteresis carried across ticks (matching the web
/// version's two `useEffect`s): `alightedThroughLeg` only ever moves
/// forward, and `atBoardStop` only flips on crossing enter/exit thresholds,
/// not a single distance check. Call `update(...)` once per tick (e.g. every
/// poll); it mutates that state and returns an immutable `Snapshot` of
/// everything the UI needs.
public final class JourneyProgressModel {
    public private(set) var alightedThroughLeg: Int = -1
    public private(set) var atBoardStop: Bool = false

    public init() {}

    // How far past its delay-adjusted departure the earliest pending transit
    // leg must be - while still showing no live vehicle - before tracking is
    // allowed to skip ahead to a later leg that does have one.
    private static let overdueSkipSeconds: TimeInterval = 5 * 60
    // Hysteresis for "the rider is standing at the boarding stop, waiting" -
    // enter within ENTER metres, only drop back out past EXIT metres so a
    // jittery GPS fix at the boundary doesn't flip state back and forth.
    private static let atStopEnterMeters: Double = 40
    private static let atStopExitMeters: Double = 120
    // How close to a transit leg's departure counts as "boarding" rather
    // than "waiting" when there's no usable live vehicle position.
    private static let boardingWindowSeconds: TimeInterval = 90
    // How long past a transit leg's own (live-adjusted) arrival to keep
    // treating it as "still might be riding it" when there's no GPS
    // confirmation either way. Deliberately generous: understating it is
    // what let a walking leg go "current" while the rider was still on the
    // train (see the memory note this fixed on 2026-09-16).
    private static let alightGraceSeconds: TimeInterval = 3 * 60
    // Board-proximity thresholds for the boarding phase - buses are
    // request-stop, so the rider needs real lead time; trains/ferries always
    // stop, so they use a tighter one.
    private static let nearAlightMeters: Double = 220
    private static let nearBoardBusMeters: Double = 350

    public enum Phase: String, Sendable { case walking, waiting, boarding, onboard }
    public enum TrackingLevel: String, Sendable { case live, predicted, scheduled }

    public struct Snapshot: Sendable {
        /// The first leg (of the live-adjusted plan) whose arrival is still
        /// in the future - purely clock-based, unguarded.
        public let currentLegIndex: Int
        /// The earliest transit leg the rider could still plausibly be
        /// riding - gates advancing past it until there's real signal
        /// they've got off (or it's been silent long enough to assume so).
        public let transitFloor: Int
        /// The rider-facing "which leg are they on" index: `currentLegIndex`
        /// clamped so it can't run ahead of `transitFloor` or fall behind a
        /// confirmed alighting.
        public let guardedLegIndex: Int
        /// The transit leg to track - always in journey order; only skips
        /// ahead to a later leg with live data if the earliest pending one
        /// is well overdue and still has none.
        public let activeTransitLegIndex: Int?
        /// Set only once there's a *live vehicle* for the active transit leg.
        public let trackedTripID: String?
        /// Has the tracked vehicle already left the rider's boarding stop?
        public let boarded: Bool
        /// Physically at the boarding stop, vehicle not yet departed it.
        public let waitingAtStop: Bool
        /// Stops remaining to whichever end of the ride is still ahead (the
        /// board stop until reached, the alight stop after) - nil unless the
        /// vehicle's state is confirmed and both ends are known.
        public let trackedStopsAway: Int?
        public let phase: Phase?
        public let trackingLevel: TrackingLevel
        /// True once the whole journey (not just this leg) reads as done -
        /// requires `transitFloor` to agree every transit leg is finished,
        /// not just the clock.
        public let journeyArrived: Bool
        /// -1 before the journey starts, `legs.count` once arrived,
        /// otherwise `guardedLegIndex` - the index views should actually
        /// render as "current".
        public let progressLegIndex: Int
        /// Map marker id to follow (`"vehicle-<tripId>"`), or nil to follow
        /// the rider instead (still walking) or nothing (not tracking).
        public let followMarkerID: String?
        /// While waiting at the stop for the tracked vehicle, frame the
        /// vehicle and this stop together rather than just the vehicle.
        public let followFitWithStop: Coordinate?
        public let riderWalking: Bool
    }

    /// Advances the state machine by one tick.
    ///
    /// - Parameters:
    ///   - plan: The original plan as fetched/reopened (server-side
    ///     realtime-adjusted, but not re-shifted by client-polled stop-times).
    ///   - displayPlan: `plan` run through
    ///     `JourneyPlanLiveAdjuster.buildLiveJourney` with the latest polled
    ///     stop-times - what's shown on screen.
    ///   - trackedStops: The currently-tracked trip's own stop list (from
    ///     `GET /stops/{tripId}`), for matching board/alight stops to a
    ///     trustworthy sequence number. Keyed to whichever trip the
    ///     *previous* tick reported as tracked, same one-tick fetch lag the
    ///     web version has (its data hook is equally async).
    ///
    /// One-tick lag, faithfully ported: `alightedThroughLeg`/`atBoardStop`
    /// are updated partway through this call (mirroring the two source
    /// `useEffect`s, which run *after* a render and schedule another one) -
    /// so on the very tick a ratchet/hysteresis transition first fires,
    /// `transitFloor`/`waitingAtStop` here still reflect the *pre*-mutation
    /// value, exactly as the web version's `transitFloor`/`waitingAtStop`
    /// still read that render's stale state before the effect-driven
    /// re-render catches up. It settles on the next call - harmless for a
    /// value polled every ~10s, imperceptible to the rider - so callers
    /// should not read this as a bug to "fix" by reordering.
    public func update(
        plan: JourneyPlan,
        displayPlan: JourneyPlan,
        now: Date,
        vehiclesByTripID: [String: Vehicle],
        stopTimesByTripID: [String: [StopTimeUpdate]],
        journeyStarted: Bool,
        trackedStops: [TripStopRef],
        userLocation: Coordinate?
    ) -> Snapshot {
        let legs = plan.legs
        let displayLegs = displayPlan.legs

        let currentLegIndex = Self.computeCurrentLegIndex(displayLegs: displayLegs, now: now)
        let transitFloor = Self.computeTransitFloor(
            legs: legs, displayLegs: displayLegs, alightedThroughLeg: alightedThroughLeg,
            vehiclesByTripID: vehiclesByTripID, now: now
        )
        let guardedLegIndex = min(max(currentLegIndex, alightedThroughLeg + 1), transitFloor)
        let activeTransitLegIndex = Self.computeActiveTransitLegIndex(
            legs: legs, currentLegIndex: currentLegIndex, transitFloor: transitFloor,
            vehiclesByTripID: vehiclesByTripID, now: now
        )

        let trackedTripID: String? = {
            guard journeyStarted, let idx = activeTransitLegIndex else { return nil }
            let tripID = legs[idx].tripID
            return vehiclesByTripID[tripID] != nil ? tripID : nil
        }()
        let trackedVehicle = trackedTripID.flatMap { vehiclesByTripID[$0] }

        let trackedLegIndex: Int? = {
            if let tripID = trackedTripID, let idx = legs.firstIndex(where: { $0.tripID == tripID }) { return idx }
            return journeyStarted ? activeTransitLegIndex : nil
        }()
        let trackedLeg = trackedLegIndex.map { legs[$0] }
        let trackedBoardStop = trackedLeg?.fromStop
        let trackedAlightStop = trackedLeg?.toStop

        let trackedBoardSeq = JourneyTracking.findStopSequence(in: trackedStops, for: trackedBoardStop)
        let trackedAlightSeq = JourneyTracking.findStopSequence(in: trackedStops, for: trackedAlightStop)
        let boarded = JourneyTracking.hasDepartedStop(trackedVehicle, stopSeq: trackedBoardSeq)
        let waitingAtStop = atBoardStop && !boarded

        // Ratchet: once the tracked vehicle has carried the rider past their
        // alight stop, latch it - never runs backwards.
        if journeyStarted, let idx = trackedLegIndex, let alightSeq = trackedAlightSeq,
           JourneyTracking.hasDepartedStop(trackedVehicle, stopSeq: alightSeq) {
            alightedThroughLeg = max(alightedThroughLeg, idx)
        }

        updateAtBoardStopHysteresis(journeyStarted: journeyStarted, boardStop: trackedBoardStop, userLocation: userLocation)

        let trackedTargetSeq = boarded ? trackedAlightSeq : trackedBoardSeq
        let trackedNextSeq = trackedVehicle?.trip?.nextStop?.sequence
        let trackedStopsAway: Int? = {
            guard let trackedVehicle, trackedVehicle.state != "Unknown",
                  let target = trackedTargetSeq, let next = trackedNextSeq else { return nil }
            return max(0, target - next)
        }()

        let journeyArrived: Bool = {
            guard journeyStarted, let lastLeg = displayLegs.last, currentLegIndex == displayLegs.count - 1,
                  transitFloor >= displayLegs.count, let arrival = lastLeg.arrivalTime.date
            else { return false }
            return now >= arrival
        }()
        let progressLegIndex = !journeyStarted ? -1 : (journeyArrived ? displayLegs.count : guardedLegIndex)
        let activeLeg: JourneyLeg? = displayLegs.indices.contains(progressLegIndex) ? displayLegs[progressLegIndex] : nil

        let phase = Self.computePhase(
            journeyStarted: journeyStarted, activeLeg: activeLeg, boarded: boarded, waitingAtStop: waitingAtStop,
            trackedVehicle: trackedVehicle, trackedBoardStop: trackedBoardStop, trackedBoardSeq: trackedBoardSeq, now: now
        )

        let trackingLevel: TrackingLevel = {
            if trackedVehicle != nil { return .live }
            if let idx = activeTransitLegIndex, !(stopTimesByTripID[legs[idx].tripID] ?? []).isEmpty { return .predicted }
            return .scheduled
        }()

        let guardedLeg: JourneyLeg? = displayLegs.indices.contains(guardedLegIndex) ? displayLegs[guardedLegIndex] : nil
        let riderWalking = journeyStarted && guardedLeg?.mode == "walk" && !waitingAtStop && !boarded
        let followMarkerID: String? = (trackedVehicle != nil && !riderWalking) ? "vehicle-\(trackedVehicle!.tripID)" : nil
        let followFitWithStop: Coordinate? = (followMarkerID != nil && waitingAtStop) ? trackedBoardStop?.coordinate : nil

        return Snapshot(
            currentLegIndex: currentLegIndex, transitFloor: transitFloor, guardedLegIndex: guardedLegIndex,
            activeTransitLegIndex: activeTransitLegIndex, trackedTripID: trackedTripID, boarded: boarded,
            waitingAtStop: waitingAtStop, trackedStopsAway: trackedStopsAway, phase: phase,
            trackingLevel: trackingLevel, journeyArrived: journeyArrived, progressLegIndex: progressLegIndex,
            followMarkerID: followMarkerID, followFitWithStop: followFitWithStop, riderWalking: riderWalking
        )
    }

    // MARK: - Step helpers (each mirrors one `useMemo` in the source)

    private static func computeCurrentLegIndex(displayLegs: [JourneyLeg], now: Date) -> Int {
        for (i, leg) in displayLegs.enumerated() {
            if let arrival = leg.arrivalTime.date, now < arrival { return i }
        }
        return max(0, displayLegs.count - 1)
    }

    private static func computeTransitFloor(
        legs: [JourneyLeg], displayLegs: [JourneyLeg], alightedThroughLeg: Int,
        vehiclesByTripID: [String: Vehicle], now: Date
    ) -> Int {
        let start = max(0, alightedThroughLeg + 1)
        guard start < legs.count else { return legs.count }
        for i in start..<legs.count {
            let leg = legs[i]
            guard leg.mode == "transit" else { continue }
            if vehiclesByTripID[leg.tripID] != nil { return i }
            let displayLeg = i < displayLegs.count ? displayLegs[i] : leg
            if let arrival = displayLeg.arrivalTime.date, now.timeIntervalSince(arrival) <= alightGraceSeconds {
                return i
            }
            // No vehicle and well past its predicted arrival - assume this
            // leg is over even without GPS confirmation, keep looking.
        }
        return legs.count
    }

    private static func computeActiveTransitLegIndex(
        legs: [JourneyLeg], currentLegIndex: Int, transitFloor: Int,
        vehiclesByTripID: [String: Vehicle], now: Date
    ) -> Int? {
        guard currentLegIndex >= 0 else { return nil }
        let upcoming = legs.indices.filter { $0 >= transitFloor && legs[$0].mode == "transit" }
        guard let firstIndex = upcoming.first else { return nil }
        let first = legs[firstIndex]
        if vehiclesByTripID[first.tripID] == nil, let firstDeparture = first.departureTime.date,
           now.timeIntervalSince(firstDeparture) > overdueSkipSeconds {
            if let liveIndex = upcoming.first(where: { vehiclesByTripID[legs[$0].tripID] != nil }) {
                return liveIndex
            }
        }
        return firstIndex
    }

    private static func computePhase(
        journeyStarted: Bool, activeLeg: JourneyLeg?, boarded: Bool, waitingAtStop: Bool,
        trackedVehicle: Vehicle?, trackedBoardStop: Stop?, trackedBoardSeq: Int?, now: Date
    ) -> Phase? {
        guard journeyStarted, let activeLeg else { return nil }
        if activeLeg.mode == "walk" { return waitingAtStop ? .waiting : .walking }
        if boarded { return .onboard }

        let trackedCurrentSeq = trackedVehicle?.trip?.currentStop?.sequence
        if let trackedVehicle, trackedVehicle.state != "Unknown", let boardSeq = trackedBoardSeq, let currentSeq = trackedCurrentSeq {
            let nextSeq = trackedVehicle.trip?.nextStop?.sequence
            let nextIsBoard = nextSeq != nil && nextSeq == boardSeq
            let atOrPastBoard = currentSeq >= boardSeq
            let metresToBoard: Double = trackedBoardStop.map { Geo.haversineDistanceMeters(trackedVehicle.position.coordinate, $0.coordinate) } ?? .infinity
            let threshold = boardProximityThreshold(for: trackedVehicle.type)
            let atBoard = (nextIsBoard && metresToBoard <= threshold) || atOrPastBoard
            return atBoard ? .boarding : .waiting
        }

        // No usable live position - fall back to the schedule.
        guard let departure = activeLeg.departureTime.date else { return .waiting }
        return departure.timeIntervalSince(now) <= boardingWindowSeconds ? .boarding : .waiting
    }

    /// Board-proximity threshold for a vehicle of this type - buses (and
    /// school buses) are request-stop, so need real lead time; everything
    /// else always stops, so uses the tighter alight-proximity distance.
    public static func boardProximityThreshold(for vehicleType: String) -> Double {
        vehicleType == "bus" || vehicleType == "school bus" ? nearBoardBusMeters : nearAlightMeters
    }

    private func updateAtBoardStopHysteresis(journeyStarted: Bool, boardStop: Stop?, userLocation: Coordinate?) {
        guard journeyStarted, let boardStop, let userLocation else {
            atBoardStop = false
            return
        }
        let distance = Geo.haversineDistanceMeters(userLocation, boardStop.coordinate)
        atBoardStop = atBoardStop ? (distance < Self.atStopExitMeters) : (distance <= Self.atStopEnterMeters)
    }

    /// Resets all ratcheted/hysteresis state - call when starting to track a
    /// different journey (a fresh `JourneyProgressModel` per journey also
    /// works; this exists for view models that reuse one instance).
    public func reset() {
        alightedThroughLeg = -1
        atBoardStop = false
    }
}
