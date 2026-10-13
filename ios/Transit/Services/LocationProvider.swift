import CoreLocation
import TransitCore

/// The device's location, for "near you" stops, "current location" in the
/// planner, and following the rider on the map. Mirrors `lib/userLocation.ts`.
/// Delegate callbacks arrive off the main thread, so they're `nonisolated`
/// and hop back to the main actor before touching `@Observable` state.
@MainActor
@Observable
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()

    private(set) var coordinate: Coordinate?
    /// Metres per second from the latest fix - nil when the device didn't
    /// measure one.
    private(set) var speed: Double?
    private(set) var fixDate: Date?
    /// The latest fix's horizontal accuracy in metres - nil when invalid.
    private(set) var accuracy: Double?
    private(set) var authorizationStatus: CLAuthorizationStatus
    /// Called on the main actor after every new fix - the journey tracker
    /// uses it to advance while the app is in the background.
    @ObservationIgnored var onUpdate: (() -> Void)?
    /// How much GPS a tracked journey is using in the background
    /// (`JourneyGPSPolicy`) - `.precise` otherwise. Updates keep running in
    /// every mode, so the app stays awake to turn it back up near a moment.
    private(set) var gpsMode = JourneyGPSPolicy.Mode.precise
    /// When fixes last became good enough to place the rider - ones before
    /// it are left over from a coarser mode.
    @ObservationIgnored private var preciseSince = Date.distantPast
    /// When fixes last became good enough to see the rider set off.
    @ObservationIgnored private var coarseSince = Date.distantPast
    /// A journey is keeping updates running.
    @ObservationIgnored private var journeyUpdates = false
    /// Ends a `requestFix` burst that never got a good enough fix.
    @ObservationIgnored private var fixTimeout: Task<Void, Never>?
    /// How long a `requestFix` burst may run - longer than the 10s the
    /// planner's "My location" waits.
    private static let fixWindow: TimeInterval = 20
    /// A fix this precise, and this fresh, ends a `requestFix` burst.
    private static let goodFixAccuracy: Double = 50
    private static let goodFixMaxAge: TimeInterval = 10
    /// How long a still rider under a distance filter can go without a fix
    /// before it stops counting as "still there" (`positionConfirmedAt`).
    private static let filteredFixMaxSilence: TimeInterval = 10 * 60

    override init() {
        authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    /// The latest fix, when it's precise enough to place the rider - not
    /// while GPS is resting or coarse, nor a fix left over from either.
    var preciseCoordinate: Coordinate? {
        guard gpsMode.placesRider, let fixDate, fixDate >= preciseSince else { return nil }
        return coordinate
    }

    /// The latest fix, when it's good enough to see the rider set off from
    /// the start (`DepartureDetector` checks its accuracy) - anything but a
    /// resting one.
    var departureCoordinate: Coordinate? {
        guard gpsMode > .resting, let fixDate, fixDate >= coarseSince else { return nil }
        return coordinate
    }

    /// Up to when the latest fix is known to still hold. Under a distance
    /// filter no new fix means the rider hasn't moved past it, so while
    /// journey updates run that's now (for a while - a lost signal sends
    /// nothing either). Without one, when it was taken.
    var positionConfirmedAt: Date? {
        guard let fixDate else { return nil }
        let now = Date()
        guard journeyUpdates, manager.distanceFilter != kCLDistanceFilterNone,
              now.timeIntervalSince(fixDate) <= Self.filteredFixMaxSilence else { return fixDate }
        return max(fixDate, now)
    }

    var isAuthorized: Bool {
        authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways
    }

    func requestPermission() {
        guard authorizationStatus == .notDetermined else { return }
        manager.requestWhenInUseAuthorization()
    }

    /// Gets a fresh fix: GPS runs until one precise and recent enough
    /// arrives (or `fixWindow` passes), then stops - screens that show
    /// where you are only need a fix, and leaving GPS streaming whenever
    /// the app was open was a big battery cost. A tracked journey keeps it
    /// running for as long as it's on (`setJourneyBackgroundUpdates`).
    func requestFix() {
        guard isAuthorized else { return }
        manager.startUpdatingLocation()
        guard !journeyUpdates else { return }
        fixTimeout?.cancel()
        fixTimeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.fixWindow))
            guard !Task.isCancelled else { return }
            self?.endFix()
        }
    }

    private func endFix() {
        fixTimeout?.cancel()
        fixTimeout = nil
        if !journeyUpdates { manager.stopUpdatingLocation() }
    }

    /// Keeps location updates (and so the app) running in the background
    /// for the length of a tracked journey - what lets the tracker follow
    /// the ride and fire get-off alerts from GPS with no connection. Only
    /// takes effect once location is authorised; turned back off when the
    /// journey ends.
    func setJourneyBackgroundUpdates(_ enabled: Bool) {
        guard isAuthorized || !enabled else { return }
        manager.allowsBackgroundLocationUpdates = enabled
        manager.showsBackgroundLocationIndicator = enabled
        manager.pausesLocationUpdatesAutomatically = !enabled
        manager.activityType = enabled ? .otherNavigation : .other
        journeyUpdates = enabled
        if enabled {
            manager.startUpdatingLocation()
        } else {
            setGPSMode(.precise)
            // Journey's over: stop, unless a screen's still waiting on a fix.
            if fixTimeout == nil { manager.stopUpdatingLocation() }
        }
    }

    /// Tells Core Location how the rider is moving, so it can filter and
    /// pace fixes for it: on foot (`.fitness`) or riding
    /// (`.otherNavigation` - buses and trains alike). Journey updates only.
    func setJourneyOnFoot(_ onFoot: Bool) {
        guard journeyUpdates else { return }
        let type: CLActivityType = onFoot ? .fitness : .otherNavigation
        if manager.activityType != type { manager.activityType = type }
    }

    /// Sets how much GPS a journey uses - see `JourneyGPSPolicy.Mode`.
    func setGPSMode(_ mode: JourneyGPSPolicy.Mode) {
        guard mode != gpsMode else { return }
        let previous = gpsMode
        gpsMode = mode
        switch mode {
        case .resting:
            manager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
            manager.distanceFilter = 500
        case .coarse:
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            manager.distanceFilter = 50
        case .pedestrian:
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            manager.distanceFilter = 10
        case .precise:
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.distanceFilter = kCLDistanceFilterNone
        }
        let now = Date()
        if mode.placesRider, !previous.placesRider { preciseSince = now }
        if mode > .resting, previous == .resting { coarseSince = now }
        // Tighter: restart, so a fix at the new accuracy comes straight
        // away - a rider standing still under a distance filter would
        // otherwise get none until they move.
        if mode > previous, journeyUpdates {
            manager.stopUpdatingLocation()
            manager.startUpdatingLocation()
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor [weak self] in
            self?.authorizationStatus = status
            if status == .authorizedWhenInUse || status == .authorizedAlways {
                self?.requestFix()
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let coordinate = Coordinate(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude)
        let speed = location.speed >= 0 ? location.speed : nil
        let accuracy = location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
        let timestamp = location.timestamp
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.coordinate = coordinate
            self.speed = speed
            self.accuracy = accuracy
            self.fixDate = timestamp
            self.onUpdate?()
            if self.fixTimeout != nil, let accuracy, accuracy <= Self.goodFixAccuracy,
               Date().timeIntervalSince(timestamp) <= Self.goodFixMaxAge {
                self.endFix()
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Best-effort - callers fall back to the region's default centre.
    }
}
