import MapKit
import SwiftUI
import TransitCore

/// How the map should point its camera - mirrors the web map's
/// `defaultZoom`/`followMarkerId`/`followFitWith`/`followUser` behaviour.
/// Every mode frames within `cameraInsets` (the part of the map not
/// covered by overlays like the tracker's drawer).
enum MapCamera: Equatable {
    case region(center: Coordinate, radiusMeters: Double)
    case fitAll

    /// Keep this annotation centred as it moves. With `spanMeters`, the
    /// zoom is set to that span when following starts (so following a bus
    /// from a zoomed-out overview zooms in); after that only the centre
    /// moves, leaving the rider's pinch-zoom alone.
    case follow(annotationID: String, spanMeters: Double? = nil)

    /// `.follow`, but for the device's own location (the blue dot) - the
    /// camera keeps the rider centred as they walk. Needs
    /// `showsUserLocation`; does nothing until a fix arrives.
    case followUser(spanMeters: Double? = nil)

    /// Frame all of these points (e.g. the bus and the stop you're waiting
    /// at), never tighter than `minSpanMeters` - the web's
    /// `followFitWith` with its `maxZoom`.
    case frame(points: [Coordinate], minSpanMeters: Double)

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
    /// Settings > Map style - basemap light/dark independent of the app
    /// theme, like the web's map style setting.
    @AppStorage("mapStyle") private var mapStyleRaw = MapStyle.auto.rawValue

    var stops: [StopAnnotation] = []
    var vehicles: [VehicleAnnotation] = []
    var waypoints: [WaypointAnnotation] = []
    /// A live-tracked trip's stops, marked by progress (next, current,
    /// passed, your stop, end...).
    var tripStops: [TripStopAnnotation] = []
    var polylines: [RoutePolylineData] = []
    var camera: MapCamera = .none
    var showsUserLocation: Bool = false

    var onSelectStop: ((String) -> Void)?
    var onSelectVehicle: ((String) -> Void)?

    /// Fires after every pan/zoom settles (`regionDidChangeAnimated`), with
    /// the map's new visible region. A screen with a large candidate stop
    /// set (`StopsMapView`) uses this to only ever hand this view the stops
    /// actually near what's on screen, instead of every stop in the region -
    /// MapKit's own accessibility-tree walk (VoiceOver, or XCUITest/any
    /// other accessibility client) is O(annotation count) over
    /// `mapView.annotations` regardless of visual clustering, and with a
    /// whole-region stop set (thousands, for Auckland) that walk can pin
    /// the main thread for 60s+. See `ios-swiftui-rewrite` memory.
    var onVisibleRegionChange: ((MKCoordinateRegion) -> Void)?

    /// Bump to recentre on the device's location right now (the
    /// `RecenterButton`) - a one-shot imperative trigger rather than part
    /// of `camera`, since `camera`'s own value-equality gate (needed so the
    /// ambient camera doesn't fight the person's own panning every render)
    /// would otherwise make a second tap silently do nothing whenever nothing
    /// else about the camera value had changed since the first tap.
    var centerOnUserLocationTrigger: Int = 0

    /// The unobscured part of the map - camera modes frame inside this.
    var cameraInsets: UIEdgeInsets = .zero

    /// Fires when the person pans/zooms/rotates the map themselves - a
    /// screen with an automatic camera pauses it (Apple Maps style) until
    /// they ask to re-centre.
    var onUserInteraction: (() -> Void)?

    /// Bump to re-apply `camera` even if its value hasn't changed (after
    /// the person re-centres).
    var cameraResetToken: Int = 0

    func makeUIView(context: Context) -> MKMapView {
        let mapView = MKMapView()

        mapView.delegate = context.coordinator
        mapView.showsUserLocation = showsUserLocation
        mapView.pointOfInterestFilter = .excludingAll

        // Register every annotation view that is dequeued using
        // dequeueReusableAnnotationView(withIdentifier:for:).
        mapView.register(
            MKMarkerAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: "stop"
        )

        mapView.register(
            MKMarkerAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: "cluster"
        )

        mapView.register(
            VehicleMarkerView.self,
            forAnnotationViewWithReuseIdentifier: "vehicle"
        )

        mapView.register(
            WaypointMarkerView.self,
            forAnnotationViewWithReuseIdentifier: "waypoint"
        )

        mapView.register(
            TripStopMarkerView.self,
            forAnnotationViewWithReuseIdentifier: "tripStop"
        )

        return mapView
    }

