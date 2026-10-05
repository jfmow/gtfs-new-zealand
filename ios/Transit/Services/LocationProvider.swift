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
    /// GPS is resting: coarse cell/wifi fixes only, on a ride the live feed
    /// is following (`JourneyGPSPolicy`). Updates keep running, so the app
    /// stays awake in the background to turn it back on near the stop.
    private(set) var isResting = false
    /// When precise GPS last came back - fixes before it are coarse.
    @ObservationIgnored private var preciseSince = Date.distantPast

    override init() {
        authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    /// The latest fix, when it's precise enough to place the rider - not
    /// while GPS is resting, nor a coarse one left over from it.
    var preciseCoordinate: Coordinate? {
        guard !isResting, let fixDate, fixDate >= preciseSince else { return nil }
        return coordinate
    }

    var isAuthorized: Bool {
        authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways
    }

    func requestPermission() {
        guard authorizationStatus == .notDetermined else { return }
        manager.requestWhenInUseAuthorization()
    }

    func startUpdating() {
        guard isAuthorized else { return }
        manager.startUpdatingLocation()
    }

    func stopUpdating() {
        manager.stopUpdatingLocation()
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
        if enabled { manager.startUpdatingLocation() } else { setResting(false) }
    }

    /// Swaps GPS for coarse cell/wifi fixes (far cheaper) and back.
    func setResting(_ resting: Bool) {
        guard resting != isResting else { return }
        isResting = resting
        manager.desiredAccuracy = resting ? kCLLocationAccuracyThreeKilometers : kCLLocationAccuracyBest
        manager.distanceFilter = resting ? 500 : kCLDistanceFilterNone
        if !resting { preciseSince = Date() }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor [weak self] in
            self?.authorizationStatus = status
            if status == .authorizedWhenInUse || status == .authorizedAlways {
                self?.startUpdating()
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
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Best-effort - callers fall back to the region's default centre.
    }
}
