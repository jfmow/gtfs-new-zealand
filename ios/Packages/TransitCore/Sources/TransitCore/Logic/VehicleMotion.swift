import Foundation

/// A route shape measured out in metres - for placing things along it.
public struct RouteLine: Sendable {
    public let points: [Coordinate]
    /// Metres from the start to each point.
    public let cumulative: [Double]
    public var length: Double { cumulative.last ?? 0 }

    public init?(_ coordinates: [Coordinate]) {
        guard coordinates.count >= 2 else { return nil }
        points = coordinates
        var total = 0.0
        var cumulative = [0.0]
        for i in 1..<coordinates.count {
            total += Geo.haversineDistanceMeters(coordinates[i - 1], coordinates[i])
            cumulative.append(total)
        }
        self.cumulative = cumulative
        guard total > 0 else { return nil }
    }

    /// The nearest point on the line: how far along it is, and how far off
    /// the line `coordinate` sits. With `near`, a match that would mean
    /// going backwards from there is penalised - a route that passes the
    /// same road twice (a terminal loop, out-and-back) shouldn't send the
    /// vehicle to the wrong pass.
    public func project(_ coordinate: Coordinate, near hint: Double? = nil) -> (along: Double, offset: Double) {
        let metresPerDegreeLat = 111_320.0
        let metresPerDegreeLon = 111_320.0 * cos(coordinate.latitude * .pi / 180)
        func local(_ c: Coordinate) -> (x: Double, y: Double) {
            ((c.longitude - coordinate.longitude) * metresPerDegreeLon, (c.latitude - coordinate.latitude) * metresPerDegreeLat)
        }
        var best: (along: Double, offset: Double, score: Double) = (0, .infinity, .infinity)
        var a = local(points[0])
        for i in 1..<points.count {
            let b = local(points[i])
            let dx = b.x - a.x, dy = b.y - a.y
            let lengthSquared = dx * dx + dy * dy
            let t = lengthSquared > 0 ? min(max(-(a.x * dx + a.y * dy) / lengthSquared, 0), 1) : 0
            let px = a.x + dx * t, py = a.y + dy * t
            let offset = (px * px + py * py).squareRoot()
            let along = cumulative[i - 1] + (cumulative[i] - cumulative[i - 1]) * t
            var score = offset
            if let hint {
                score += max(0, hint - along - 30) * 0.5 + max(0, along - hint - 3000) * 0.05
            }
            if score < best.score { best = (along, offset, score) }
            a = b
        }
        return (best.along, best.offset)
    }

    public func coordinate(at distance: Double) -> Coordinate {
        let d = min(max(distance, 0), length)
        var low = 0, high = cumulative.count - 1
        while high - low > 1 {
            let mid = (low + high) / 2
            if cumulative[mid] <= d { low = mid } else { high = mid }
        }
        let span = cumulative[high] - cumulative[low]
        let t = span > 0 ? (d - cumulative[low]) / span : 0
        let a = points[low], b = points[high]
        return Coordinate(latitude: a.latitude + (b.latitude - a.latitude) * t,
                          longitude: a.longitude + (b.longitude - a.longitude) * t)
    }

    /// Compass bearing of travel at `distance` - taken across a stretch of
    /// the line, so a kink in the shape doesn't snap the marker round.
    public func bearing(at distance: Double) -> Double {
        let a = coordinate(at: distance - 10)
        let b = coordinate(at: distance + 30)
        let lat1 = a.latitude * .pi / 180, lat2 = b.latitude * .pi / 180
        let dLon = (b.longitude - a.longitude) * .pi / 180
        let y = sin(dLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        let degrees = atan2(y, x) * 180 / .pi
        return (degrees + 360).truncatingRemainder(dividingBy: 360)
    }
}

/// Moves a tracked vehicle smoothly along its route between live positions,
/// which only arrive every 10-30s.
///
/// The feed has no speed or timestamp, so speed is measured from successive
/// positions along the route shape - or, when the rider is on board, taken
/// from their own GPS (which also places the vehicle, being on it).
///
/// From the feed alone, the vehicle glides to each new position over about
/// one report interval, then coasts only a few metres past it, easing to a
/// halt. It runs a report behind the real thing, but never guesses ahead
/// of it: carrying on at speed for the whole gap drew buses straight
/// through red lights they'd stopped at. It also never passes the next stop
/// and never visibly reverses (unless it's far off). With the rider's fresh
/// GPS it does carry on at speed, briefly - that source is live.
/// Off the route shape (a detour) it just shows the raw position.
public struct VehicleMotion: Sendable {
    public let line: RouteLine
    /// Metres along `line` of each stop, in trip order.
    public let stopDistances: [Double]
    /// Metres per second - anything faster is a bad fix, not the vehicle.
    public let maxSpeed: Double

    /// With the rider's GPS, never carry on longer than this past a fix.
    static let riderExtrapolation: TimeInterval = 5
    /// From the feed, coast past the last position like this - easing off
    /// over `coastTime`, never more than `maxCoast` - since it may have
    /// stopped (lights, traffic) the moment it reported.
    static let coastTime: TimeInterval = 3
    static let maxCoast = 15.0
    /// The same feed position for this long means the vehicle is stopped.
    static let stationaryAfter: TimeInterval = 30
    /// Further off the route than this is a detour - show it raw.
    static let offRouteMetres = 60.0
    /// A rider fix is the best source for this long.
    static let riderFresh: TimeInterval = 8