    func updateUIView(_ mapView: MKMapView, context: Context) {
        context.coordinator.parent = self
        mapView.overrideUserInterfaceStyle = (MapStyle(rawValue: mapStyleRaw) ?? .auto).interfaceStyle

        mapView.showsUserLocation = showsUserLocation

        context.coordinator.reconcile(
            stops: stops,
            vehicles: vehicles,
            waypoints: waypoints,
            polylines: polylines,
            in: mapView
        )
        context.coordinator.reconcileTripStops(tripStops, in: mapView)

        context.coordinator.applyCameraReset(cameraResetToken)
        context.coordinator.applyCamera(camera, to: mapView)
        context.coordinator.applyCenterOnUserLocationTrigger(centerOnUserLocationTrigger, to: mapView)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    @MainActor
    final class Coordinator: NSObject, MKMapViewDelegate {

        var parent: TransitMapView

        private var stopsByID: [String: StopAnnotation] = [:]
        private var vehiclesByID: [String: VehicleAnnotation] = [:]
        private var waypointsByID: [String: WaypointAnnotation] = [:]
        private var polylinesByID: [String: IdentifiedPolyline] = [:]

        /// The last `.region`/`.fitAll` camera value actually applied -
        /// `updateUIView` runs on every SwiftUI re-render (every poll tick,
        /// every location update), and re-centring the map each time would
        /// otherwise fight any pan/zoom the person just did. `.follow` is
        /// exempt: that case means "keep tracking this vehicle", so it must
        /// re-apply every time even though its enum value doesn't change.
        private var lastAppliedCamera: MapCamera?

        /// Last `centerOnUserLocationTrigger` value handled - see that
        /// property's doc comment.
        private var lastCenterOnUserLocationTrigger = 0
        private var lastCameraResetToken = 0
        /// The annotation `.follow` last set a span for - so the span is set
        /// once when following starts, not on every position update.
        private var followSpanAppliedFor: String?

        func applyCameraReset(_ token: Int) {
            guard token != lastCameraResetToken else { return }
            lastCameraResetToken = token
            lastAppliedCamera = nil
            followSpanAppliedFor = nil
        }

        init(_ parent: TransitMapView) {
            self.parent = parent
        }

        func reconcile(
            stops: [StopAnnotation],
            vehicles: [VehicleAnnotation],
            waypoints: [WaypointAnnotation],
            polylines: [RoutePolylineData],
            in mapView: MKMapView
        ) {
            reconcileStops(stops, in: mapView)
            reconcileVehicles(vehicles, in: mapView)
            reconcileWaypoints(waypoints, in: mapView)
            reconcilePolylines(polylines, in: mapView)
        }

        /// Waypoints (a journey's start/end) are static for the view's
        /// lifetime, so this is simpler than the diffing `reconcileStops`
        /// does - just replace the set wholesale when it changes.
        private var tripStopsByID: [String: TripStopAnnotation] = [:]

        /// Stops keep their annotation; only a changed kind (the vehicle
        /// moved on) re-styles the existing view in place.
        func reconcileTripStops(_ newStops: [TripStopAnnotation], in mapView: MKMapView) {
            let newIDs = Set(newStops.map(\.id))
            let gone = tripStopsByID.filter { !newIDs.contains($0.key) }.map(\.value)
            if !gone.isEmpty { mapView.removeAnnotations(gone) }
            for id in tripStopsByID.keys where !newIDs.contains(id) { tripStopsByID.removeValue(forKey: id) }

            var toAdd: [TripStopAnnotation] = []
            for stop in newStops {
                if let existing = tripStopsByID[stop.id] {
                    existing.subtitle = stop.subtitle
                    if existing.kind != stop.kind {
                        existing.kind = stop.kind
                        (mapView.view(for: existing) as? TripStopMarkerView)?.apply(kind: stop.kind)
                    }
                } else {
                    tripStopsByID[stop.id] = stop
                    toAdd.append(stop)
                }
            }
            if !toAdd.isEmpty { mapView.addAnnotations(toAdd) }
        }

        private func reconcileWaypoints(
            _ newWaypoints: [WaypointAnnotation],
            in mapView: MKMapView
        ) {
            let newIDs = Set(newWaypoints.map(\.id))
            guard newIDs != Set(waypointsByID.keys) else { return }

            mapView.removeAnnotations(Array(waypointsByID.values))
            waypointsByID = Dictionary(uniqueKeysWithValues: newWaypoints.map { ($0.id, $0) })
            mapView.addAnnotations(newWaypoints)
        }

        private func reconcileStops(
            _ newStops: [StopAnnotation],
            in mapView: MKMapView
        ) {
            let newIDs = Set(newStops.map(\.id))

            let toRemove = stopsByID
                .filter { !newIDs.contains($0.key) }
                .values

            if !toRemove.isEmpty {
                mapView.removeAnnotations(Array(toRemove))
            }

            var toAdd: [StopAnnotation] = []

            for stop in newStops {
                stopsByID[stop.id] = stop

                if !mapView.annotations.contains(
                    where: { ($0 as? StopAnnotation)?.id == stop.id }
                ) {
                    toAdd.append(stop)
                }
            }

            if !toAdd.isEmpty {
                mapView.addAnnotations(toAdd)
            }

            for id in stopsByID.keys
            where !newIDs.contains(id) {
                stopsByID.removeValue(forKey: id)
            }
        }

        private func reconcileVehicles(
            _ newVehicles: [VehicleAnnotation],
            in mapView: MKMapView
        ) {
            let newIDs = Set(newVehicles.map(\.id))

            let toRemove = vehiclesByID
                .filter { !newIDs.contains($0.key) }
                .values

            if !toRemove.isEmpty {
                mapView.removeAnnotations(Array(toRemove))
            }

            for vehicle in newVehicles {
                if let existing = vehiclesByID[vehicle.id] {
                    UIView.animate(withDuration: 0.5) {
                        existing.coordinate = vehicle.coordinate
                    }

                    existing.bearing = vehicle.bearing
                    existing.routeColorHex = vehicle.routeColorHex

                    if let view = mapView.view(for: existing)
                        as? VehicleMarkerView {
                        view.apply(
                            bearing: vehicle.bearing,
                            colorHex: vehicle.routeColorHex,
                            vehicleType: vehicle.vehicleType
                        )
                    }
                } else {
                    vehiclesByID[vehicle.id] = vehicle
                    mapView.addAnnotation(vehicle)
                }
            }

            for id in vehiclesByID.keys
            where !newIDs.contains(id) {
                vehiclesByID.removeValue(forKey: id)
            }
        }

        private func reconcilePolylines(
            _ newPolylines: [RoutePolylineData],
            in mapView: MKMapView
        ) {
            let newIDs = Set(newPolylines.map(\.id))

            // Gone, or changed (e.g. a shape first drawn in the fallback grey
            // before its route colour loaded) - changed ones are re-added
            // below. Matching on id alone left such lines grey for good.
            let changed = Set(newPolylines.compactMap { data in
                polylinesByID[data.id].flatMap { data.matches($0) ? nil : data.id }
            })
            let toRemove = polylinesByID
                .filter { !newIDs.contains($0.key) || changed.contains($0.key) }
                .values
            for id in changed { polylinesByID.removeValue(forKey: id) }

            if !toRemove.isEmpty {
                mapView.removeOverlays(Array(toRemove))
            }

            for data in newPolylines
            where polylinesByID[data.id] == nil {
                let line = IdentifiedPolyline(
                    coordinates: data.coordinates,
                    count: data.coordinates.count
                )

                line.polylineID = data.id
                line.colorHex = data.colorHex
                line.lineWidth = data.lineWidth
                line.isWalk = data.isWalk
                line.isMuted = data.isMuted

                polylinesByID[data.id] = line
                // Muted lines sit under every coloured one.
                if data.isMuted {
                    mapView.insertOverlay(line, at: 0)
                } else {
                    mapView.addOverlay(line)
                }
            }

            for id in polylinesByID.keys
            where !newIDs.contains(id) {
                polylinesByID.removeValue(forKey: id)
            }
        }

        func applyCamera(_ camera: MapCamera, to mapView: MKMapView) {
            let insets = parent.cameraInsets
            switch camera {
            case .none:
                return

            case .region(let center, let radiusMeters):
                guard camera != lastAppliedCamera else { return }
                lastAppliedCamera = camera
                let rect = Self.mapRect(around: [center], minSpanMeters: radiusMeters)
                move(mapView) { mapView.setVisibleMapRect(rect, edgePadding: insets, animated: true) }

            case .frame(let points, let minSpan):
                guard camera != lastAppliedCamera, !points.isEmpty else { return }
                lastAppliedCamera = camera
                let rect = Self.mapRect(around: points, minSpanMeters: minSpan)
                let padding = UIEdgeInsets(top: insets.top + 40, left: insets.left + 40, bottom: insets.bottom + 40, right: insets.right + 40)
                move(mapView) { mapView.setVisibleMapRect(rect, edgePadding: padding, animated: true) }

            case .fitAll:
                // Union annotation points with every overlay's rect - a
                // polyline-only map (a journey preview) has no annotations,
                // so `showAnnotations` alone never framed the route.
                guard camera != lastAppliedCamera else { return }
                var rect = MKMapRect.null
                for annotation in mapView.annotations where !(annotation is MKUserLocation) {
                    let point = MKMapPoint(annotation.coordinate)
                    rect = rect.union(MKMapRect(x: point.x, y: point.y, width: 0, height: 0))
                }
                for overlay in mapView.overlays {
                    rect = rect.union(overlay.boundingMapRect)
                }
                guard !rect.isNull else { return }
                lastAppliedCamera = camera
                let padding = UIEdgeInsets(top: insets.top + 40, left: insets.left + 30, bottom: insets.bottom + 40, right: insets.right + 30)
                move(mapView) { mapView.setVisibleMapRect(rect, edgePadding: padding, animated: true) }

            case .follow(let id, let spanMeters):
                lastAppliedCamera = camera
                let coordinate: CLLocationCoordinate2D?
                if let vehicle = vehiclesByID[id] {
                    coordinate = vehicle.coordinate
                } else if let stop = stopsByID[id] {
                    coordinate = stop.coordinate
                } else {
                    coordinate = nil
                }
                guard let coordinate else { return }
                follow(coordinate, key: id, spanMeters: spanMeters, in: mapView)

            case .followUser(let spanMeters):
                lastAppliedCamera = camera
                guard mapView.showsUserLocation, let location = mapView.userLocation.location else { return }
                follow(location.coordinate, key: Self.userFollowKey, spanMeters: spanMeters, in: mapView)
            }
        }

        private static let userFollowKey = "__user_location__"

        /// Centre `coordinate` in the unobscured area - zooming to
        /// `spanMeters` the first time `key` is followed, then leaving the
        /// rider's own pinch-zoom alone.
        private func follow(_ coordinate: CLLocationCoordinate2D, key id: String, spanMeters: Double?, in mapView: MKMapView) {
            let insets = parent.cameraInsets
            // Still zoomed right out (e.g. the first attempt ran before
            // the map had its final size, when the drawer's padding
            // didn't fit and MapKit ignored it) - zoom again.
            let visibleMeters = mapView.visibleMapRect.width / MKMapPointsPerMeterAtLatitude(coordinate.latitude)
            let zoomedOut = spanMeters.map { visibleMeters > $0 * 8 } ?? false
            let paddingFits = mapView.bounds.height > insets.top + insets.bottom + 80 && mapView.bounds.width > 80
            if let spanMeters, followSpanAppliedFor != id || zoomedOut, paddingFits {
                followSpanAppliedFor = id
                let rect = Self.mapRect(around: [Coordinate(latitude: coordinate.latitude, longitude: coordinate.longitude)], minSpanMeters: spanMeters)
                move(mapView) { mapView.setVisibleMapRect(rect, edgePadding: insets, animated: true) }
            } else {
                // Keep the zoom; put the point in the middle of the
                // unobscured area rather than the middle of the view.
                let center = Self.center(placing: coordinate, inInsets: insets, of: mapView)
                move(mapView) { mapView.setCenter(center, animated: true) }
            }
        }

        private func move(_ mapView: MKMapView, _ change: () -> Void) {
            change()
        }

        /// A map rect containing `points`, at least `minSpanMeters` across.
        static func mapRect(around points: [Coordinate], minSpanMeters: Double) -> MKMapRect {
            var rect = MKMapRect.null
            for point in points {
                let p = MKMapPoint(CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude))
                rect = rect.union(MKMapRect(x: p.x, y: p.y, width: 0, height: 0))
            }
            let pointsPerMeter = MKMapPointsPerMeterAtLatitude(points.first?.latitude ?? 0)
            let minSide = minSpanMeters * pointsPerMeter
            if rect.width < minSide { rect = rect.insetBy(dx: -(minSide - rect.width) / 2, dy: 0) }
            if rect.height < minSide { rect = rect.insetBy(dx: 0, dy: -(minSide - rect.height) / 2) }
            return rect
        }

        /// The map centre that puts `coordinate` in the middle of the part
        /// of the view not covered by `insets`, at the current zoom.
        static func center(placing coordinate: CLLocationCoordinate2D, inInsets insets: UIEdgeInsets, of mapView: MKMapView) -> CLLocationCoordinate2D {
            let bounds = mapView.bounds
            guard bounds.width > 0, bounds.height > 0 else { return coordinate }
            let visibleMidX = insets.left + (bounds.width - insets.left - insets.right) / 2
            let visibleMidY = insets.top + (bounds.height - insets.top - insets.bottom) / 2
            let dx = bounds.midX - visibleMidX
            let dy = bounds.midY - visibleMidY
            let pointsPerScreenPoint = mapView.visibleMapRect.width / Double(bounds.width)
            var target = MKMapPoint(coordinate)
            target.x += Double(dx) * pointsPerScreenPoint
            target.y += Double(dy) * pointsPerScreenPoint
            return target.coordinate
        }

        /// One-shot recentre on the device's own location, from
        /// `RecenterButton` - see `centerOnUserLocationTrigger`'s doc
        /// comment for why this bypasses `applyCamera`'s equality gate.
        /// `mapView.userLocation` is MapKit's own tracked position (valid
        /// once `showsUserLocation` is on and a fix has arrived) - no need
        /// to thread the app's own `LocationProvider` coordinate through.
        func applyCenterOnUserLocationTrigger(_ trigger: Int, to mapView: MKMapView) {
            guard trigger != lastCenterOnUserLocationTrigger else { return }
            lastCenterOnUserLocationTrigger = trigger

            guard mapView.showsUserLocation, mapView.userLocation.location != nil else { return }

            mapView.setRegion(
                MKCoordinateRegion(
                    center: mapView.userLocation.coordinate,
                    latitudinalMeters: 1200,
                    longitudinalMeters: 1200
                ),
                animated: true
            )
        }

        // MARK: - MKMapViewDelegate

        /// MapKit's own location fixes can land between SwiftUI renders -
        /// keep a `.followUser` camera on the dot as it moves.
        func mapView(_ mapView: MKMapView, didUpdate userLocation: MKUserLocation) {
            if case .followUser = parent.camera {
                applyCamera(parent.camera, to: mapView)
            }
        }

        func mapView(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool) {
            // A change the person made with their fingers (pan, pinch,
            // rotate) - programmatic moves never have an active gesture.
            let gestureDriven = mapView.subviews.first?.gestureRecognizers?.contains {
                $0.state == .began || $0.state == .changed
            } ?? false
            if gestureDriven {
                parent.onUserInteraction?()
            }
        }

        func mapView(
            _ mapView: MKMapView,
            regionDidChangeAnimated animated: Bool
        ) {
            parent.onVisibleRegionChange?(mapView.region)
        }

        func mapView(
            _ mapView: MKMapView,
            viewFor annotation: MKAnnotation
        ) -> MKAnnotationView? {

            if annotation is MKUserLocation {
                return nil
            }

            if let cluster = annotation as? MKClusterAnnotation {
                let view = mapView.dequeueReusableAnnotationView(
                    withIdentifier: "cluster",
                    for: cluster
                ) as! MKMarkerAnnotationView

                view.markerTintColor = .systemGray
                view.glyphText = "\(cluster.memberAnnotations.count)"
                view.annotation = cluster
                let kind = cluster.memberAnnotations.first is VehicleAnnotation ? "vehicles" : "stops"
                view.accessibilityLabel = "Group of \(cluster.memberAnnotations.count) \(kind)"
                view.accessibilityHint = "Zooms in to show them"

                return view
            }

            if let stop = annotation as? StopAnnotation {
                let view = mapView.dequeueReusableAnnotationView(
                    withIdentifier: "stop",
                    for: stop
                ) as! MKMarkerAnnotationView

                view.annotation = stop
                view.clusteringIdentifier = "stop"
                // Tapping opens the stop straight away (see `didSelect`), so
                // no callout - it would only flash.
                view.canShowCallout = false
                view.accessibilityIdentifier = "stop-\(stop.id)"

                view.markerTintColor = UIColor(
                    hex: stop.stopType == "train"
                        ? "0073bd"
                        : stop.stopType == "ferry"
                            ? "2a286b"
                            : "64748b"
                )

                view.glyphImage = UIImage(
                    systemName: symbolName(
                        forStopType: stop.stopType
                    )
                )

                return view
            }

            if let vehicle = annotation as? VehicleAnnotation {
                let view = mapView.dequeueReusableAnnotationView(
                    withIdentifier: "vehicle",
                    for: vehicle
                ) as! VehicleMarkerView

                view.annotation = vehicle
                view.canShowCallout = true
                // Without this, MapKit never groups nearby vehicles (e.g. a
                // cluster of buses queued at a terminus) the way stops
                // already are - each stayed its own marker regardless of
                // zoom level.
                view.clusteringIdentifier = "vehicle"
                view.zPriority = .max

                view.apply(
                    bearing: vehicle.bearing,
                    colorHex: vehicle.routeColorHex,
                    vehicleType: vehicle.vehicleType
                )

                return view
            }

            if let tripStop = annotation as? TripStopAnnotation {
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: "tripStop", for: tripStop) as! TripStopMarkerView
                view.annotation = tripStop
                view.apply(kind: tripStop.kind)
                return view
            }

            if let waypoint = annotation as? WaypointAnnotation {
                let view = mapView.dequeueReusableAnnotationView(
                    withIdentifier: "waypoint",
                    for: waypoint
                ) as! WaypointMarkerView

                view.annotation = waypoint
                view.apply(label: waypoint.label, isDestination: waypoint.isDestination)

                return view
            }

            return nil
        }

