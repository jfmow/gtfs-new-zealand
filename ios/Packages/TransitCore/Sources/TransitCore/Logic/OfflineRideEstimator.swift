import Foundation

/// Works out where the rider is on a ride from their own GPS, for when
/// there's no realtime feed to ask (no data, or the feed has gone quiet).
///
/// Once the rider is detected riding, their position is turned into a
/// synthetic `Vehicle` placed on the trip's own stop list - the same shape
/// the realtime feed produces - so `JourneyProgressModel` and
/// `JourneyAlertCenter` track boarding, stops-away, "your stop is next" and
/// getting off with no special cases. Before boarding there's nothing to
/// place: where the bus is can't be known offline, so that part of the
/// journey falls back to the timetable (and the last realtime delay seen).
///
/// Stateful across fixes: boarding and getting off are both latched, and
/// boarding needs two fixes in a row that agree, so one GPS jump onto the
/// road doesn't read as "on the bus".
public final class OfflineRideEstimator {
    public struct Fix: Equatable, Sendable {
        public var coordinate: Coordinate
        /// Metres per second, nil when the device didn't report one.
        public var speed: Double?
        public var timestamp: Date

        public init(coordinate: Coordinate, speed: Double?, timestamp: Date) {
            self.coordinate = coordinate
            self.speed = speed
            self.timestamp = timestamp
        }
    }

    /// Faster than anyone walks - with the rest of the boarding checks, the
    /// rider is moving with the vehicle.
    static let ridingSpeed: Double = 4.5
    /// Slower than any vehicle in traffic - walking away from the stop.
    static let walkingSpeed: Double = 3
    /// How far past the boarding stop, along the route, before the rider
    /// counts as having left on the vehicle.
    static let boardedPastMeters: Double = 150
    /// Further from the line through the trip's stops than this and the
    /// rider isn't on it. Generous: stops are straight-line joined, and
    /// roads curve between them.
    static let onRouteMeters: Double = 150
    /// Within this of a stop counts as being at it.
    static let atStopMeters: Double = 40
    /// Boarding can't be detected more than this before the (predicted)
    /// departure - the rider walking along the route to the stop early.
    static let earlyBoardingSeconds: TimeInterval = 180

    private struct RideState {
        var boarded = false
        var alighted = false
        var boardingEvidence = 0
        var reachedAlight = false
        var lastFix: Fix?
        var lastSpeed: Double?
        /// When the rider was last at (or passed) each stop, by sequence.
        var passedAt: [Int: Date] = [:]
        /// The segment the rider was last on - once riding, they only move
        /// forward, so a route that doubles back near itself can't make
        /// them jump ahead.
        var segment = 0
    }

    private var rides: [String: RideState] = [:]

    /// What's been worked out about a ride so far - saved with the journey,
    /// so a relaunch mid-ride (or after getting off) doesn't forget it.
    public struct Progress: Codable, Equatable, Sendable {
        public var boarded: Bool
        public var alighted: Bool
        public var reachedAlight: Bool
        public var segment: Int
    }

    public var progress: [String: Progress] {
        rides.mapValues { Progress(boarded: $0.boarded, alighted: $0.alighted, reachedAlight: $0.reachedAlight, segment: $0.segment) }
            .filter { $0.value.boarded }
    }

    public func restore(_ progress: [String: Progress]) {
        for (tripID, saved) in progress {
            var state = rides[tripID] ?? RideState()
            state.boarded = state.boarded || saved.boarded
            state.alighted = state.alighted || saved.alighted
            state.reachedAlight = state.reachedAlight || saved.reachedAlight
            state.segment = max(state.segment, saved.segment)
            rides[tripID] = state
        }
    }

    public init() {}

    public func hasBoarded(tripID: String) -> Bool { rides[tripID]?.boarded ?? false }
    public func hasAlighted(tripID: String) -> Bool { rides[tripID]?.alighted ?? false }

    public func reset() { rides = [:] }

