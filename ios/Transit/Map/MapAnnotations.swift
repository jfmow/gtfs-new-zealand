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
/// the same marker artwork.
final class TripStopAnnotation: NSObject, MKAnnotation {
    enum Kind: Hashable {
        case passed, upcoming, start, current, next, end
        /// The stop the rider opened this trip from (their stop).
        case marked

        /// Points - dots stay small so a long route isn't a wall of pins.
        var image: UIImage {
            switch self {
            case .upcoming: MapMarkerArt.dot(fill: .white, ring: MapMarkerArt.foreground, diameter: 14)
            case .passed: MapMarkerArt.dot(fill: UIColor(hex: "d4d4d8"), ring: UIColor(hex: "a1a1aa"), diameter: 12)
            case .start: MapMarkerArt.dot(fill: UIColor(hex: "22c55e"), ring: .white, diameter: 16)
            case .current: MapMarkerArt.dot(fill: UIColor(hex: "f59e0b"), ring: .white, diameter: 16)
            case .next: MapMarkerArt.pin(symbol: "arrowtriangle.down.fill", fill: UIColor(hex: "3b82f6"), diameter: 26)
            case .marked: MapMarkerArt.pin(symbol: "mappin", fill: UIColor(hex: "ef4444"), diameter: 26)
            case .end: MapMarkerArt.pin(symbol: "flag.fill", fill: MapMarkerArt.foreground, diameter: 26)
            }
        }

        /// Pins hang above the stop by their tail; dots sit centred on it.
        var isPin: Bool { self == .next || self == .marked || self == .end }

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

/// Draws a `TripStopAnnotation` with its marker image, drawn once per
/// kind and cached.
final class TripStopMarkerView: MKAnnotationView {
    private static var cache: [TripStopAnnotation.Kind: UIImage] = [:]

    func apply(kind: TripStopAnnotation.Kind) {
        image = Self.image(for: kind)
        centerOffset = kind.isPin ? CGPoint(x: 0, y: -(image?.size.height ?? 0) / 2) : .zero
        displayPriority = .required
        zPriority = kind.isProminent ? .init(rawValue: 700) : .init(rawValue: 300)
        canShowCallout = true
        collisionMode = .circle
    }

    private static func image(for kind: TripStopAnnotation.Kind) -> UIImage {
        if let cached = cache[kind] { return cached }
        let rendered = kind.image
        cache[kind] = rendered
        return rendered
    }
}

/// Map marker artwork, drawn with the same SF Symbols the lists use
/// (`StopModeTile`, the planner's leg icons) so the map matches the rest of
/// the app - and the web map's Lucide markers (`markers/icons.ts`).
enum MapMarkerArt {
    static let foreground = UIColor(hex: "18181b")

    static func symbolName(forMode mode: String) -> String {
        switch mode {
        case "train": "tram.fill"
        case "ferry": "ferry.fill"
        case "school bus": "backpack.fill"
        default: "bus.fill"
        }
    }

    /// Black or white, whichever reads better on `color`.
    static func contrast(on color: UIColor) -> UIColor {
        color.relativeLuminance > 0.4 ? foreground : .white
    }

    /// A filled circle with a white ring and a symbol in the middle, drawn
    /// into `context` at `rect`.
    static func drawBadge(symbol: String, fill: UIColor, in rect: CGRect) {
        let ring: CGFloat = 2
        UIColor.white.setFill()
        UIBezierPath(ovalIn: rect).fill()
        fill.setFill()
        UIBezierPath(ovalIn: rect.insetBy(dx: ring, dy: ring)).fill()

        let config = UIImage.SymbolConfiguration(pointSize: rect.width * 0.42, weight: .semibold)
        guard let glyph = UIImage(systemName: symbol, withConfiguration: config)?
            .withTintColor(contrast(on: fill), renderingMode: .alwaysOriginal) else { return }
        let size = glyph.size
        glyph.draw(in: CGRect(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width, height: size.height))
    }

    static func badge(symbol: String, fill: UIColor, diameter: CGFloat) -> UIImage {
        let pad: CGFloat = 3
        let side = diameter + pad * 2
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { ctx in
            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 1), blur: 3, color: UIColor.black.withAlphaComponent(0.3).cgColor)
            drawBadge(symbol: symbol, fill: fill, in: CGRect(x: pad, y: pad, width: diameter, height: diameter))
        }
    }

    /// A badge with a white tail underneath, pointing down at the spot.
    static func pin(symbol: String, fill: UIColor, diameter: CGFloat) -> UIImage {
        let pad: CGFloat = 3
        let tail: CGFloat = 6
        let size = CGSize(width: diameter + pad * 2, height: diameter + tail + pad * 2)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 1), blur: 3, color: UIColor.black.withAlphaComponent(0.3).cgColor)
            let circle = CGRect(x: pad, y: pad, width: diameter, height: diameter)
            let triangle = UIBezierPath()
            triangle.move(to: CGPoint(x: circle.midX - 5, y: circle.maxY - 3))
            triangle.addLine(to: CGPoint(x: circle.midX + 5, y: circle.maxY - 3))
            triangle.addLine(to: CGPoint(x: circle.midX, y: circle.maxY + tail))
            triangle.close()
            UIColor.white.setFill()
            triangle.fill()
            drawBadge(symbol: symbol, fill: fill, in: circle)
        }
    }

    /// A plain dot marking a stop along a route.
    static func dot(fill: UIColor, ring: UIColor, diameter: CGFloat) -> UIImage {
        let pad: CGFloat = 2
        let side = diameter + pad * 2
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { ctx in
            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 1), blur: 2, color: UIColor.black.withAlphaComponent(0.3).cgColor)
            let rect = CGRect(x: pad, y: pad, width: diameter, height: diameter)
            ring.setFill()
            UIBezierPath(ovalIn: rect).fill()
            ctx.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
            fill.setFill()
            UIBezierPath(ovalIn: rect.insetBy(dx: 2.5, dy: 2.5)).fill()
        }
    }
}