        func mapView(
            _ mapView: MKMapView,
            rendererFor overlay: MKOverlay
        ) -> MKOverlayRenderer {

            guard let line = overlay as? IdentifiedPolyline else {
                return MKOverlayRenderer(overlay: overlay)
            }

            let renderer = CasedPolylineRenderer(polyline: line)
            let color = UIColor(hex: line.colorHex)

            renderer.strokeColor = color
            renderer.lineWidth = line.lineWidth
            renderer.lineCap = .round
            renderer.lineJoin = .round

            if line.isMuted {
                renderer.strokeColor = color.withAlphaComponent(0.6)
                renderer.lineWidth = max(3, line.lineWidth - 1)
            } else if line.isWalk {
                renderer.lineWidth = max(3, line.lineWidth - 1)
                renderer.lineDashPattern = [0, NSNumber(value: Double(renderer.lineWidth) * 2)]
            } else {
                // Dark outline for light/mid colours; a light one for dark
                // colours (navy ferries, black routes) that would otherwise
                // vanish into a dark basemap - and the reverse on light maps.
                let isDarkMap = mapView.traitCollection.userInterfaceStyle == .dark
                let luminance = color.relativeLuminance
                if isDarkMap {
                    renderer.casingColor = luminance < 0.12 ? UIColor.white.withAlphaComponent(0.85) : UIColor.black.withAlphaComponent(0.6)
                } else {
                    renderer.casingColor = luminance > 0.6 ? UIColor.black.withAlphaComponent(0.55) : UIColor.white.withAlphaComponent(0.95)
                }
                renderer.casingWidth = 1.75
            }

            return renderer
        }

