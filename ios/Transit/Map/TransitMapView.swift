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
    /// Group nearby vehicles into clusters (the browse map); trackers show
    /// one followed vehicle and turn this off.
    var clustersVehicles: Bool = true
    /// Trackers: each vehicle's route, keyed by trip id - those vehicles
    /// glide along it between live positions (`VehicleMotion`).
    var vehicleRoutes: [String: VehicleRoute] = [:]

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
            coordinator.mapDidLayout(mapView)
        }

        mapView.delegate = context.coordinator
        context.coordinator.mapView = mapView
        context.coordinator.installGestureWatchers(on: mapView)
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
        context.coordinator.reconcileMotion(in: mapView)

        context.coordinator.applyCameraReset(cameraResetToken)
        context.coordinator.applyCamera(camera, to: mapView)
        context.coordinator.applyCenterOnUserLocationTrigger(centerOnUserLocationTrigger, to: mapView)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    static func dismantleUIView(_ mapView: MKMapView, coordinator: Coordinator) {
        coordinator.stopMotion()
    }

    @MainActor
    final class Coordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate {

        var parent: TransitMapView
        weak var mapView: MKMapView?

        private var stopsByID: [String: StopAnnotation] = [:]
        private var vehiclesByID: [String: VehicleAnnotation] = [:]
        private var waypointsByID: [String: WaypointAnnotation] = [:]
        private var polylinesByID: [String: IdentifiedPolyline] = [:]
        /// Each line's casing/halo overlay, drawn under it.
        private var companionsByID: [String: IdentifiedPolyline] = [:]

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
            // Walks draw differently flat and tilted - rebuild every line
            // (the reconcile later in this update adds them back).
            mapView.removeOverlays(Array(polylinesByID.values) + Array(companionsByID.values))
            polylinesByID.removeAll()
            companionsByID.removeAll()
            // An automatic camera re-frames for the new mode in this same
            // update; anything else just tilts where it is.
            if applied?.isAutomatic == true, parent.camera != .none {
                applied = nil
            } else {
                // A new camera at the same distance: setting `pitch` on a
                // copy keeps its altitude instead, so tilting doubled the
                // distance - the map zoomed out and MapKit capped the tilt.
                let current = mapView.camera
                let camera = MKMapCamera(
                    lookingAtCenter: current.centerCoordinate, fromDistance: current.centerCoordinateDistance,
                    pitch: is3D ? Map3D.pitch : 0, heading: current.heading
                )
                mapView.setCamera(camera, animated: true)
            }
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
                latestFeed[vehicle.id] = (vehicle.coordinate, vehicle.isAtStop)
                if let existing = vehiclesByID[vehicle.id] {
                    existing.isAtStop = vehicle.isAtStop
                    // Gliding along its route: `VehicleMotion` places it.
                    if motions[vehicle.id] != nil {
                        if existing.routeColorHex != vehicle.routeColorHex {
                            existing.routeColorHex = vehicle.routeColorHex
                            (mapView.view(for: existing) as? VehicleMarkerView)?.apply(
                                bearing: existing.bearing, colorHex: vehicle.routeColorHex,
                                vehicleType: vehicle.vehicleType, mapHeading: mapView.camera.heading
                            )
                        }
                        continue
                    }
                    // Every SwiftUI render hands over the vehicles again -
                    // only touch an annotation that actually changed. Each
                    // coordinate write is a KVO round through MapKit's
                    // annotation manager (which crashed mid-update while the
                    // 3D camera was also moving, in build 57).
                    let from = MKMapPoint(existing.coordinate)
                    let to = MKMapPoint(vehicle.coordinate)
                    let moved = from.distance(to: to)
                    if moved > 0.5 {
                        if moved < 500 {
                            UIView.animate(withDuration: 0.5) {
                                existing.coordinate = vehicle.coordinate
                            }
                        } else {
                            existing.coordinate = vehicle.coordinate
                        }
                    }

                    guard existing.bearing != vehicle.bearing || existing.routeColorHex != vehicle.routeColorHex else { continue }
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
                latestFeed.removeValue(forKey: id)
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
            let companionsToRemove = companionsByID
                .filter { !newIDs.contains($0.key) || changed.contains($0.key) }
            for id in changed { polylinesByID.removeValue(forKey: id) }
            for id in companionsToRemove.keys { companionsByID.removeValue(forKey: id) }

            if !toRemove.isEmpty || !companionsToRemove.isEmpty {
                mapView.removeOverlays(Array(toRemove) + Array(companionsToRemove.values))
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
                // Outline under a coloured route; a halo under a 3D walk
                // (the 2D walk renderer draws its own).
                let companionRole: IdentifiedPolyline.Role? = data.isWalk
                    ? (applied3D == true ? .walkHalo : nil)
                    : (data.isMuted ? nil : .casing)
                if let companionRole {
                    let companion = line.companion(companionRole)
                    companionsByID[data.id] = companion
                    mapView.insertOverlay(companion, below: line)
                }
            }

            for id in polylinesByID.keys
            where !newIDs.contains(id) {
                polylinesByID.removeValue(forKey: id)
            }
        }

        // MARK: - Vehicle motion

        /// Gliding vehicles' models, by trip id, and the route each was built for.
        private var motions: [String: VehicleMotion] = [:]
        private var motionKeys: [String: String] = [:]
        /// Each vehicle's latest live position (and whether it's at a stop).
        private var latestFeed: [String: (coordinate: CLLocationCoordinate2D, atStop: Bool)] = [:]
        private var motionTimer: Timer?
        private static let motionStep: TimeInterval = 1

        func reconcileMotion(in mapView: MKMapView) {
            let routes = parent.vehicleRoutes
            for id in motions.keys where routes[id] == nil || vehiclesByID[id] == nil {
                motions.removeValue(forKey: id)
                motionKeys.removeValue(forKey: id)
            }
            var created = false
            let now = Date()
            for (id, route) in routes {
                guard let annotation = vehiclesByID[id] else { continue }
                if motionKeys[id] != route.key {
                    motionKeys[id] = route.key
                    motions[id] = RouteLine(route.shape).map {
                        VehicleMotion(line: $0, stops: route.stops, vehicleType: annotation.vehicleType)
                    }
                    created = true
                }
                if let feed = latestFeed[id] {
                    motions[id]?.feed(
                        Coordinate(latitude: feed.coordinate.latitude, longitude: feed.coordinate.longitude),
                        stopped: feed.atStop, at: now
                    )
                }
            }
            if created { advanceMotion(in: mapView, glide: 0) }

            if motions.isEmpty {
                stopMotion()
            } else if motionTimer == nil {
                let timer = Timer(timeInterval: Self.motionStep, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated {
                        guard let self, let mapView = self.mapView else { return }
                        self.advanceMotion(in: mapView, glide: Self.motionStep)
                    }
                }
                // `.common`: keeps gliding while the map is being dragged.
                RunLoop.main.add(timer, forMode: .common)
                motionTimer = timer
            }
        }

        func stopMotion() {
            motionTimer?.invalidate()
            motionTimer = nil
        }

        /// One step: each gliding vehicle to where its model says it is now,
        /// animated linearly over the step so it moves continuously.
        private func advanceMotion(in mapView: MKMapView, glide: TimeInterval) {
            let now = Date()
            for (id, var motion) in motions {
                guard let annotation = vehiclesByID[id] else { continue }
                if parent.vehicleRoutes[id]?.riderAboard == true,
                   let location = mapView.userLocation.location,
                   location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 25,
                   now.timeIntervalSince(location.timestamp) < 5 {
                    motion.rider(
                        Coordinate(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude),
                        speed: location.speed >= 0 ? location.speed : nil, at: location.timestamp
                    )
                }
                let step = motion.step(to: now)
                motions[id] = motion
                guard let step else { continue }

                let coordinate = CLLocationCoordinate2D(latitude: step.coordinate.latitude, longitude: step.coordinate.longitude)
                if MKMapPoint(annotation.coordinate).distance(to: MKMapPoint(coordinate)) > 0.3 {
                    if glide > 0 {
                        UIView.animate(withDuration: glide, delay: 0, options: [.curveLinear, .beginFromCurrentState, .allowUserInteraction]) {
                            annotation.coordinate = coordinate
                        }
                    } else {
                        annotation.coordinate = coordinate
                    }
                }
                // 0 is off the route shape - keep the feed's own bearing.
                if step.bearing > 0, abs(step.bearing - annotation.bearing) > 0.5 {
                    annotation.bearing = step.bearing
                    (mapView.view(for: annotation) as? VehicleMarkerView)?.apply(
                        bearing: step.bearing, colorHex: annotation.routeColorHex,
                        vehicleType: annotation.vehicleType, mapHeading: mapView.camera.heading
                    )
                }
            }
            if case .follow(let id, _) = parent.camera, motions[id] != nil {
                applyCamera(parent.camera, to: mapView, glide: glide > 0 ? glide : nil)
            }
        }

        // MARK: - Camera
        //
        // Every camera is worked out directly as an `MKMapCamera` - centre,
        // distance, pitch, heading - rather than via `setVisibleMapRect`,
        // which can't tilt and only ever frames a flat view. So 2D, 3D
        // framing and the 3D chase cam all go through one path, with no
        // instant move-and-restore tricks (those re-laid-out every
        // annotation mid-update, and the follow cam did it on every render).

        /// What the automatic camera last flew to. `updateUIView` runs on
        /// every SwiftUI render (each poll tick, each GPS fix), so a camera
        /// is only re-applied when something meaningful changed - a new
        /// mode, a reset, the drawer or view resizing, the followed target
        /// really moving, or a framed point leaving the screen. Re-applying
        /// on every render restarted the flight and made the zoom wobble.
        private struct AppliedCamera {
            let identity: String
            let camera: MKMapCamera
            let insets: UIEdgeInsets
            let size: CGSize
            /// Follow and frame modes, which keep tracking the journey -
            /// not a screen's one-off starting region.
            let isAutomatic: Bool
        }

        private struct CameraTarget {
            let identity: String
            let camera: MKMapCamera
            var isAutomatic = true
            /// Follow modes: re-applied whenever the target moves or turns.
            var tracksMovement = false
            /// Frame modes: not redone until one of these leaves the
            /// unobscured area, or they bunch up enough to zoom in.
            var keepVisible: [CLLocationCoordinate2D] = []
        }

        private var applied: AppliedCamera?
        /// A camera arrived before the map was laid out - applied on layout.
        private var needsCameraApply = false
        private var lastCameraResetToken = 0
        private var lastCenterOnUserLocationTrigger = 0

        func applyCameraReset(_ token: Int) {
            guard token != lastCameraResetToken else { return }
            lastCameraResetToken = token
            applied = nil
        }

        func applyCamera(_ mode: MapCamera, to mapView: MKMapView, glide: TimeInterval? = nil) {
            // Never move the map out from under the person's fingers.
            guard !isUserTouching else { return }
            guard Self.isLaidOut(mapView) else {
                if mode != .none { needsCameraApply = true }
                return
            }
            guard let target = target(for: mode, in: mapView) else { return }
            let insets = parent.cameraInsets

            if let applied, applied.identity == target.identity {
                let resized = target.isAutomatic
                    && (!Self.isClose(applied.insets, insets) || applied.size != mapView.bounds.size)
                if !resized {
                    if target.tracksMovement {
                        guard Self.hasMoved(from: applied.camera, to: target.camera) else { return }
                    } else if !target.keepVisible.isEmpty {
                        // (Mid-flight a point can look off screen - not a
                        // reason to restart a flight to the same place.)
                        guard needsReframe(target, after: applied, in: mapView),
                              Self.hasMoved(from: applied.camera, to: target.camera) else { return }
                    } else {
                        return
                    }
                }
            }

            if let glide, applied?.identity == target.identity {
                // Following a gliding vehicle: move with it, at its pace,
                // rather than MapKit's ease-in-out hop each second.
                UIView.animate(withDuration: glide, delay: 0, options: [.curveLinear, .beginFromCurrentState, .allowUserInteraction]) {
                    mapView.camera = target.camera
                }
            } else {
                mapView.setCamera(target.camera, animated: true)
            }
            applied = AppliedCamera(
                identity: target.identity, camera: target.camera, insets: insets,
                size: mapView.bounds.size, isAutomatic: target.isAutomatic
            )
        }

        /// The map got its size (or a new one) - apply a camera that had to
        /// wait for layout.
        func mapDidLayout(_ mapView: MKMapView) {
            calibrateFocalLength(of: mapView)
            reportVisibleRegion(of: mapView)
            if needsCameraApply || applied?.isAutomatic == true {
                needsCameraApply = false
                applyCamera(parent.camera, to: mapView)
            }
        }

        private func target(for mode: MapCamera, in mapView: MKMapView) -> CameraTarget? {
            let is3D = applied3D == true
            let heading = applied?.camera.heading ?? mapView.camera.heading
            switch mode {
            case .none:
                return nil

            case .region(let center, let radiusMeters):
                return CameraTarget(
                    identity: "region:\(center.latitude),\(center.longitude),\(radiusMeters)",
                    camera: framingCamera(
                        around: [CLLocationCoordinate2D(latitude: center.latitude, longitude: center.longitude)],
                        minSpanMeters: radiusMeters, padding: 0,
                        pitch: is3D ? Map3D.pitch : 0, heading: heading, in: mapView
                    ),
                    isAutomatic: false
                )

            case .frame(let points, let minSpan):
                guard !points.isEmpty else { return nil }
                let coordinates = points.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
                return CameraTarget(
                    identity: "frame:\(points.count):\(minSpan)",
                    camera: framingCamera(
                        around: coordinates, minSpanMeters: minSpan, padding: 40,
                        pitch: is3D ? Map3D.framePitch : 0, heading: heading, in: mapView
                    ),
                    keepVisible: coordinates
                )

            case .fitAll:
                // Annotation points plus every overlay's corners - a
                // polyline-only map (a journey preview) has no annotations.
                var points: [CLLocationCoordinate2D] = []
                var annotationCount = 0
                for annotation in mapView.annotations where !(annotation is MKUserLocation || annotation is VehicleAnnotation) {
                    points.append(annotation.coordinate)
                    annotationCount += 1
                }
                for overlay in mapView.overlays {
                    let rect = overlay.boundingMapRect
                    points.append(MKMapPoint(x: rect.minX, y: rect.minY).coordinate)
                    points.append(MKMapPoint(x: rect.maxX, y: rect.maxY).coordinate)
                }
                guard !points.isEmpty else { return nil }
                return CameraTarget(
                    // Re-fits once when the route arrives after the markers.
                    identity: "fitAll:\(annotationCount):\(mapView.overlays.count)",
                    camera: framingCamera(
                        around: points, minSpanMeters: 300, padding: 30,
                        pitch: is3D ? Map3D.framePitch : 0, heading: heading, in: mapView
                    )
                )

            case .follow(let id, let spanMeters):
                let vehicle = vehiclesByID[id]
                guard let coordinate = vehicle?.coordinate ?? stopsByID[id]?.coordinate else { return nil }
                // 0 is "no bearing data" on this API.
                let bearing = vehicle.flatMap { $0.bearing > 0 ? $0.bearing : nil }
                return followTarget(coordinate, key: "follow:\(id)", spanMeters: spanMeters, heading: bearing, in: mapView)

            case .followUser(let spanMeters):
                guard mapView.showsUserLocation, let location = mapView.userLocation.location else { return nil }
                // GPS course only means something once you're moving.
                let course = location.course >= 0 && location.speed > 1 && location.courseAccuracy >= 0 && location.courseAccuracy < 35
                    ? location.course : nil
                return followTarget(location.coordinate, key: "followUser", spanMeters: spanMeters, heading: course, in: mapView)
            }
        }

        /// Follow `coordinate`: flat and north-up-as-you-left-it in 2D; in
        /// 3D a third-person chase cam - behind the target, looking along
        /// `heading` (the vehicle's bearing, or your course), steeply tilted.
        /// No heading keeps the current one.
        private func followTarget(
            _ coordinate: CLLocationCoordinate2D, key: String, spanMeters: Double?, heading: Double?, in mapView: MKMapView
        ) -> CameraTarget {
            let currentHeading = applied?.camera.heading ?? mapView.camera.heading
            let camera: MKMapCamera
            if applied3D == true {
                // Far enough back to clear city towers - a walking follow's
                // small span put the camera among the CBD's buildings.
                camera = cameraPlacing(
                    coordinate, distance: max(600, (spanMeters ?? 1000) * 0.45),
                    pitch: Map3D.followPitch, heading: heading ?? currentHeading, in: mapView
                )
            } else if let spanMeters {
                camera = framingCamera(around: [coordinate], minSpanMeters: spanMeters, padding: 0, pitch: 0, heading: currentHeading, in: mapView)
            } else {
                let distance = applied?.camera.centerCoordinateDistance ?? mapView.camera.centerCoordinateDistance
                camera = cameraPlacing(coordinate, distance: distance, pitch: 0, heading: currentHeading, in: mapView)
            }
            return CameraTarget(identity: key, camera: camera, tracksMovement: true)
        }

        /// A `.frame` stays put while its points are comfortably on screen -
        /// the rider's GPS changes them on every fix.
        private func needsReframe(_ target: CameraTarget, after applied: AppliedCamera, in mapView: MKMapView) -> Bool {
            // Bunched up (the bus has nearly reached you) - zoom in.
            if target.camera.centerCoordinateDistance < applied.camera.centerCoordinateDistance * 0.55 { return true }
            let insets = parent.cameraInsets
            let visible = mapView.bounds.inset(by: insets).insetBy(dx: 16, dy: 16)
            guard !visible.isEmpty else { return false }
            return target.keepVisible.contains { !visible.contains(mapView.convert($0, toPointTo: mapView)) }
        }

        /// A camera at `pitch`/`heading` that fits `points` (at least
        /// `minSpanMeters` each way) inside the unobscured area, less
        /// `padding`. Tilted, the ground below the centre is the tightest
        /// fit, so the distance is chosen for that half.
        private func framingCamera(
            around points: [CLLocationCoordinate2D], minSpanMeters: Double, padding: CGFloat,
            pitch: Double, heading: Double, in mapView: MKMapView
        ) -> MKMapCamera {
            let origin = MKMapPoint(points[0])
            let pointsPerMeter = MKMapPointsPerMeterAtLatitude(points[0].latitude)
            let h = heading * .pi / 180
            // Each point in metres along the view (forward) and across it.
            var minForward = Double.infinity, maxForward = -Double.infinity
            var minRight = Double.infinity, maxRight = -Double.infinity
            for point in points {
                let mapPoint = MKMapPoint(point)
                let east = (mapPoint.x - origin.x) / pointsPerMeter
                let north = -(mapPoint.y - origin.y) / pointsPerMeter
                let forward = east * sin(h) + north * cos(h)
                let right = east * cos(h) - north * sin(h)
                minForward = min(minForward, forward); maxForward = max(maxForward, forward)
                minRight = min(minRight, right); maxRight = max(maxRight, right)
            }
            let midForward = (minForward + maxForward) / 2
            let midRight = (minRight + maxRight) / 2
            let halfDepth = max(maxForward - minForward, minSpanMeters) / 2
            let halfWidth = max(maxRight - minRight, minSpanMeters) / 2

            let east = midRight * cos(h) + midForward * sin(h)
            let north = -midRight * sin(h) + midForward * cos(h)
            let center = MKMapPoint(x: origin.x + east * pointsPerMeter, y: origin.y - north * pointsPerMeter).coordinate

            let insets = parent.cameraInsets
            let bounds = mapView.bounds
            let halfVisibleHeight = max(40, (bounds.height - insets.top - insets.bottom) / 2 - padding)
            let halfVisibleWidth = max(40, (bounds.width - insets.left - insets.right) / 2 - padding)
            let f = focalLength(of: mapView)
            let p = pitch * .pi / 180
            let nearAngle = atan(Double(halfVisibleHeight) / f)
            // Ground from the centre to the bottom edge, per metre of distance.
            let nearReach = cos(p) * (tan(p) - tan(p - nearAngle))
            // How much closer the bottom edge is than the centre.
            let nearSlant = cos(p) / cos(p - nearAngle)
            let distance = max(
                halfDepth / nearReach,
                halfWidth * f / Double(halfVisibleWidth) / nearSlant,
                150
            )
            return cameraPlacing(center, distance: min(distance, 30_000_000), pitch: pitch, heading: heading, in: mapView)
        }

        /// A camera `distance` from the ground, at `pitch`/`heading`, that
        /// shows `target` in the middle of the unobscured area (clear of the
        /// drawer and top controls) rather than the middle of the view - it
        /// looks at the ground that far behind/beside the target.
        private func cameraPlacing(
            _ target: CLLocationCoordinate2D, distance: Double, pitch: Double, heading: Double, in mapView: MKMapView
        ) -> MKMapCamera {
            let insets = parent.cameraInsets
            let dx = Double((insets.left - insets.right) / 2)
            let dy = Double((insets.top - insets.bottom) / 2)
            let f = focalLength(of: mapView)
            let p = pitch * .pi / 180
            let cameraHeight = distance * cos(p)
            // The target's ray, measured from straight down (positive dy is
            // lower on screen, so nearer).
            let targetAngle = min(max(p - atan(dy / f), -1.4), 1.4)
            let ahead = cameraHeight * (tan(targetAngle) - tan(p))
            let across = dx / f * cameraHeight / cos(targetAngle)

            let h = heading * .pi / 180
            let east = ahead * sin(h) + across * cos(h)
            let north = ahead * cos(h) - across * sin(h)
            let pointsPerMeter = MKMapPointsPerMeterAtLatitude(target.latitude)
            let t = MKMapPoint(target)
            let center = MKMapPoint(x: t.x - east * pointsPerMeter, y: t.y + north * pointsPerMeter).coordinate
            return MKMapCamera(
                lookingAtCenter: CLLocationCoordinate2DIsValid(center) ? center : target,
                fromDistance: distance, pitch: CGFloat(pitch), heading: heading
            )
        }

        /// The map's focal length in screen points - how far, in points, the
        /// eye sits from the screen. Measured off the camera (ground covered
        /// by a few points either side of the centre) whenever the map comes
        /// to rest - mid-flight the camera's reported pitch/distance and the
        /// drawn view disagree, which threw the framing distance off.
        private var cachedFocalLength: Double = 1400

        private func focalLength(of mapView: MKMapView) -> Double {
            cachedFocalLength
        }

        func calibrateFocalLength(of mapView: MKMapView) {
            let bounds = mapView.bounds
            let camera = mapView.camera
            guard Self.isLaidOut(mapView), camera.centerCoordinateDistance > 1 else { return }
            let a = mapView.convert(CGPoint(x: bounds.midX, y: bounds.midY - 20), toCoordinateFrom: mapView)
            let b = mapView.convert(CGPoint(x: bounds.midX, y: bounds.midY + 20), toCoordinateFrom: mapView)
            guard CLLocationCoordinate2DIsValid(a), CLLocationCoordinate2DIsValid(b) else { return }
            let ground = CLLocation(latitude: a.latitude, longitude: a.longitude)
                .distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude))
            let pitch = Double(camera.pitch) * .pi / 180
            guard ground > 0.01 else { return }
            let f = 40 * camera.centerCoordinateDistance / (ground * cos(pitch))
            if (200...6000).contains(f) { cachedFocalLength = f }
        }

        private static func isLaidOut(_ mapView: MKMapView) -> Bool {
            mapView.bounds.width > 1 && mapView.bounds.height > 1
        }

        private static func isClose(_ a: UIEdgeInsets, _ b: UIEdgeInsets) -> Bool {
            abs(a.top - b.top) < 12 && abs(a.bottom - b.bottom) < 12 && abs(a.left - b.left) < 12 && abs(a.right - b.right) < 12
        }

        /// Far enough to be worth a camera move: GPS jitter and a bus
        /// sitting at a stop shouldn't keep restarting the flight.
        private static func hasMoved(from a: MKMapCamera, to b: MKMapCamera) -> Bool {
            let meters = MKMapPoint(a.centerCoordinate).distance(to: MKMapPoint(b.centerCoordinate))
            let turn = abs((b.heading - a.heading + 540).truncatingRemainder(dividingBy: 360) - 180)
            let zoom = abs(b.centerCoordinateDistance / max(a.centerCoordinateDistance, 1) - 1)
            return meters > 3 || turn > 4 || zoom > 0.05
        }

        /// One-shot recentre on the device's own location, from
        /// `RecenterButton` - see `centerOnUserLocationTrigger`'s doc
        /// comment for why this bypasses `applyCamera`'s gate.
        /// `mapView.userLocation` is MapKit's own tracked position (valid
        /// once `showsUserLocation` is on and a fix has arrived).
        func applyCenterOnUserLocationTrigger(_ trigger: Int, to mapView: MKMapView) {
            guard trigger != lastCenterOnUserLocationTrigger else { return }
            lastCenterOnUserLocationTrigger = trigger
            guard mapView.showsUserLocation, let location = mapView.userLocation.location, Self.isLaidOut(mapView) else { return }
            let camera = framingCamera(
                around: [location.coordinate], minSpanMeters: 1200, padding: 0,
                pitch: applied3D == true ? Map3D.pitch : 0, heading: mapView.camera.heading, in: mapView
            )
            mapView.setCamera(camera, animated: true)
        }

        // MARK: - Gestures

        /// The person's own pans, pinches, twists and tilts - watched with
        /// our own recognisers (alongside MapKit's) rather than by peeking
        /// at MapKit's private ones, which missed gestures and let the
        /// automatic camera fight the person's fingers.
        private var gestureRecognizers: [UIGestureRecognizer] = []

        private var isUserTouching: Bool {
            gestureRecognizers.contains { $0.state == .began || $0.state == .changed }
        }

        func installGestureWatchers(on mapView: MKMapView) {
            let doubleTap = UITapGestureRecognizer()
            doubleTap.numberOfTapsRequired = 2
            gestureRecognizers = [UIPanGestureRecognizer(), UIPinchGestureRecognizer(), UIRotationGestureRecognizer(), doubleTap]
            for recognizer in gestureRecognizers {
                recognizer.addTarget(self, action: #selector(userGesture(_:)))
                recognizer.delegate = self
                recognizer.cancelsTouchesInView = false
                recognizer.delaysTouchesEnded = false
                mapView.addGestureRecognizer(recognizer)
            }
        }

        @objc private func userGesture(_ recognizer: UIGestureRecognizer) {
            if recognizer.state == .began || recognizer.state == .recognized {
                parent.onUserInteraction?()
            }
        }

        nonisolated func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }

        // MARK: - MKMapViewDelegate

        /// MapKit's own location fixes can land between SwiftUI renders -
        /// keep a `.followUser` camera on the dot as it moves.
        func mapView(_ mapView: MKMapView, didUpdate userLocation: MKUserLocation) {
            if case .followUser = parent.camera {
                applyCamera(parent.camera, to: mapView)
            }
        }

        func mapView(
            _ mapView: MKMapView,
            regionDidChangeAnimated animated: Bool
        ) {
            calibrateFocalLength(of: mapView)
            reportVisibleRegion(of: mapView)
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
                // Not on a tracker's single followed vehicle, though - it
                // never needs grouping, and keeping it out of clustering
                // keeps its constant moves off MapKit's cluster bookkeeping.
                view.clusteringIdentifier = parent.clustersVehicles ? "vehicle" : nil
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
            let isDarkMap = mapView.traitCollection.userInterfaceStyle == .dark
            let walkDotColor = isDarkMap ? UIColor(hex: "E2E8F0") : UIColor(hex: "334155")
            let walkHaloColor = isDarkMap ? UIColor.black.withAlphaComponent(0.7) : UIColor.white
            let walkDot = max(5, line.lineWidth)

            // Only plain `MKPolylineRenderer`s below, except the flat walk:
            // see `IdentifiedPolyline.Role` for why.
            let renderer = MKPolylineRenderer(polyline: line)
            renderer.lineCap = .round
            renderer.lineJoin = .round
            let color = UIColor(hex: line.colorHex)

            switch line.role {
            case .casing:
                // Dark outline for light/mid colours; a light one for dark
                // colours (navy ferries, black routes) that would otherwise
                // vanish into a dark basemap - and the reverse on light maps.
                let luminance = color.relativeLuminance
                if isDarkMap {
                    renderer.strokeColor = luminance < 0.12 ? UIColor.white.withAlphaComponent(0.85) : UIColor.black.withAlphaComponent(0.6)
                } else {
                    renderer.strokeColor = luminance > 0.6 ? UIColor.black.withAlphaComponent(0.55) : UIColor.white.withAlphaComponent(0.95)
                }
                renderer.lineWidth = line.lineWidth + 3.5
                return renderer

            case .walkHalo:
                renderer.strokeColor = walkHaloColor
                renderer.lineWidth = Self.walkLineWidth + 3
                return renderer

            case .line:
                break
            }

            if line.isWalk {
                // Tilted, a thin solid line: MapKit drapes overlays on the
                // ground, so dots read as squashed discs, and the dash
                // pattern restarted at every vertex - blobs wherever the
                // path's points bunch up.
                if applied3D == true {
                    renderer.strokeColor = walkDotColor
                    renderer.lineWidth = Self.walkLineWidth
                    return renderer
                }
                let walk = WalkPolylineRenderer(polyline: line)
                walk.dotColor = walkDotColor
                walk.haloColor = walkHaloColor
                walk.dotDiameter = walkDot
                return walk
            }

            if line.isMuted {
                renderer.strokeColor = color.withAlphaComponent(0.6)
                renderer.lineWidth = max(3, line.lineWidth - 1)
            } else {
                renderer.strokeColor = color
                renderer.lineWidth = line.lineWidth
            }
            return renderer
        }

        /// A 3D walk's line - thinner than a ride's, so the two read apart.
        private static let walkLineWidth: CGFloat = 4

        func mapView(
            _ mapView: MKMapView,
            didSelect annotation: MKAnnotation
        ) {
            if let cluster = annotation as? MKClusterAnnotation {
                mapView.deselectAnnotation(cluster, animated: false)
                // A deliberate camera move - stop any auto-follow.
                parent.onUserInteraction?()
                let rect = Self.expansionRect(for: cluster, in: mapView)
                let points = [MKMapPoint(x: rect.minX, y: rect.minY).coordinate, MKMapPoint(x: rect.maxX, y: rect.maxY).coordinate]
                let camera = framingCamera(
                    around: points, minSpanMeters: 0, padding: 0,
                    pitch: Double(mapView.camera.pitch), heading: mapView.camera.heading, in: mapView
                )
                mapView.setCamera(camera, animated: true)
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