    /// Advances one ride's state with a new fix and returns the synthetic
    /// vehicle for it - nil until the rider is detected on board.
    ///
    /// - Parameters:
    ///   - stops: The trip's own stop list (`GET /stops/{tripId}`), cached
    ///     while online.
    ///   - departure: The leg's (live-adjusted) departure from the boarding stop.
    public func estimate(leg: JourneyLeg, stops: [TripStopRef], fix: Fix?, departure: Date?, now: Date) -> Vehicle? {
        let tripID = leg.tripID
        guard !tripID.isEmpty,
              let boardSeq = JourneyTracking.findStopSequence(in: stops, for: leg.fromStop),
              let alightSeq = JourneyTracking.findStopSequence(in: stops, for: leg.toStop, after: boardSeq)
        else { return nil }
        let ride = stops.filter { $0.sequence >= boardSeq && $0.sequence <= alightSeq }.sorted { $0.sequence < $1.sequence }
        guard ride.count >= 2, let alightStop = ride.last else { return nil }

        var state = rides[tripID] ?? RideState()
        defer { rides[tripID] = state }

        // No fix, or the same one again (the tracker ticks between
        // location updates): nothing new to learn - just where things stand.
        guard let fix, state.lastFix.map({ fix.timestamp > $0.timestamp }) ?? true else {
            guard state.boarded, let last = state.lastFix else { return nil }
            let projection = Self.project(last.coordinate, onto: ride, fromSegment: state.segment)
            return vehicle(leg: leg, stops: stops, ride: ride, state: state, position: last.coordinate, projection: projection, speed: state.lastSpeed)
        }
        let speed = Self.speed(of: fix, after: state.lastFix)
        state.lastFix = fix
        state.lastSpeed = speed

        let projection = Self.project(fix.coordinate, onto: ride, fromSegment: state.boarded ? state.segment : 0)
        let metresFromAlight = Geo.haversineDistanceMeters(fix.coordinate, alightStop.coordinate)

        if !state.boarded {
            let timeOK = departure.map { now >= $0.addingTimeInterval(-Self.earlyBoardingSeconds) } ?? true
            let qualifies = timeOK
                && projection.distanceFromRoute <= Self.onRouteMeters
                && projection.alongMeters >= Self.boardedPastMeters
                && (speed ?? 0) >= Self.ridingSpeed
            state.boardingEvidence = qualifies ? state.boardingEvidence + 1 : 0
            if state.boardingEvidence >= 2 {
                state.boarded = true
                state.passedAt[boardSeq] = state.passedAt[boardSeq] ?? fix.timestamp
            }
        }
        guard state.boarded else { return nil }

        if !state.alighted {
            if metresFromAlight <= Self.atStopMeters * 2 { state.reachedAlight = true }
            // Got off: was at the stop and is now walking away from it - or
            // is nowhere near the route any more.
            let walkingAway = state.reachedAlight && metresFromAlight >= 60 && (speed ?? 0) < Self.walkingSpeed
            let leftRoute = state.reachedAlight && projection.distanceFromRoute > Self.onRouteMeters && (speed ?? 0) < Self.ridingSpeed
            if walkingAway || leftRoute { state.alighted = true }
        }

        state.segment = projection.segment
        // Record the stops passed, for the observed delay.
        for stop in ride where stop.sequence <= projection.passedSequence(in: ride) {
            if state.passedAt[stop.sequence] == nil { state.passedAt[stop.sequence] = fix.timestamp }
        }
        return vehicle(leg: leg, stops: stops, ride: ride, state: state, position: fix.coordinate, projection: projection, speed: speed)
    }

    /// `stopTimes` re-timed by how the ride is actually going: the rider
    /// passed its most recent stop at a known time, so the ride is running
    /// that far off the timetable, and every stop still ahead is put at its
    /// timetabled time plus the same delay - the countdown to getting off
    /// then follows the ride instead of the last prediction downloaded
    /// before the connection dropped. Nil until a stop has been passed on
    /// board.
    ///
    /// Measured against the timetable, not the cached prediction: the feed
    /// gives passed stops their timetabled time but stops ahead the trip's
    /// delay, so shifting the prediction by (passed - predicted) counted the
    /// delay twice.
    public func adjustedStopTimes(tripID: String, stops: [TripStopRef], stopTimes: [StopTimeUpdate]) -> [StopTimeUpdate]? {
        guard let state = rides[tripID], state.boarded, !state.alighted,
              let last = state.passedAt.max(by: { $0.key < $1.key }),
              let stop = stops.first(where: { $0.sequence == last.key }),
              let time = Self.stopTime(stopTimes, stop: stop)
        else { return nil }
        let scheduledMs = time.scheduledTime.milliseconds
        if scheduledMs != 0 {
            let delayMs = Int64(last.value.timeIntervalSince1970 * 1000) - scheduledMs
            return Self.retimed(stopTimes, delayMs: delayMs, fromScheduledMs: scheduledMs)
        }
        // No timetable to measure against - move the cached predictions.
        guard let predicted = Self.predictedTime(stopTimes, stop: stop) else { return nil }
        return Self.shifted(stopTimes, by: last.value.timeIntervalSince(predicted), from: predicted)
    }