        func mapView(
            _ mapView: MKMapView,
            didSelect annotation: MKAnnotation
        ) {
            if let cluster = annotation as? MKClusterAnnotation {
                mapView.deselectAnnotation(cluster, animated: false)
                // A deliberate camera move - stop any auto-follow.
                parent.onUserInteraction?()
                mapView.setVisibleMapRect(Self.expansionRect(for: cluster, in: mapView), animated: true)
            } else if let stop = annotation as? StopAnnotation {
                // Deselect straight away: MapKit never reports a second tap
                // on an annotation that's still selected, so coming back
                // from the board and tapping the same stop did nothing.
                mapView.deselectAnnotation(stop, animated: false)
                parent.onSelectStop?(stop.id)
            } else if let vehicle = annotation as? VehicleAnnotation {
                mapView.deselectAnnotation(vehicle, animated: false)
                parent.onSelectVehicle?(vehicle.id)
            }
        }

        /// Where tapping a cluster zooms to: one step in, enough for the group
        /// to break into its next layer of smaller groups or single markers
        /// (the web's supercluster `getClusterExpansionZoom`), not a jump
        /// straight down to street level. Centred on the group's members and
        /// never tighter than their spread, so none end up off screen.
        static func expansionRect(for cluster: MKClusterAnnotation, in mapView: MKMapView) -> MKMapRect {
            var members = MKMapRect.null
            for member in cluster.memberAnnotations {
                let point = MKMapPoint(member.coordinate)
                members = members.union(MKMapRect(x: point.x, y: point.y, width: 0, height: 0))
            }
            let visible = mapView.visibleMapRect
            let aspect = visible.height / max(visible.width, 1)
            // Two zoom levels in, but loosened to fit the members with a margin.
            var width = visible.width / 4
            width = max(width, members.width * 1.4, members.height * 1.4 / max(aspect, 0.01))
            width = min(width, visible.width / 2)
            let height = width * aspect
            let center = MKMapPoint(x: members.midX, y: members.midY)
            return MKMapRect(x: center.x - width / 2, y: center.y - height / 2, width: width, height: height)
        }

