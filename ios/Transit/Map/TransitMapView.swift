import MapKit
import SwiftUI
import TransitCore

/// How the map should point its camera - mirrors the web map's
/// `defaultZoom`/`followMarkerId`/`followFitWith` behaviour
/// (`components/map/map.tsx`), simplified to the cases this app needs.
enum MapCamera: Equatable {
    case region(center: Coordinate, radiusMeters: Double)
    case fitAll
    /// Re-centre on this annotation id every time its position updates.
    case follow(annotationID: String)
    /// Leave the camera alone - the user is free-panning.
    case none
}

/// A single MapKit view shared by every map screen (stops browser, vehicles
/// browser, and later the service tracker) - stop clustering, vehicle
/// bearing rotation, and route polylines all live here once. Mirrors
/// `components/map/map.tsx` + `cluster-manager.ts` + `markers/create.tsx`,
/// simplified: no LINZ satellite overlay or speed-gradient waypoint line yet
/// (tracked as a follow-up once the tracker screen needs them).
struct TransitMapView: UIViewRepresentable {
    var stops: [StopAnnotation] = []
    var vehicles: [VehicleAnnotation] = []
    var polylines: [RoutePolylineData] = []
    var camera: MapCamera = .none
    var showsUserLocation: Bool = false
    var onSelectStop: ((String) -> Void)?
    var onSelectVehicle: ((String) -> Void)?

    func makeUIView(context: Context) -> MKMapView {
        let mapView = MKMapView()
        mapView.delegate = context.coordinator
        mapView.showsUserLocation = showsUserLocation
        mapView.pointOfInterestFilter = .excludingAll
        return mapView
    }