    /// Puts every stop timetabled at or after `fromScheduledMs` at its
    /// timetabled time plus `delayMs`, keeping the feed's dwell (departure
    /// after arrival). Stops without a timetabled time are left alone.
    static func retimed(_ stopTimes: [StopTimeUpdate], delayMs: Int64, fromScheduledMs: Int64) -> [StopTimeUpdate] {
        stopTimes.map { time in
            let scheduled = time.scheduledTime.milliseconds
            guard scheduled != 0, scheduled >= fromScheduledMs, !time.skipped else { return time }
            let arrival = scheduled + delayMs
            let dwell = time.arrivalTime.milliseconds != 0 && time.departureTime.milliseconds != 0
                ? max(0, time.departureTime.milliseconds - time.arrivalTime.milliseconds) : 0
            return StopTimeUpdate(
                parentStopID: time.parentStopID, childStopID: time.childStopID,
                arrivalTime: GoEpochMillis(milliseconds: arrival),
                departureTime: GoEpochMillis(milliseconds: arrival + dwell),
                scheduledTime: time.scheduledTime, skipped: time.skipped, passed: time.passed, dist: time.dist
            )
        }
    }

    /// Moves every not-yet-passed time at or after `reference` by `delay`.
    static func shifted(_ stopTimes: [StopTimeUpdate], by delay: TimeInterval, from reference: Date) -> [StopTimeUpdate] {
        let shiftMs = Int64(delay * 1000)
        let referenceMs = Int64(reference.timeIntervalSince1970 * 1000)
        return stopTimes.map { time in
            let ownMs = time.arrivalTime.milliseconds != 0 ? time.arrivalTime.milliseconds : time.departureTime.milliseconds
            guard ownMs != 0, ownMs >= referenceMs else { return time }
            return StopTimeUpdate(
                parentStopID: time.parentStopID, childStopID: time.childStopID,
                arrivalTime: GoEpochMillis(milliseconds: time.arrivalTime.milliseconds == 0 ? 0 : time.arrivalTime.milliseconds + shiftMs),
                departureTime: GoEpochMillis(milliseconds: time.departureTime.milliseconds == 0 ? 0 : time.departureTime.milliseconds + shiftMs),
                scheduledTime: time.scheduledTime, skipped: time.skipped, passed: time.passed, dist: time.dist
            )
        }
    }

    /// The last prediction cached for a stop - arrival, else departure,
    /// else the timetable.
    static func predictedTime(_ stopTimes: [StopTimeUpdate], stop: TripStopRef) -> Date? {
        guard let time = stopTime(stopTimes, stop: stop) else { return nil }
        for ms in [time.arrivalTime.milliseconds, time.departureTime.milliseconds, time.scheduledTime.milliseconds] where ms != 0 {
            return Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
        }
        return nil
    }

    /// The stop's entry in `stopTimes` - by platform, else station.
    static func stopTime(_ stopTimes: [StopTimeUpdate], stop: TripStopRef) -> StopTimeUpdate? {
        stopTimes.first(where: { $0.childStopID == stop.childStopID })
            ?? stopTimes.first(where: { !stop.parentStopID.isEmpty && $0.parentStopID == stop.parentStopID })
    }

    // MARK: - Synthetic vehicle

    private func vehicle(
        leg: JourneyLeg, stops: [TripStopRef], ride: [TripStopRef], state: RideState,
        position: Coordinate, projection: Projection, speed: Double?
    ) -> Vehicle? {
        guard let alight = ride.last else { return nil }
        let current: TripStopRef
        let next: TripStopRef?
        let vehicleState: String

        if state.alighted {
            // Past the alighting stop, so `hasDepartedStop` latches the ride
            // as done - the stop after it on the trip, or a stand-in when
            // it's the end of the line.
            current = stops.first { $0.sequence > alight.sequence }
                ?? TripStopRef(lat: alight.lat, lon: alight.lon, parentStopID: alight.parentStopID, name: alight.name,
                               platform: alight.platform, sequence: alight.sequence + 1, childStopID: alight.childStopID)
            next = nil
            vehicleState = "Travelling"
        } else {
            let segment = projection.segment
            let from = ride[segment], to = ride[segment + 1]
            let slow = (speed ?? 0) < 2
            if projection.metresToSegmentEnd <= Self.atStopMeters {
                current = to
                next = ride.indices.contains(segment + 2) ? ride[segment + 2] : stops.first { $0.sequence > to.sequence }
                vehicleState = slow ? "AtStop" : "Arriving"
            } else if projection.metresFromSegmentStart <= Self.atStopMeters && slow {
                current = from
                next = to
                vehicleState = "AtStop"
            } else {
                current = from
                next = to
                vehicleState = "Travelling"
            }
        }

        let route = leg.route
        return Vehicle(
            tripID: leg.tripID,
            route: RouteSummary(id: leg.routeID, name: route?.routeShortName ?? leg.routeID, color: route?.routeColor ?? "", type: route?.vehicleType),
            trip: VehicleTrip(firstStop: stops.first.map(Self.shown), nextStop: next.map(Self.shown), finalStop: stops.last.map(Self.shown),
                              currentStop: Self.shown(current), headsign: ""),
            occupancy: -1,
            licensePlate: "",
            position: VehiclePosition(lat: position.latitude, lon: position.longitude, bearing: 0),
            type: (route?.vehicleType ?? leg.fromStop?.stopType ?? "bus").lowercased(),
            state: vehicleState,
            offCourse: false
        )
    }

