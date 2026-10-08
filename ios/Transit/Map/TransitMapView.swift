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
    /// The map's 3D toggle (`Map3DButton`) - realistic terrain and buildings
    /// with a tilted camera, on every map at once.
    @AppStorage(Map3D.storageKey) private var is3D = false

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
        let mapView = LayoutReportingMapView()
        // A resize (the tab laid out for the first time, an iPad rotating
        // or its window changing size) changes what's visible without a
        // pan - `regionDidChangeAnimated` isn't reliably sent for that.
        mapView.onBoundsSizeChange = { [weak coordinator = context.coordinator, weak mapView] in
            guard let coordinator, let mapView else { return }
            coordinator.reportVisibleRegion(of: mapView)
        }

        mapView.delegate = context.coordinator
        mapView.showsUserLocation = showsUserLocation
        context.coordinator.apply3D(is3D, to: mapView)

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
        context.coordinator.apply3D(is3D, to: mapView)

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

        /// The 3D setting last applied - nil until the map's first
        /// configuration, which shouldn't animate a tilt of its own (the
        /// first camera move tilts as it frames).
        private var applied3D: Bool?

        /// Swap the basemap between flat and realistic elevation, and tilt
        /// (or flatten) the camera when the toggle changes.
        func apply3D(_ is3D: Bool, to mapView: MKMapView) {
            guard is3D != applied3D else { return }
            let isToggle = applied3D != nil
            applied3D = is3D

            let configuration = MKStandardMapConfiguration(elevationStyle: is3D ? .realistic : .flat)
            configuration.pointOfInterestFilter = .excludingAll
            mapView.preferredConfiguration = configuration

            guard isToggle else { return }
            // A follow camera re-frames for the new mode on its next update.
            followSpanAppliedFor = nil
            let camera = mapView.camera.copy() as! MKMapCamera
            camera.pitch = is3D ? Map3D.pitch : 0
            mapView.setCamera(camera, animated: true)
        }

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

        /// `stopsByID` holds the annotation objects actually on the map. The
        /// screen hands over fresh `StopAnnotation`s every render, so a stop
        /// already shown keeps its original object - replacing it here (as
        /// this used to) meant a later removal was aimed at an object that
        /// was never added, and the real marker stayed on the map for good:
        /// stale stops after a filter change, and an ever-growing
        /// annotation count.
        private func reconcileStops(
            _ newStops: [StopAnnotation],
            in mapView: MKMapView
        ) {
            let newIDs = Set(newStops.map(\.id))

            let gone = stopsByID.filter { !newIDs.contains($0.key) }
            if !gone.isEmpty {
                mapView.removeAnnotations(Array(gone.values))
                for id in gone.keys { stopsByID.removeValue(forKey: id) }
            }

            var toAdd: [StopAnnotation] = []
            for stop in newStops where stopsByID[stop.id] == nil {
                stopsByID[stop.id] = stop
                toAdd.append(stop)
            }
            if !toAdd.isEmpty {
                mapView.addAnnotations(toAdd)
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
                            vehicleType: vehicle.vehicleType,
                            mapHeading: mapView.camera.heading
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
                move(mapView) { animated in mapView.setVisibleMapRect(rect, edgePadding: insets, animated: animated) }

            case .frame(let points, let minSpan):
                guard camera != lastAppliedCamera, !points.isEmpty else { return }
                lastAppliedCamera = camera
                let rect = Self.mapRect(around: points, minSpanMeters: minSpan)
                let padding = UIEdgeInsets(top: insets.top + 40, left: insets.left + 40, bottom: insets.bottom + 40, right: insets.right + 40)
                move(mapView) { animated in mapView.setVisibleMapRect(rect, edgePadding: padding, animated: animated) }

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
                move(mapView) { animated in mapView.setVisibleMapRect(rect, edgePadding: padding, animated: animated) }

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
                let bearing = vehiclesByID[id]?.bearing ?? 0
                // 0 is "no bearing data" on this API.
                follow(coordinate, key: id, spanMeters: spanMeters, heading: bearing > 0 ? bearing : nil, in: mapView)

            case .followUser(let spanMeters):
                lastAppliedCamera = camera
                guard mapView.showsUserLocation, let location = mapView.userLocation.location else { return }
                // GPS course only means something once you're moving.
                let course = location.course >= 0 && location.speed > 0.7 ? location.course : nil
                follow(location.coordinate, key: Self.userFollowKey, spanMeters: spanMeters, heading: course, in: mapView)
            }
        }

        private static let userFollowKey = "__user_location__"

        /// Centre `coordinate` in the unobscured area - zooming to
        /// `spanMeters` the first time `key` is followed, then leaving the
        /// rider's own pinch-zoom alone.
        private func follow(
            _ coordinate: CLLocationCoordinate2D, key id: String, spanMeters: Double?, heading: Double?, in mapView: MKMapView
        ) {
            if applied3D == true, mapView.bounds.width > 1, mapView.bounds.height > 1 {
                chase(coordinate, key: id, spanMeters: spanMeters, heading: heading, in: mapView)
                return
            }
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
                move(mapView) { animated in mapView.setVisibleMapRect(rect, edgePadding: insets, animated: animated) }
            } else {
                // Keep the zoom; put the point in the middle of the
                // unobscured area rather than the middle of the view.
                let center = Self.center(placing: coordinate, inInsets: insets, of: mapView)
                move(mapView) { animated in mapView.setCenter(center, animated: animated) }
            }
        }

        /// The 3D follow camera: behind `coordinate`, looking along
        /// `heading` (the vehicle's bearing, or your course), steeply tilted
        /// like a third-person chase cam - keeping the rider's own zoom
        /// after the first frame. No heading keeps the current one.
        private func chase(
            _ coordinate: CLLocationCoordinate2D, key id: String, spanMeters: Double?, heading: Double?, in mapView: MKMapView
        ) {
            let distance: CLLocationDistance
            if followSpanAppliedFor != id {
                followSpanAppliedFor = id
                distance = max(250, (spanMeters ?? 1000) * 0.45)
            } else {
                distance = mapView.camera.centerCoordinateDistance
            }
            let camera = MKMapCamera(
                lookingAtCenter: coordinate,
                fromDistance: distance,
                pitch: Map3D.followPitch,
                heading: heading ?? mapView.camera.heading
            )

            // Put the target in the middle of the unobscured area rather
            // than the view's: aim at the ground that sits as far behind it
            // on screen as that area's centre is above the view's.
            let start = mapView.camera.copy() as! MKMapCamera
            mapView.setCamera(camera, animated: false)
            let insets = parent.cameraInsets
            let bounds = mapView.bounds
            let visibleMid = CGPoint(
                x: insets.left + (bounds.width - insets.left - insets.right) / 2,
                y: insets.top + (bounds.height - insets.top - insets.bottom) / 2
            )
            let aim = CGPoint(x: 2 * bounds.midX - visibleMid.x, y: 2 * bounds.midY - visibleMid.y)
            if bounds.contains(aim) {
                let center = mapView.convert(aim, toCoordinateFrom: mapView)
                if CLLocationCoordinate2DIsValid(center) { camera.centerCoordinate = center }
            }
            mapView.setCamera(start, animated: false)
            mapView.setCamera(camera, animated: true)
        }

        /// A 3D move made before layout, still to be tilted.
        private var pendingTilt = false

        /// Run a framing move (`setVisibleMapRect`/`setCenter`/`setRegion`).
        /// Those flatten the camera, so in 3D the move is made instantly to
        /// find where it lands, then the camera flies there tilted - one
        /// animation, nothing drawn in between.
        private func move(_ mapView: MKMapView, _ change: (_ animated: Bool) -> Void) {
            guard applied3D == true else {
                change(true)
                return
            }
            // Not laid out yet (first render): an instant move has no real
            // size to frame against and lands nowhere - let MapKit defer it
            // as usual, and tilt once the map settles.
            guard mapView.bounds.width > 1, mapView.bounds.height > 1 else {
                change(true)
                pendingTilt = true
                return
            }
            let start = mapView.camera.copy() as! MKMapCamera
            change(false)
            let target = mapView.camera.copy() as! MKMapCamera
            target.pitch = Map3D.pitch
            mapView.setCamera(start, animated: false)
            mapView.setCamera(target, animated: true)
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

            move(mapView) { animated in
                mapView.setRegion(
                    MKCoordinateRegion(
                        center: mapView.userLocation.coordinate,
                        latitudinalMeters: 1200,
                        longitudinalMeters: 1200
                    ),
                    animated: animated
                )
            }
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
            reportVisibleRegion(of: mapView)
            if pendingTilt, applied3D == true, mapView.bounds.width > 1, mapView.bounds.height > 1 {
                pendingTilt = false
                let camera = mapView.camera.copy() as! MKMapCamera
                camera.pitch = Map3D.pitch
                mapView.setCamera(camera, animated: true)
            }
        }

        /// While a pan/zoom is still moving too - a few times a second, so
        /// stops fill in as you drag rather than only once the map settles.
        func mapViewDidChangeVisibleRegion(_ mapView: MKMapView) {
            updateVehicleHeadings(in: mapView)
            guard Date().timeIntervalSince(lastRegionReport) > 0.25 else { return }
            reportVisibleRegion(of: mapView)
        }

        private var lastRegionReport = Date.distantPast
        private var markerMapHeading: CLLocationDirection = 0

        /// Vehicle pointers are drawn in screen space - turn them with the
        /// map when it rotates (the chase cam, or a two-finger twist).
        private func updateVehicleHeadings(in mapView: MKMapView) {
            let heading = mapView.camera.heading
            guard abs(heading - markerMapHeading) > 0.5 else { return }
            markerMapHeading = heading
            for vehicle in vehiclesByID.values {
                (mapView.view(for: vehicle) as? VehicleMarkerView)?.apply(mapHeading: heading)
            }
        }

        func reportVisibleRegion(of mapView: MKMapView) {
            guard let onVisibleRegionChange = parent.onVisibleRegionChange,
                  // A not-yet-laid-out map (an off-screen tab) has no real
                  // region - reporting it filtered every stop away.
                  mapView.bounds.width > 1, mapView.bounds.height > 1 else { return }
            lastRegionReport = Date()
            onVisibleRegionChange(mapView.region)
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
                    vehicleType: vehicle.vehicleType,
                    mapHeading: mapView.camera.heading
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
                view.apply(waypoint)

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

            if line.isWalk {
                let renderer = WalkPolylineRenderer(polyline: line)
                let isDarkMap = mapView.traitCollection.userInterfaceStyle == .dark
                renderer.dotColor = isDarkMap ? UIColor(hex: "E2E8F0") : UIColor(hex: "334155")
                renderer.haloColor = isDarkMap ? UIColor.black.withAlphaComponent(0.7) : .white
                renderer.dotDiameter = max(5, line.lineWidth)
                return renderer
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
                let rect = Self.expansionRect(for: cluster, in: mapView)
                move(mapView) { animated in mapView.setVisibleMapRect(rect, animated: animated) }
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

/// A live vehicle: its mode symbol on its route colour (dark when the route
/// has none), kept upright, with a small pointer riding round the edge for
/// its bearing - the web map's vehicle marker (`markers/icons.ts`).
final class VehicleMarkerView: MKAnnotationView {

    private static let diameter: CGFloat = 30
    private static var cache: [String: UIImage] = [:]

    private let badge = UIImageView()
    private let pointerHost = UIView()
    private let pointer = CAShapeLayer()

    override init(
        annotation: MKAnnotation?,
        reuseIdentifier: String?
    ) {
        super.init(
            annotation: annotation,
            reuseIdentifier: reuseIdentifier
        )

        frame = CGRect(x: 0, y: 0, width: 46, height: 46)
        centerOffset = .zero

        pointerHost.frame = bounds
        pointerHost.isUserInteractionEnabled = false
        let path = UIBezierPath()
        path.move(to: CGPoint(x: bounds.midX - 5, y: 8))
        path.addLine(to: CGPoint(x: bounds.midX + 5, y: 8))
        path.addLine(to: CGPoint(x: bounds.midX, y: 1))
        path.close()
        pointer.path = path.cgPath
        pointer.strokeColor = UIColor.white.cgColor
        pointer.lineWidth = 1.5
        pointer.lineJoin = .round
        pointerHost.layer.addSublayer(pointer)
        addSubview(pointerHost)

        badge.frame = bounds
        badge.contentMode = .center
        addSubview(badge)

        canShowCallout = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private var bearing: Double = 0
    private var mapHeading: Double = 0

    func apply(
        bearing: Double,
        colorHex: String?,
        vehicleType: String,
        mapHeading: Double
    ) {
        self.bearing = bearing
        self.mapHeading = mapHeading
        let fill = colorHex.map { UIColor(hex: $0) } ?? MapMarkerArt.foreground
        let symbol = MapMarkerArt.symbolName(forMode: vehicleType)
        let key = "\(symbol)|\(colorHex ?? "")"
        if let cached = Self.cache[key] {
            badge.image = cached
        } else {
            let image = MapMarkerArt.badge(symbol: symbol, fill: fill, diameter: Self.diameter)
            Self.cache[key] = image
            badge.image = image
        }

        pointer.fillColor = fill.cgColor
        // bearing == 0 means "no data" on this API - no pointer.
        pointerHost.isHidden = bearing <= 0
        rotatePointer()
    }

    /// The map turned - bearing is true north, the pointer is on screen.
    func apply(mapHeading: Double) {
        self.mapHeading = mapHeading
        rotatePointer()
    }

    private func rotatePointer() {
        pointerHost.transform = CGAffineTransform(rotationAngle: CGFloat(bearing - mapHeading) * .pi / 180)
    }
}

/// A journey's "Start"/"End" pill bubble - the web map's own plain white
/// (start) / accent-tinted (end) rounded labels
/// (`components/journey/live-map.tsx`), not a route/vehicle marker style.
final class WaypointMarkerView: MKAnnotationView {
    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        canShowCallout = false
        isAccessibilityElement = true
        // Journey markers never hide behind each other or the map's labels.
        displayPriority = .required
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func apply(_ waypoint: WaypointAnnotation) {
        accessibilityLabel = waypoint.label
        centerOffset = .zero
        switch waypoint.kind {
        case .start:
            image = MapMarkerArt.badge(symbol: "location.fill", fill: MapMarkerArt.foreground, diameter: 26)
            zPriority = .max
        case .end:
            image = MapMarkerArt.badge(symbol: "flag.checkered", fill: .systemRed, diameter: 26)
            zPriority = .max
        case .transfer:
            image = MapMarkerArt.badge(symbol: "arrow.left.arrow.right", fill: MapMarkerArt.foreground, diameter: 20)
            zPriority = MKAnnotationViewZPriority(rawValue: 600)
        case .board(let name, let hex):
            image = MapMarkerArt.routeTag(name, colorHex: hex)
            zPriority = MKAnnotationViewZPriority(rawValue: 500)
            // Up and to the right of the stop, clear of whatever marks it.
            if let size = image?.size {
                centerOffset = CGPoint(x: size.width / 2 + 6, y: -(size.height / 2 + 4))
            }
        case .alight(let hex):
            image = MapMarkerArt.ring(colorHex: hex, diameter: 14)
            zPriority = MKAnnotationViewZPriority(rawValue: 400)
        }
    }
}

/// Tells the map's coordinator when its size changes (see `makeUIView`).
final class LayoutReportingMapView: MKMapView {
    var onBoundsSizeChange: (() -> Void)?
    private var lastSize: CGSize = .zero

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != lastSize else { return }
        lastSize = bounds.size
        // Out of the layout pass - the callback updates SwiftUI state.
        DispatchQueue.main.async { [weak self] in self?.onBoundsSizeChange?() }
    }
}
