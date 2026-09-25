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
    /// Walking legs draw as a dotted grey line with no casing.
    let isWalk: Bool
    /// Part of a vehicle's route that isn't part of your ride (before you
    /// board, after you get off) - a faded grey line under everything else,
    /// like the web tracker's "before"/"after" segments.
    let isMuted: Bool

    init(id: String, coordinates: [Coordinate], colorHex: String, lineWidth: CGFloat = 5, isWalk: Bool = false, isMuted: Bool = false) {
        self.id = id
        self.coordinates = coordinates.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
        self.colorHex = colorHex
        self.lineWidth = lineWidth
        self.isWalk = isWalk
        self.isMuted = isMuted
    }

    /// Splits a trip's full shape at the points nearest your board and
    /// alight stops: the ride itself in `colorHex`, and the vehicle's route
    /// before and after it muted. Port of the web's `splitTrackedRouteLine`.
    static func splitRide(
        id: String, shape: [Coordinate], board: Coordinate, alight: Coordinate, colorHex: String
    ) -> [RoutePolylineData] {
        guard shape.count >= 2 else { return [] }
        func nearest(_ point: Coordinate) -> Int {
            var best = 0, bestDistance = Double.infinity
            for (index, c) in shape.enumerated() {
                let d = pow(c.latitude - point.latitude, 2) + pow(c.longitude - point.longitude, 2)
                if d < bestDistance { best = index; bestDistance = d }
            }
            return best
        }
        var boardIndex = nearest(board), alightIndex = nearest(alight)
        if boardIndex > alightIndex { swap(&boardIndex, &alightIndex) }

        var result: [RoutePolylineData] = []
        if boardIndex > 0 {
            result.append(.init(id: "\(id)-before", coordinates: Array(shape[...boardIndex]), colorHex: "9CA3AF", isMuted: true))
        }
        if alightIndex < shape.count - 1 {
            result.append(.init(id: "\(id)-after", coordinates: Array(shape[alightIndex...]), colorHex: "9CA3AF", isMuted: true))
        }
        if alightIndex > boardIndex {
            result.append(.init(id: "\(id)-ride", coordinates: Array(shape[boardIndex...alightIndex]), colorHex: colorHex))
        }
        return result
    }

    /// Cheap change check against what's already on the map - colour and
    /// style, plus the shape's length and end points.
    func matches(_ line: IdentifiedPolyline) -> Bool {
        guard line.colorHex == colorHex, line.lineWidth == lineWidth, line.isWalk == isWalk, line.isMuted == isMuted,
              line.pointCount == coordinates.count else { return false }
        guard let first = coordinates.first, let last = coordinates.last, line.pointCount > 0 else { return true }
        let points = line.points()
        let a = points[0].coordinate, b = points[line.pointCount - 1].coordinate
        return abs(a.latitude - first.latitude) < 1e-7 && abs(a.longitude - first.longitude) < 1e-7
            && abs(b.latitude - last.latitude) < 1e-7 && abs(b.longitude - last.longitude) < 1e-7
    }
}

/// Tags an `MKPolyline` with which `RoutePolylineData` it came from, so the
/// renderer delegate can look up its colour/width.
final class IdentifiedPolyline: MKPolyline {
    var polylineID: String = ""
    var colorHex: String = "6b7280"
    var lineWidth: CGFloat = 5
    var isWalk = false
    var isMuted = false
}

/// A route line with a contrasting outline ("casing") drawn under it, so it
/// stands out from roads on both light and dark basemaps - the web map's
/// line-casing layer.
final class CasedPolylineRenderer: MKPolylineRenderer {
    var casingColor: UIColor = .clear
    var casingWidth: CGFloat = 0

    override func draw(_ mapRect: MKMapRect, zoomScale: MKZoomScale, in context: CGContext) {
        if casingWidth > 0 {
            if path == nil { createPath() }
            if let path {
                context.saveGState()
                context.addPath(path)
                context.setStrokeColor(casingColor.cgColor)
                context.setLineWidth((lineWidth + casingWidth * 2) / zoomScale)
                context.setLineCap(.round)
                context.setLineJoin(.round)
                context.strokePath()
                context.restoreGState()
            }
        }
        super.draw(mapRect, zoomScale: zoomScale, in: context)
    }
}

extension UIColor {
    /// WCAG relative luminance, 0 (black) ... 1 (white) - for picking a
    /// contrasting outline or text colour against a route colour.
    var relativeLuminance: Double {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard getRed(&r, green: &g, blue: &b, alpha: &a) else { return 0.5 }
        func channel(_ c: CGFloat) -> Double {
            let c = Double(c)
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

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

/// One stop of a live-tracked trip, marked by where the vehicle is - the
/// web tracker's `trackedStopIcon` (`services/tracker/map-markers.ts`), with
/// the same marker images.
final class TripStopAnnotation: NSObject, MKAnnotation {
    enum Kind: Equatable {
        case passed, upcoming, start, current, next, end
        /// The stop the rider opened this trip from (their stop).
        case marked

        var imageName: String {
            switch self {
            case .passed: "TripStopPassed"
            case .upcoming: "TripStopUpcoming"
            case .start: "TripStopStart"
            case .current: "TripStopCurrent"
            case .next: "TripStopNext"
            case .end: "TripStopEnd"
            case .marked: "TripStopMarked"
            }
        }

        /// Points - dots stay small so a long route isn't a wall of pins.
        var size: CGSize {
            switch self {
            case .passed, .upcoming, .start, .current: CGSize(width: 14, height: 14)
            case .next, .marked: CGSize(width: 24, height: 25)
            case .end: CGSize(width: 24, height: 24)
            }
        }

        /// Drawn above ordinary stops.
        var isProminent: Bool { self == .next || self == .marked || self == .end || self == .current }
    }

    let id: String
    @objc dynamic var coordinate: CLLocationCoordinate2D
    @objc dynamic var title: String?
    @objc dynamic var subtitle: String?
    var kind: Kind

    init(id: String, coordinate: CLLocationCoordinate2D, name: String, detail: String?, kind: Kind) {
        self.id = id
        self.coordinate = coordinate
        self.title = name
        self.subtitle = detail
        self.kind = kind
    }
}

/// Draws a `TripStopAnnotation` with its marker image, resized once per
/// kind and cached.
final class TripStopMarkerView: MKAnnotationView {
    private static var cache: [String: UIImage] = [:]

    func apply(kind: TripStopAnnotation.Kind) {
        image = Self.image(for: kind)
        // Triangles and the end octagon point at the stop from above.
        centerOffset = kind == .next || kind == .marked ? CGPoint(x: 0, y: -kind.size.height / 2 + 3) : .zero
        displayPriority = .required
        zPriority = kind.isProminent ? .init(rawValue: 700) : .init(rawValue: 300)
        canShowCallout = true
        collisionMode = .circle
    }

    private static func image(for kind: TripStopAnnotation.Kind) -> UIImage? {
        if let cached = cache[kind.imageName] { return cached }
        guard let source = UIImage(named: kind.imageName) else { return nil }
        let rendered = UIGraphicsImageRenderer(size: kind.size).image { _ in
            source.draw(in: CGRect(origin: .zero, size: kind.size))
        }
        cache[kind.imageName] = rendered
        return rendered
    }
}