    private var anchor: (along: Double, time: Date)?
    private(set) public var speed: Double = 0
    private var displayed: Double?
    private var lastStep: Date?
    private var feedCoordinate: Coordinate?
    private var feedChangedAt: Date?
    private var feedAlong: Double?
    private var riderAt: Date?
    private var offRoute: Coordinate?
    /// Smoothed seconds between the feed's new positions.
    private var reportInterval: TimeInterval = 15
    /// When the glide to the latest feed position should arrive.
    private var catchUpUntil: Date?

    public init(line: RouteLine, stops: [Coordinate], vehicleType: String) {
        self.line = line
        var distances: [Double] = []
        var hint: Double?
        for stop in stops {
            let along = line.project(stop, near: hint).along
            distances.append(along)
            hint = along
        }
        stopDistances = distances
        switch vehicleType.lowercased() {
        case "train": maxSpeed = 40
        case "ferry": maxSpeed = 20
        default: maxSpeed = 28
        }
    }

    /// A position from the live feed (`stopped` when it says it's at a stop).
    public mutating func feed(_ coordinate: Coordinate, stopped: Bool, at now: Date) {
        if let previous = feedCoordinate, Geo.haversineDistanceMeters(previous, coordinate) < 1 {
            // The feed repeats a position until the vehicle reports again;
            // only a long-unchanged one means it's actually standing still.
            if stopped || now.timeIntervalSince(feedChangedAt ?? now) > Self.stationaryAfter, !riderIsFresh(now) {
                speed = 0
                if let along = feedAlong { anchor = (along, now) }
            }
            return
        }

        let projection = line.project(coordinate, near: feedAlong ?? displayed)
        let previousAlong = feedAlong, previousTime = feedChangedAt
        feedCoordinate = coordinate
        feedChangedAt = now
        guard projection.offset <= Self.offRouteMetres else {
            offRoute = coordinate
            feedAlong = nil
            anchor = nil
            speed = 0
            return
        }
        offRoute = nil
        feedAlong = projection.along
        // The rider's GPS is on the vehicle and current - the feed lags it.
        guard !riderIsFresh(now) else { return }

        if stopped {
            speed = 0
        } else if let previousAlong, let previousTime {
            let seconds = now.timeIntervalSince(previousTime)
            let metres = projection.along - previousAlong
            if (3...120).contains(seconds) {
                reportInterval = reportInterval * 0.6 + seconds * 0.4
            }
            if (3...120).contains(seconds), metres > -10 {
                let measured = min(max(metres, 0) / seconds, maxSpeed)
                speed = speed > 0 ? speed * 0.4 + measured * 0.6 : measured
            } else {
                speed = 0
            }
        }
        anchor = (projection.along, now)
        catchUpUntil = now + min(max(reportInterval, 4), 15)
    }

    /// The rider's own GPS while they're on board - precise fixes only.
    public mutating func rider(_ coordinate: Coordinate, speed gpsSpeed: Double?, at time: Date) {
        let projection = line.project(coordinate, near: displayed ?? feedAlong)
        guard projection.offset <= 40 else { return }
        riderAt = time
        offRoute = nil
        anchor = (projection.along, time)
        if let gpsSpeed, gpsSpeed >= 0 { speed = min(gpsSpeed, maxSpeed) }
    }

    /// Where to draw the vehicle now, and which way it's facing.
    public mutating func step(to now: Date) -> (coordinate: Coordinate, bearing: Double)? {
        if let offRoute {
            displayed = nil
            return (offRoute, 0)
        }
        guard let anchor else { return nil }

        let riderFresh = riderIsFresh(now)
        let elapsed = max(now.timeIntervalSince(anchor.time), 0)
        let ahead = riderFresh
            ? speed * min(elapsed, Self.riderExtrapolation)
            : min(speed * Self.coastTime * (1 - exp(-elapsed / Self.coastTime)), Self.maxCoast)
        let nextStop = stopDistances.first { $0 > anchor.along } ?? line.length
        let cap = min(nextStop, line.length)
        let target = min(anchor.along + ahead, max(cap, anchor.along))

        let dt = min(max(now.timeIntervalSince(lastStep ?? now), 0), 2)
        lastStep = now
        if let current = displayed, target - current > -120, target - current < 400 {
            // Never backwards, never past the target (capped at the next
            // stop and the coast/extrapolation limit).
            let move: Double
            if riderFresh {
                // Carry on at speed, closing on the target.
                let carried = speed * dt
                move = carried + (target - current - carried) * min(1, 0.6 * dt)
            } else {
                // Spread the glide to a new feed position over the time
                // until it's due to arrive, then just track the coast.
                let remaining = catchUpUntil.map { $0.timeIntervalSince(now) } ?? 0
                move = remaining > dt ? (target - current) * dt / remaining : target - current
            }
            displayed = max(current, min(current + max(0, move), target))
        } else {
            displayed = target
        }
        let along = displayed ?? target
        return (line.coordinate(at: along), line.bearing(at: along))
    }

    private func riderIsFresh(_ now: Date) -> Bool {
        riderAt.map { now.timeIntervalSince($0) < Self.riderFresh } ?? false
    }
}