        private func symbolName(forStopType type: String) -> String {
            switch type {
            case "train":
                return "tram.fill"

            case "ferry":
                return "ferry.fill"

            case "bus":
                return "bus.fill"

            default:
                return "mappin"
            }
        }
    }
}

/// A rotated vehicle marker, using the same PNG vehicle icons as the web
/// map (`public/vehicle_icons/`) rather than an SF Symbol, for visual
/// parity - each already has its own rounded-badge look baked in, so this
/// just rotates it for bearing, no extra background chrome needed.
final class VehicleMarkerView: MKAnnotationView {

    private let badge = UIImageView()

    override init(
        annotation: MKAnnotation?,
        reuseIdentifier: String?
    ) {
        super.init(
            annotation: annotation,
            reuseIdentifier: reuseIdentifier
        )

        frame = CGRect(
            x: 0,
            y: 0,
            width: 34,
            height: 34
        )

        centerOffset = .zero

        badge.frame = bounds
        badge.contentMode = .scaleAspectFit

        addSubview(badge)

        canShowCallout = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func apply(
        bearing: Double,
        colorHex: String?,
        vehicleType: String
    ) {
        let imageName: String

        switch vehicleType {
        case "train":
            imageName = "VehicleIconTrain"

        case "ferry":
            imageName = "VehicleIconFerry"

        case "school bus":
            imageName = "VehicleIconSchoolBus"

        default:
            imageName = "VehicleIconBus"
        }

        badge.image = UIImage(named: imageName)

        // bearing == 0 means "no data" on this API - don't rotate.
        if bearing > 0 {
            transform = CGAffineTransform(
                rotationAngle: CGFloat(bearing) * .pi / 180
            )
        } else {
            transform = .identity
        }
    }
}

/// A journey's "Start"/"End" pill bubble - the web map's own plain white
/// (start) / accent-tinted (end) rounded labels
/// (`components/journey/live-map.tsx`), not a route/vehicle marker style.
final class WaypointMarkerView: MKAnnotationView {

    private let pill = UILabel()

    override init(
        annotation: MKAnnotation?,
        reuseIdentifier: String?
    ) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)

        pill.font = .systemFont(ofSize: 12, weight: .semibold)
        pill.textAlignment = .center
        pill.layer.cornerRadius = 11
        pill.layer.masksToBounds = true
        pill.layer.borderWidth = 1

        addSubview(pill)
        canShowCallout = false
        centerOffset = CGPoint(x: 0, y: -11)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func apply(label: String, isDestination: Bool) {
        pill.text = "  \(label)  "
        pill.sizeToFit()
        frame = CGRect(x: 0, y: 0, width: max(pill.frame.width, 44), height: 22)
        pill.frame = bounds

        if isDestination {
            pill.backgroundColor = .systemRed
            pill.textColor = .white
            pill.layer.borderColor = UIColor.white.cgColor
        } else {
            pill.backgroundColor = .white
            pill.textColor = .black
            pill.layer.borderColor = UIColor.black.withAlphaComponent(0.15).cgColor
        }
    }
}