    func updateUIView(_ mapView: MKMapView, context: Context) {
        context.coordinator.parent = self
        mapView.showsUserLocation = showsUserLocation
        context.coordinator.reconcile(stops: stops, vehicles: vehicles, polylines: polylines, in: mapView)
        context.coordinator.applyCamera(camera, to: mapView)
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    @MainActor
    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: TransitMapView
        private var stopsByID: [String: StopAnnotation] = [:]
        private var vehiclesByID: [String: VehicleAnnotation] = [:]
        private var polylinesByID: [String: IdentifiedPolyline] = [:]

        init(_ parent: TransitMapView) {
            self.parent = parent
        }

        func reconcile(stops: [StopAnnotation], vehicles: [VehicleAnnotation], polylines: [RoutePolylineData], in mapView: MKMapView) {
            reconcileStops(stops, in: mapView)
            reconcileVehicles(vehicles, in: mapView)
            reconcilePolylines(polylines, in: mapView)
        }

        private func reconcileStops(_ newStops: [StopAnnotation], in mapView: MKMapView) {
            let newIDs = Set(newStops.map(\.id))
            let toRemove = stopsByID.filter { !newIDs.contains($0.key) }.values
            if !toRemove.isEmpty { mapView.removeAnnotations(Array(toRemove)) }

            var toAdd: [StopAnnotation] = []
            for stop in newStops {
                stopsByID[stop.id] = stop
                if !mapView.annotations.contains(where: { ($0 as? StopAnnotation)?.id == stop.id }) {
                    toAdd.append(stop)
                }
            }
            if !toAdd.isEmpty { mapView.addAnnotations(toAdd) }
            for id in stopsByID.keys where !newIDs.contains(id) { stopsByID.removeValue(forKey: id) }
        }

        private func reconcileVehicles(_ newVehicles: [VehicleAnnotation], in mapView: MKMapView) {
            let newIDs = Set(newVehicles.map(\.id))
            let toRemove = vehiclesByID.filter { !newIDs.contains($0.key) }.values
            if !toRemove.isEmpty { mapView.removeAnnotations(Array(toRemove)) }

            for vehicle in newVehicles {
                if let existing = vehiclesByID[vehicle.id] {
                    UIView.animate(withDuration: 0.5) {
                        existing.coordinate = vehicle.coordinate
                    }
                    existing.bearing = vehicle.bearing
                    existing.routeColorHex = vehicle.routeColorHex
                    if let view = mapView.view(for: existing) as? VehicleMarkerView {
                        view.apply(bearing: vehicle.bearing, colorHex: vehicle.routeColorHex, vehicleType: vehicle.vehicleType)
                    }
                } else {
                    vehiclesByID[vehicle.id] = vehicle
                    mapView.addAnnotation(vehicle)
                }
            }
            for id in vehiclesByID.keys where !newIDs.contains(id) { vehiclesByID.removeValue(forKey: id) }
        }

        private func reconcilePolylines(_ newPolylines: [RoutePolylineData], in mapView: MKMapView) {
            let newIDs = Set(newPolylines.map(\.id))
            let toRemove = polylinesByID.filter { !newIDs.contains($0.key) }.values
            if !toRemove.isEmpty { mapView.removeOverlays(Array(toRemove)) }

            for data in newPolylines where polylinesByID[data.id] == nil {
                let line = IdentifiedPolyline(coordinates: data.coordinates, count: data.coordinates.count)
                line.polylineID = data.id
                line.colorHex = data.colorHex
                line.lineWidth = data.lineWidth
                polylinesByID[data.id] = line
                mapView.addOverlay(line)
            }
            for id in polylinesByID.keys where !newIDs.contains(id) { polylinesByID.removeValue(forKey: id) }
        }

        func applyCamera(_ camera: MapCamera, to mapView: MKMapView) {
            switch camera {
            case .none:
                return
            case .region(let center, let radiusMeters):
                let region = MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: center.latitude, longitude: center.longitude),
                    latitudinalMeters: radiusMeters,
                    longitudinalMeters: radiusMeters
                )
                mapView.setRegion(region, animated: true)
            case .fitAll:
                let all = mapView.annotations
                guard !all.isEmpty else { return }
                mapView.showAnnotations(all, animated: true)
            case .follow(let id):
                // `vehiclesByID[id] ?? stopsByID[id]` infers the nearest
                // common ancestor (NSObject, not MKAnnotation) since these
                // are two different concrete classes - handle them
                // separately instead of relying on that inference.
                if let vehicle = vehiclesByID[id] {
                    mapView.setCenter(vehicle.coordinate, animated: true)
                } else if let stop = stopsByID[id] {
                    mapView.setCenter(stop.coordinate, animated: true)
                }
            }
        }

        // MARK: - MKMapViewDelegate

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if annotation is MKUserLocation { return nil }

            if let cluster = annotation as? MKClusterAnnotation {
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: "cluster", for: cluster) as? MKMarkerAnnotationView
                    ?? MKMarkerAnnotationView(annotation: cluster, reuseIdentifier: "cluster")
                view.markerTintColor = .systemGray
                view.glyphText = "\(cluster.memberAnnotations.count)"
                view.annotation = cluster
                return view
            }

            if let stop = annotation as? StopAnnotation {
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: "stop", for: stop) as? MKMarkerAnnotationView
                    ?? MKMarkerAnnotationView(annotation: stop, reuseIdentifier: "stop")
                view.annotation = stop
                view.clusteringIdentifier = "stop"
                view.canShowCallout = true
                view.markerTintColor = UIColor(hex: stop.stopType == "train" ? "0073bd" : stop.stopType == "ferry" ? "2a286b" : "64748b")
                view.glyphImage = UIImage(systemName: symbolName(forStopType: stop.stopType))
                return view
            }

            if let vehicle = annotation as? VehicleAnnotation {
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: "vehicle", for: vehicle) as? VehicleMarkerView
                    ?? VehicleMarkerView(annotation: vehicle, reuseIdentifier: "vehicle")
                view.annotation = vehicle
                view.canShowCallout = true
                view.apply(bearing: vehicle.bearing, colorHex: vehicle.routeColorHex, vehicleType: vehicle.vehicleType)
                return view
            }

            return nil
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            guard let line = overlay as? IdentifiedPolyline else {
                return MKOverlayRenderer(overlay: overlay)
            }
            let renderer = MKPolylineRenderer(polyline: line)
            renderer.strokeColor = UIColor(hex: line.colorHex)
            renderer.lineWidth = line.lineWidth
            renderer.lineCap = .round
            renderer.lineJoin = .round
            return renderer
        }

        func mapView(_ mapView: MKMapView, didSelect annotation: MKAnnotation) {
            if let stop = annotation as? StopAnnotation {
                parent.onSelectStop?(stop.id)
            } else if let vehicle = annotation as? VehicleAnnotation {
                parent.onSelectVehicle?(vehicle.id)
            }
        }

        private func symbolName(forStopType type: String) -> String {
            switch type {
            case "train": return "tram.fill"
            case "ferry": return "ferry.fill"
            case "bus": return "bus.fill"
            default: return "mappin"
            }
        }
    }
}

/// A rotated, colour-tinted vehicle marker - `MKMarkerAnnotationView`'s
/// balloon shape can't be rotated meaningfully, so this draws a plain
/// circular badge with a directional arrow instead, mirroring the web
/// map's rotated PNG vehicle icons.
final class VehicleMarkerView: MKAnnotationView {
    private let badge = UIImageView()

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: 30, height: 30)
        centerOffset = .zero
        badge.frame = bounds
        badge.contentMode = .scaleAspectFit
        addSubview(badge)
        canShowCallout = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func apply(bearing: Double, colorHex: String?, vehicleType: String) {
        let symbolName: String
        switch vehicleType {
        case "train": symbolName = "tram.circle.fill"
        case "ferry": symbolName = "ferry.fill"
        default: symbolName = "bus.circle.fill"
        }
        let color = UIColor(hex: colorHex ?? "0073bd")
        let config = UIImage.SymbolConfiguration(paletteColors: [.white, color])
        badge.image = UIImage(systemName: symbolName)?.applyingSymbolConfiguration(config)

        // bearing == 0 means "no data" on this API - don't rotate.
        if bearing > 0 {
            transform = CGAffineTransform(rotationAngle: CGFloat(bearing) * .pi / 180)
        } else {
            transform = .identity
        }
    }
}