    /// The stop as the feed's own vehicles name it - `/stops/{tripId}`
    /// appends the stop code, which otherwise showed up as "Next stop:
    /// Karangahape Road 7112" whenever this stood in for the live vehicle.
    static func shown(_ stop: TripStopRef) -> TripStopRef {
        TripStopRef(lat: stop.lat, lon: stop.lon, parentStopID: stop.parentStopID, name: stop.label,
                    platform: stop.platform, sequence: stop.sequence, childStopID: stop.childStopID)
    }

    // MARK: - Geometry

    struct Projection {
        /// Index into the ride's stops of the segment the rider is on.
        var segment: Int
        var distanceFromRoute: Double
        /// Along the stop-to-stop line from the boarding stop.
        var alongMeters: Double
        var metresFromSegmentStart: Double
        var metresToSegmentEnd: Double

        /// The last stop the rider has reached - the segment's start, or its
        /// end once within `atStopMeters` of it.
        func passedSequence(in ride: [TripStopRef]) -> Int {
            metresToSegmentEnd <= OfflineRideEstimator.atStopMeters ? ride[segment + 1].sequence : ride[segment].sequence
        }
    }

    /// Nearest point on the line through the ride's stops, in a local flat
    /// projection (fine at stop-to-stop distances).
    static func project(_ point: Coordinate, onto ride: [TripStopRef], fromSegment: Int = 0) -> Projection {
        let metresPerDegreeLat = 111_132.0
        let metresPerDegreeLon = 111_320.0 * cos(point.latitude * .pi / 180)
        func xy(_ c: Coordinate) -> (Double, Double) {
            ((c.longitude - point.longitude) * metresPerDegreeLon, (c.latitude - point.latitude) * metresPerDegreeLat)
        }

        let first = max(0, min(fromSegment, ride.count - 2))
        var best = Projection(segment: first, distanceFromRoute: .infinity, alongMeters: 0, metresFromSegmentStart: 0, metresToSegmentEnd: 0)
        var along: Double = 0
        for i in 0..<(ride.count - 1) {
            let (ax, ay) = xy(ride[i].coordinate)
            let (bx, by) = xy(ride[i + 1].coordinate)
            let dx = bx - ax, dy = by - ay
            let length = (dx * dx + dy * dy).squareRoot()
            // The rider is the origin of this projection.
            let t = length > 0 ? max(0, min(1, (-ax * dx - ay * dy) / (length * length))) : 0
            let px = ax + t * dx, py = ay + t * dy
            let distance = (px * px + py * py).squareRoot()
            // `<=` so a rider exactly at a shared stop resolves to the later
            // segment - they've reached that stop.
            if i >= first, distance <= best.distanceFromRoute + 0.5 {
                best = Projection(
                    segment: i, distanceFromRoute: distance, alongMeters: along + t * length,
                    metresFromSegmentStart: t * length, metresToSegmentEnd: (1 - t) * length
                )
            }
            along += length
        }
        return best
    }

    /// The fix's own speed, else worked out from the previous fix.
    static func speed(of fix: Fix, after previous: Fix?) -> Double? {
        if let speed = fix.speed, speed >= 0 { return speed }
        guard let previous else { return nil }
        let seconds = fix.timestamp.timeIntervalSince(previous.timestamp)
        guard seconds >= 2 else { return nil }
        return Geo.haversineDistanceMeters(previous.coordinate, fix.coordinate) / seconds
    }
}
