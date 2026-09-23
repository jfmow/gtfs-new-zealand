import MapKit
import TransitCore

/// A stop marker. `MKMarkerAnnotationView` handles clustering natively via
/// `clusteringIdentifier` - mirrors the web map's per-type marker clustering
/// (`components/map/cluster-manager.ts`) without needing to hand-roll it.
final class StopAnnotation: NSObject, MKAnnotation {
    let id: String
    // `@objc dynamic` so MapKit KVO-observes it and animates a move when the
    // view reconciler updates an existing annotation in place rather than
    // replacing it (see TransitMapView.updateAnnotations).
    @objc dynamic var coordinate: CLLocationCoordinate2D
    @objc dynamic var title: String?
    @objc dynamic var subtitle: String?
    let stopType: String

    init(stop: Stop) {
        id = stop.stopID
        coordinate = CLLocationCoordinate2D(latitude: stop.stopLat, longitude: stop.stopLon)
        title = stop.stopName
        subtitle = stop.stopCode
        stopType = stop.stopType
    }
}

/// A live vehicle marker - not clustered (there are far fewer of these than
/// stops, and clustering a moving vehicle reads as a bug).
final class VehicleAnnotation: NSObject, MKAnnotation {
    let id: String
    @objc dynamic var coordinate: CLLocationCoordinate2D
    @objc dynamic var title: String?
    @objc dynamic var subtitle: String?
    /// Degrees, 0-360. 0 means "no bearing data" - don't rotate the marker.
    var bearing: Double
    let vehicleType: String
    var routeColorHex: String?

    init(vehicle: Vehicle) {
        id = vehicle.tripID
        coordinate = CLLocationCoordinate2D(latitude: vehicle.position.lat, longitude: vehicle.position.lon)
        title = vehicle.route.name
        subtitle = vehicle.trip?.headsign
        bearing = vehicle.position.bearing
        vehicleType = vehicle.type
        routeColorHex = vehicle.route.color.isEmpty ? nil : vehicle.route.color
    }

    /// Applies a fresh poll's data to this same instance (rather than
    /// replacing the annotation) so MapKit animates the marker moving to its
    /// new position instead of popping.
    func update(from vehicle: Vehicle) {
        coordinate = CLLocationCoordinate2D(latitude: vehicle.position.lat, longitude: vehicle.position.lon)
        title = vehicle.route.name
        subtitle = vehicle.trip?.headsign
        bearing = vehicle.position.bearing
        routeColorHex = vehicle.route.color.isEmpty ? nil : vehicle.route.color
    }
}

/// A journey's start/end marker - the web map's white "Start"/"End" pill
/// bubbles (`components/journey/live-map.tsx`), not a route/vehicle marker.
final class WaypointAnnotation: NSObject, MKAnnotation {
    let id: String
    @objc dynamic var coordinate: CLLocationCoordinate2D
    let label: String
    /// `true` for the journey's end (tinted with the region accent, like
    /// the web's red "End" pin) - `false` for the start (plain/dark, like
    /// the web's blue "Start" pill).
    let isDestination: Bool

    init(id: String, coordinate: Coordinate, label: String, isDestination: Bool) {
        self.id = id
        self.coordinate = CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude)
        self.label = label
        self.isDestination = isDestination
    }
}

/// One coloured line segment on the map - a route shape or a journey leg's
/// walking/transit path.
struct RoutePolylineData {
    let id: String
    let coordinates: [CLLocationCoordinate2D]
    let colorHex: String
    let lineWidth: CGFloat

    init(id: String, coordinates: [Coordinate], colorHex: String, lineWidth: CGFloat = 4) {
        self.id = id
        self.coordinates = coordinates.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
        self.colorHex = colorHex
        self.lineWidth = lineWidth
    }
}

/// Tags an `MKPolyline` with which `RoutePolylineData` it came from, so the
/// renderer delegate can look up its colour/width.
final class IdentifiedPolyline: MKPolyline {
    var polylineID: String = ""
    var colorHex: String = "6b7280"
    var lineWidth: CGFloat = 4
}

extension UIColor {
    /// Parses a "RRGGBB" (no '#') hex string, as the backend sends route
    /// colours - falls back to a neutral grey for an empty/invalid string.
    convenience init(hex: String) {
        var sanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        sanitized = sanitized.replacingOccurrences(of: "#", with: "")
        guard sanitized.count == 6, let value = UInt32(sanitized, radix: 16) else {
            self.init(red: 0.42, green: 0.45, blue: 0.5, alpha: 1)
            return
        }
        let r = CGFloat((value >> 16) & 0xFF) / 255
        let g = CGFloat((value >> 8) & 0xFF) / 255
        let b = CGFloat(value & 0xFF) / 255
        self.init(red: r, green: g, blue: b, alpha: 1)
    }
}
