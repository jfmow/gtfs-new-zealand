import SwiftData
import SwiftUI
import TransitCore

/// The journey being tracked - app-wide, so it keeps going when the
/// tracker screen is minimised or the app is in the background.
/// `JourneyTrackingView` just renders it.
///
/// Built to work with no connection (friends without mobile data who start
/// a journey on wifi, then leave the house):
/// - Starting a journey downloads an `OfflineJourneyPack` - every ride's
///   stops, the latest predictions, route shapes and walking directions -
///   and keeps it up to date while there's a connection.
/// - Two loops: `fetch` talks to the server (and may hang on a bad
///   connection); `tick` works out progress on the device from the clock,
///   the rider's GPS and whatever data it has. Progress never waits on the
///   network.
/// - On board with no realtime, `OfflineRideEstimator` places the rider on
///   the trip's stops from their GPS - stops away, "your stop is next" and
///   getting off all keep working.
/// - While a journey is on, location runs in the background, so the app
///   keeps tracking with the screen off; get-on/get-off moments become
///   local notifications while offline (the server can't push them), and
///   timetable-based ones are scheduled ahead in case iOS suspends the app.
@MainActor
@Observable
final class JourneyTrackingSession {
    private let api: APIClient
    private let location: LocationProvider
    private let network: NetworkMonitor
    private let liveActivity: LiveActivityCoordinator
    private let push: PushRegistrationService
    private let store = OfflineJourneyStore()
    private let notifications = JourneyOfflineNotifications()
    private let alertCenter = JourneyAlertCenter()
    private let walkTracker = WalkNavigationTracker()
    @ObservationIgnored private var progressModel = JourneyProgressModel()
    @ObservationIgnored private var estimator = OfflineRideEstimator()
    /// Holds each vehicle at the furthest stop it has reached through the
    /// feed's brief step-backs, so stops-away doesn't flick 2 -> 3 -> 2.
    @ObservationIgnored private var ratchet = VehicleProgressRatchet()
    @ObservationIgnored private var modelContext: ModelContext?
    @ObservationIgnored private var pack: OfflineJourneyPack?

    private(set) var plan: JourneyPlan?
    private(set) var regionSlug = ""
    private(set) var displayPlan: JourneyPlan?
    private(set) var snapshot: JourneyProgressModel.Snapshot?
    /// Live vehicles from the feed, with the rider's GPS standing in for
    /// the ride they're on when the feed can't be reached.
    private(set) var vehiclesByTripID: [String: Vehicle] = [:]
    private(set) var estimatedTripIDs: Set<String> = []
    /// The last predictions downloaded - re-timed by the rider's GPS on a
    /// ride being estimated.
    private(set) var stopTimesByTripID: [String: [StopTimeUpdate]] = [:]
    private(set) var tripStops: [String: [TripStopRef]] = [:]
    /// The tracked ride's stop list.
    private(set) var trackedStops: [TripStopRef] = []
    private(set) var rideShapes: [String: RouteShape] = [:]
    private(set) var walkDirections: WalkingDirections?
    private(set) var walkLegIndex: Int?
    private(set) var walkStep: WalkNavigationTracker.Snapshot?
    private(set) var alertStack: [JourneyAlert] = []
    /// When live vehicle positions last loaded.
    private(set) var lastLiveFetch: Date?
    /// When predictions last loaded.
    private(set) var lastStopTimesFetch: Date?
    /// No usable connection: no network path, or the server hasn't
    /// answered twice running (wifi that goes nowhere, a dead cell signal).
    private(set) var isOffline = false
    /// Everything needed to carry on without a connection is saved.
    private(set) var isOfflineReady = false
    private(set) var isAppActive = true

    @ObservationIgnored private var liveVehicles: [String: Vehicle] = [:]
    @ObservationIgnored private var fetchedStopTimes: [String: [StopTimeUpdate]] = [:]
    @ObservationIgnored private var failedFetches = 0
    @ObservationIgnored private var fetchTask: Task<Void, Never>?
    @ObservationIgnored private var tickTask: Task<Void, Never>?
    /// Which loop is current - a cancelled one finishing late mustn't
    /// clear its replacement.
    @ObservationIgnored private var fetchLoopID = UUID()
    @ObservationIgnored private var tickLoopID = UUID()
    @ObservationIgnored private var lastTick = Date.distantPast
    @ObservationIgnored private var liveWalkLegIndex: Int?
    @ObservationIgnored private var backgroundLocationOn = false
    @ObservationIgnored private var lastPackSave = Date.distantPast
    @ObservationIgnored private var lastSentActivity: (state: JourneyActivityAttributes.ContentState, at: Date)?
    @ObservationIgnored private var lastReportedLeg: (index: Int, phase: String, at: Date)?
    @ObservationIgnored private var savedAlightedThroughLeg = -1
    @ObservationIgnored private var activityUpdateInFlight = false

    /// Positions older than this are dropped - it's no longer where the
    /// vehicle is.
    private static let liveDataMaxAge: TimeInterval = 120
    /// Past this, the rider's own GPS is trusted over the feed's last word.
    private static let liveFreshAge: TimeInterval = 30
    private static let resumeGrace: TimeInterval = 45 * 60

    init(api: APIClient, location: LocationProvider, network: NetworkMonitor, liveActivity: LiveActivityCoordinator, push: PushRegistrationService) {
        self.api = api
        self.location = location
        self.network = network
        self.liveActivity = liveActivity
        self.push = push

        location.onUpdate = { [weak self] in self?.locationDidUpdate() }
        network.onChange = { [weak self] connected in
            guard let self, self.plan != nil else { return }
            if connected {
                self.startFetching()  // catch up straight away
            } else {
                self.updateOfflineState()
                self.tick()
            }
        }
        alertCenter.onFire = { [weak self] alert in
            guard let self, !self.isAppActive, self.isOffline, let url = self.notificationURL else { return }
            Task { await self.notifications.deliverNow(key: alert.id, title: alert.title, body: alert.body, url: url) }
        }
    }

    func isTracking(_ planID: String) -> Bool { plan?.id == planID }

    /// The saved plan for a journey, for reopening it with no connection.
    func offlinePlan(id: String) -> JourneyPlan? {
        if plan?.id == id { return plan }
        return store.load(planID: id)?.plan
    }

    // MARK: - Lifecycle

    /// Starts tracking `plan` - or carries on, if it's the one already
    /// being tracked.
    func begin(plan: JourneyPlan, region: Region, modelContext: ModelContext) {
        self.modelContext = modelContext
        location.requestPermission()
        location.startUpdating()
        if self.plan?.id == plan.id {
            if fetchTask == nil { startFetching() }
            startTicking()
            return
        }
        if self.plan != nil { stopLoops() }
        resetState()

        self.plan = plan
        regionSlug = region.slug
        displayPlan = plan

        if let saved = activeJourney(planID: plan.id) {
            progressModel.restore(alightedThroughLeg: saved.alightedThroughLeg)
            savedAlightedThroughLeg = saved.alightedThroughLeg
        } else if let arrival = plan.arrivalTime.date {
            // Opened from a link, a Live Activity or a reminder rather than
            // the planner's "Start": record it as the tracked journey too,
            // so leaving the tracker leaves the resume pill behind instead
            // of losing the journey. Only one journey is tracked at a time.
            for old in (try? modelContext.fetch(FetchDescriptor<ActiveJourney>())) ?? [] { modelContext.delete(old) }
            modelContext.insert(ActiveJourney(
                planID: plan.id, regionSlug: region.slug,
                endLabel: plan.legs.last?.toStop?.stopName ?? "your destination", arrivalTime: arrival
            ))
        }

        // Pick up whatever was saved last time (a relaunch mid-journey),
        // else start a fresh pack for this plan.
        var pack = store.load(planID: plan.id) ?? OfflineJourneyPack(plan: plan, regionSlug: region.slug)
        pack.plan = plan
        self.pack = pack
        store.deleteAll(keeping: plan.id)
        tripStops = pack.tripStops
        rideShapes = pack.rideShapes
        fetchedStopTimes = pack.stopTimes
        estimator.restore(pack.rides ?? [:])
        isOfflineReady = pack.isComplete

        if push.authorizationStatus == .notDetermined {
            Task { await push.requestPermission() }
        }
        updateOfflineState()
        tick()
        startFetching()
        startTicking()
    }

    /// Relaunched with a journey still on: carry on tracking it from the
    /// saved pack, so the Live Activity and alerts keep going even before
    /// (or without) the tracker being opened.
    func restoreIfNeeded(modelContext: ModelContext, region: Region) {
        guard plan == nil else { return }
        let journeys = (try? modelContext.fetch(FetchDescriptor<ActiveJourney>(sortBy: [SortDescriptor(\.startedAt, order: .reverse)]))) ?? []
        guard let journey = journeys.first, Date() < journey.arrivalTime.addingTimeInterval(Self.resumeGrace),
              let saved = store.load(planID: journey.planID) else {
            if journeys.isEmpty { store.deleteAll() }
            return
        }
        begin(plan: saved.plan, region: Region.bySlug(journey.regionSlug) ?? region, modelContext: modelContext)
    }

    /// Ends the journey: stops tracking, dismisses the Live Activity and
    /// throws away its saved data.
    func end() {
        guard let plan else { return }
        stopLoops()
        if let modelContext {
            for journey in (try? modelContext.fetch(FetchDescriptor<ActiveJourney>())) ?? [] where journey.planID == plan.id {
                modelContext.delete(journey)
            }
        }
        store.delete(planID: plan.id)
        let liveActivity = self.liveActivity
        let notifications = self.notifications
        resetState()
        Task {
            await liveActivity.endAll()
            await notifications.clearAll()
        }
    }

    func setAppActive(_ active: Bool) {
        guard isAppActive != active else { return }
        isAppActive = active
        guard plan != nil else { return }
        if active {
            startFetching()  // catch up straight away
            startTicking()
        }
        tick()
    }

    private func resetState() {
        plan = nil
        displayPlan = nil
        snapshot = nil
        vehiclesByTripID = [:]
        estimatedTripIDs = []
        stopTimesByTripID = [:]
        tripStops = [:]
        trackedStops = []
        rideShapes = [:]
        walkDirections = nil
        walkLegIndex = nil
        walkStep = nil
        alertStack = []
        lastLiveFetch = nil
        lastStopTimesFetch = nil
        isOffline = false
        isOfflineReady = false
        liveVehicles = [:]
        fetchedStopTimes = [:]
        failedFetches = 0
        liveWalkLegIndex = nil
        pack = nil
        lastSentActivity = nil
        lastReportedLeg = nil
        savedAlightedThroughLeg = -1
        progressModel = JourneyProgressModel()
        estimator = OfflineRideEstimator()
        ratchet = VehicleProgressRatchet()
        alertCenter.reset()
        walkTracker.reset()
    }

    private func stopLoops() {
        fetchTask?.cancel()
        fetchTask = nil
        tickTask?.cancel()
        tickTask = nil
        setBackgroundLocation(false)
        notifications.cancelPending()
    }

    // MARK: - Loops

    /// Talks to the server: now, then every 10s (30s in the background).
    /// Stops once the journey's over and the app is in the background.
    private func startFetching() {
        fetchTask?.cancel()
        let loopID = UUID()
        fetchLoopID = loopID
        fetchTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.fetch()
                if !self.isAppActive, self.snapshot?.journeyArrived == true { break }
                try? await Task.sleep(for: .seconds(self.isAppActive ? 10 : 30))
            }
            if self?.fetchLoopID == loopID { self?.fetchTask = nil }
        }
    }

    /// Works out progress every 5s, on top of every location update -
    /// never waiting on the network.
    private func startTicking() {
        guard tickTask == nil else { return }
        let loopID = UUID()
        tickLoopID = loopID
        tickTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard let self, !Task.isCancelled else { return }
                if !self.isAppActive, self.snapshot?.journeyArrived == true { break }
                self.tick()
            }
            if self?.tickLoopID == loopID { self?.tickTask = nil }
        }
    }

    private func locationDidUpdate() {
        guard plan != nil else { return }
        if let steps = walkDirections?.steps, let coordinate = location.coordinate {
            walkStep = walkTracker.update(steps: steps, location: coordinate)
        }
        if Date().timeIntervalSince(lastTick) >= 2 { tick() }
    }

    // MARK: - Network

    private func fetch() async {
        guard let plan else { return }
        let api = self.api
        let tripIDs = plan.transitLegs.map(\.tripID)

        async let vehiclesResult = Self.withTimeout(15) { try await api.liveVehicles(tripIDs: tripIDs) }
        async let timesResult = Self.fetchStopTimes(api: api, tripIDs: tripIDs)
        let (vehicles, times) = await (vehiclesResult, timesResult)
        guard self.plan?.id == plan.id else { return }

        let now = Date()
        if let vehicles {
            let ratchet = self.ratchet
            liveVehicles = Dictionary(vehicles.map { ($0.tripID, ratchet.apply($0, now: now)) }, uniquingKeysWith: { first, _ in first })
            lastLiveFetch = now
        }
        if !times.isEmpty {
            // Only trips that actually loaded replace what we had.
            fetchedStopTimes.merge(times) { _, new in new }
            lastStopTimesFetch = now
        }
        let succeeded = vehicles != nil || !times.isEmpty
        failedFetches = succeeded ? 0 : failedFetches + 1
        updateOfflineState()
        tick()

        guard succeeded else { return }
        await fillOfflinePack(plan: plan)
        await refreshWalkDirections()
        reportLegIfNeeded()
    }

    /// Downloads whatever the pack is still missing - normally all at the
    /// start, on the connection the journey was started on.
    private func fillOfflinePack(plan: JourneyPlan) async {
        guard var pack, pack.plan.id == plan.id else { return }
        let api = self.api
        var downloaded = false

        for leg in plan.transitLegs where (pack.tripStops[leg.tripID] ?? []).isEmpty {
            let tripID = leg.tripID
            if let stops = await Self.withTimeout(15, { try await api.stopsForTrip(tripID: tripID) }), !stops.isEmpty {
                pack.tripStops[tripID] = stops
                downloaded = true
            }
        }
        for leg in plan.transitLegs where pack.rideShapes[leg.tripID] == nil {
            let tripID = leg.tripID
            if let shape = await Self.withTimeout(15, { try await api.routeShape(tripID: tripID) }) {
                pack.rideShapes[tripID] = shape
                downloaded = true
            }
        }
        for walk in OfflineJourneyPack.walkEndpoints(plan) where pack.walkDirections[walk.index] == nil {
            if let directions = await Self.withTimeout(15, { try await api.walkingDirections(from: walk.from, to: walk.to) }) {
                pack.walkDirections[walk.index] = directions
                downloaded = true
            }
        }
        guard self.plan?.id == plan.id else { return }

        let predictionsChanged = pack.stopTimes != fetchedStopTimes
        pack.stopTimes = fetchedStopTimes
        self.pack = pack
        if downloaded {
            tripStops = pack.tripStops
            rideShapes = pack.rideShapes
            isOfflineReady = pack.isComplete
            tick()
        }
        // New predictions arrive every poll - written out at most every
        // half minute; newly downloaded pieces straight away.
        if downloaded || (predictionsChanged && Date().timeIntervalSince(lastPackSave) >= 30) {
            savePack()
        }
    }

    private func savePack() {
        guard let pack else { return }
        lastPackSave = Date()
        let store = self.store
        Task.detached(priority: .utility) { store.save(pack) }
    }

    /// Directions for the current walk from where the rider actually is,
    /// once per walking leg - retried on the next poll if it fails. The
    /// pack's directions (from the walk's planned start) stand in until then.
    private func refreshWalkDirections() async {
        guard let displayPlan, let index = snapshot?.progressLegIndex,
              displayPlan.legs.indices.contains(index), displayPlan.legs[index].mode == "walk",
              liveWalkLegIndex != index else { return }
        let leg = displayPlan.legs[index]
        let destination = leg.toStop?.coordinate
            ?? (index == displayPlan.legs.count - 1 ? Coordinate(latitude: displayPlan.endLat, longitude: displayPlan.endLon) : nil)
        guard let destination, let start = location.coordinate ?? leg.fromStop?.coordinate else { return }
        let api = self.api
        guard let directions = await Self.withTimeout(15, { try await api.walkingDirections(from: start, to: destination) }),
              snapshot?.progressLegIndex == index else { return }
        liveWalkLegIndex = index
        setWalkDirections(directions, legIndex: index)
    }

    /// Tells the server which leg the rider is on - and, by reporting at
    /// least every 25s, that the app is updating the Live Activity itself,
    /// so the server holds off pushing its own content over the top
    /// (`clientActiveWindow` on the backend).
    private func reportLegIfNeeded() {
        guard !isOffline, let snapshot, let activityID = liveActivity.activity?.id else { return }
        let phase = snapshot.phase?.rawValue ?? "onboard"
        if let last = lastReportedLeg, last.index == snapshot.progressLegIndex, last.phase == phase,
           Date().timeIntervalSince(last.at) < 25 { return }
        lastReportedLeg = (snapshot.progressLegIndex, phase, Date())
        let api = self.api
        let legIndex = snapshot.progressLegIndex
        Task { try? await api.reportLiveActivityLeg(activityID: activityID, legIndex: legIndex, phase: phase) }
    }

    private func updateOfflineState() {
        let offline = !network.isConnected || failedFetches >= 2
        if offline != isOffline { isOffline = offline }
    }

    private static func fetchStopTimes(api: APIClient, tripIDs: [String]) async -> [String: [StopTimeUpdate]] {
        await withTaskGroup(of: (String, [StopTimeUpdate]?).self) { group in
            for tripID in tripIDs {
                group.addTask { (tripID, await withTimeout(15) { try await api.stopTimes(tripID: tripID) }) }
            }
            var result: [String: [StopTimeUpdate]] = [:]
            for await (tripID, times) in group {
                if let times { result[tripID] = times }
            }
            return result
        }
    }

    /// `operation`'s result, or nil if it failed or took longer than
    /// `seconds` - a request on a dying connection can otherwise hang for
    /// a minute.
    private static func withTimeout<T: Sendable>(_ seconds: Double, _ operation: @escaping @Sendable () async throws -> T) async -> T? {
        await withTaskGroup(of: T?.self) { group in
            group.addTask { try? await operation() }
            group.addTask {
                try? await Task.sleep(for: .seconds(seconds))
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    // MARK: - Progress (on device)

    /// One step of the state machine from what's on hand - no network.
    func tick() {
        guard let plan else { return }
        let now = Date()
        lastTick = now

        // The rider's GPS, placed on the ride they're on (or about to be).
        let fix = location.coordinate.map {
            OfflineRideEstimator.Fix(coordinate: $0, speed: location.speed, timestamp: location.fixDate ?? now)
        }
        var estimated: [String: Vehicle] = [:]
        let floor = snapshot?.transitFloor ?? 0
        if let index = plan.legs.indices.first(where: { i in
            plan.legs[i].mode == "transit" && i > progressModel.alightedThroughLeg && i >= floor
                && !estimator.hasAlighted(tripID: plan.legs[i].tripID)
        }), let stops = tripStops[plan.legs[index].tripID] {
            let leg = plan.legs[index]
            let departure = displayPlan?.legs[safe: index]?.departureTime.date ?? leg.departureTime.date
            if let vehicle = estimator.estimate(leg: leg, stops: stops, fix: fix, departure: departure, now: now) {
                estimated[leg.tripID] = vehicle
            }
        }

        // The feed wins while it's fresh; past that, the rider's GPS.
        let liveAge = lastLiveFetch.map { now.timeIntervalSince($0) } ?? .infinity
        var vehicles = liveAge <= Self.liveDataMaxAge ? liveVehicles : [:]
        var estimatedIDs = Set<String>()
        for (tripID, vehicle) in estimated where vehicles[tripID] == nil || liveAge > Self.liveFreshAge {
            vehicles[tripID] = vehicle
            estimatedIDs.insert(tripID)
        }

        var times = fetchedStopTimes
        for tripID in estimatedIDs {
            if let adjusted = estimator.adjustedStopTimes(tripID: tripID, stops: tripStops[tripID] ?? [], stopTimes: times[tripID] ?? []) {
                times[tripID] = adjusted
            }
        }

        let display = JourneyPlanLiveAdjuster.buildLiveJourney(plan, stopTimesByTripID: times)
        vehiclesByTripID = vehicles
        estimatedTripIDs = estimatedIDs
        stopTimesByTripID = times
        displayPlan = display

        func compute() -> JourneyProgressModel.Snapshot {
            progressModel.update(
                plan: plan, displayPlan: display, now: now, vehiclesByTripID: vehicles,
                stopTimesByTripID: times, journeyStarted: true, trackedStops: trackedStops,
                userLocation: location.coordinate, estimatedTripIDs: estimatedIDs
            )
        }
        var newSnapshot = compute()
        // The tracked ride's stop list - from the pack, so it's there with
        // no connection. Recompute with it: without it "boarded" and
        // stops-away can't be worked out.
        let trackedTrip = newSnapshot.trackedTripID ?? newSnapshot.activeTransitLegIndex.map { plan.legs[$0].tripID }
        if let trackedTrip, let stops = tripStops[trackedTrip], stops != trackedStops {
            trackedStops = stops
            newSnapshot = compute()
        }
        snapshot = newSnapshot
        saveProgress()
        let rideProgress = estimator.progress
        if var pack, (pack.rides ?? [:]) != rideProgress {
            pack.rides = rideProgress
            self.pack = pack
            savePack()
        }

        applyCachedWalkDirections(legIndex: newSnapshot.progressLegIndex)
        evaluateAlerts(newSnapshot, now: now)
        updateLiveActivity(newSnapshot)
        updateNotifications(newSnapshot, now: now)

        let wantsBackgroundLocation = !newSnapshot.journeyArrived && location.isAuthorized
        if wantsBackgroundLocation != backgroundLocationOn { setBackgroundLocation(wantsBackgroundLocation) }
    }

    private func setBackgroundLocation(_ on: Bool) {
        backgroundLocationOn = on
        location.setJourneyBackgroundUpdates(on)
    }

    private func activeJourney(planID: String) -> ActiveJourney? {
        (try? modelContext?.fetch(FetchDescriptor<ActiveJourney>()))?.first { $0.planID == planID }
    }

    private func saveProgress() {
        guard let plan, progressModel.alightedThroughLeg != savedAlightedThroughLeg,
              let saved = activeJourney(planID: plan.id) else { return }
        saved.alightedThroughLeg = progressModel.alightedThroughLeg
        savedAlightedThroughLeg = progressModel.alightedThroughLeg
    }

    private func applyCachedWalkDirections(legIndex: Int) {
        guard let displayPlan, displayPlan.legs[safe: legIndex]?.mode == "walk" else {
            if walkLegIndex != nil {
                walkLegIndex = nil
                walkDirections = nil
                walkStep = nil
            }
            return
        }
        guard walkLegIndex != legIndex else { return }
        if let cached = pack?.walkDirections[legIndex] {
            setWalkDirections(cached, legIndex: legIndex)
        } else if walkDirections != nil {
            walkDirections = nil
            walkStep = nil
        }
    }

    private func setWalkDirections(_ directions: WalkingDirections, legIndex: Int) {
        walkTracker.reset()
        walkDirections = directions
        walkLegIndex = legIndex
        walkStep = location.coordinate.map { walkTracker.update(steps: directions.steps, location: $0) }
    }

    // MARK: - Alerts

    func dismissAlert(_ id: String) {
        alertCenter.dismiss(id)
        alertStack = alertCenter.stack
    }

    private func evaluateAlerts(_ snapshot: JourneyProgressModel.Snapshot, now: Date) {
        guard let displayPlan else { return }
        let trackedLeg = snapshot.trackedTripID.flatMap { tripID in displayPlan.legs.first { $0.tripID == tripID } }
        let trackedVehicle = snapshot.trackedTripID.flatMap { vehiclesByTripID[$0] }
        let risk = displayPlan.legs.indices.contains(snapshot.progressLegIndex)
            ? JourneyTracking.connectionRisk(displayPlan.legs, at: snapshot.progressLegIndex)
            : nil

        alertCenter.evaluate(
            plan: displayPlan,
            trackedLeg: trackedLeg,
            trackedVehicle: trackedVehicle,
            trackedStops: trackedStops,
            boarded: snapshot.boarded,
            journeyArrived: snapshot.journeyArrived,
            connectionRisk: risk,
            endLabel: destinationName
        )
        if !snapshot.journeyArrived {
            alertCenter.evaluateTimetable(
                plan: displayPlan, progressLegIndex: snapshot.progressLegIndex,
                onboard: snapshot.phase == .onboard, hasVehicle: trackedVehicle != nil, now: now
            )
        }
        if alertStack != alertCenter.stack { alertStack = alertCenter.stack }
    }

    /// Offline in the background: schedule the moments still ahead, so they
    /// arrive even if iOS suspends the app. Otherwise the server's pushes
    /// (or the in-app alerts) have it covered.
    private func updateNotifications(_ snapshot: JourneyProgressModel.Snapshot, now: Date) {
        guard !isAppActive, isOffline, !snapshot.journeyArrived, let displayPlan, let url = notificationURL else {
            notifications.cancelPending()
            return
        }
        let moments = OfflineJourneyMoments.upcoming(
            legs: displayPlan.legs, progressLegIndex: snapshot.progressLegIndex,
            onboard: snapshot.phase == .onboard, now: now
        )
        notifications.schedule(moments, url: url)
    }

    private var notificationURL: String? {
        plan.map { "/journey?id=\($0.id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? $0.id)&region=\(regionSlug)&track=1" }
    }

    var destinationName: String {
        if let name = displayPlan?.legs.last?.toStop?.stopName, !name.isEmpty { return name }
        if let plan, let label = activeJourney(planID: plan.id)?.endLabel, !label.isEmpty { return label }
        return "your destination"
    }

    // MARK: - Live Activity

    private func updateLiveActivity(_ snapshot: JourneyProgressModel.Snapshot) {
        guard let plan, !activityUpdateInFlight else { return }
        let state = contentState(for: snapshot)
        var comparable = state
        comparable.updatedUnix = 0
        let now = Date()
        if let last = lastSentActivity {
            // Something the rider would notice (phase, leg, stops away)
            // goes straight out; the rest (countdown targets drifting with
            // GPS re-timing) at most every 15s.
            let elapsed = now.timeIntervalSince(last.at)
            let keyChange = last.state.phase != comparable.phase || last.state.legIndex != comparable.legIndex
                || last.state.stopsAway != comparable.stopsAway || last.state.offline != comparable.offline
                || last.state.status != comparable.status
            if last.state == comparable ? elapsed < 30 : (!keyChange && elapsed < 15) { return }
        }
        lastSentActivity = (comparable, now)

        // Fresh while there's a connection only as long as the data behind
        // it is; offline it's worked out from GPS and the timetable right
        // now (and says so), so it stays fresh while the app keeps it going.
        let freshFrom = isOffline ? now : (lastSuccessfulFetchDate ?? now)
        let staleDate = freshFrom.addingTimeInterval(LiveActivityCoordinator.staleAfter)

        activityUpdateInFlight = true
        let liveActivity = self.liveActivity
        let region = Region.bySlug(regionSlug) ?? .auckland
        Task {
            defer { self.activityUpdateInFlight = false }
            // Ended (or switched journey) while this was queued - don't
            // bring the activity back.
            guard self.plan?.id == plan.id else { return }
            if liveActivity.isActive {
                await liveActivity.update(state, staleDate: staleDate)
            } else if !snapshot.journeyArrived {
                let destination = plan.legs.last?.toStop?.stopName ?? "Destination"
                await liveActivity.start(planID: plan.id, destinationLabel: destination, region: region, initialState: state)
                // Ended while the request was in flight.
                if self.plan?.id != plan.id { await liveActivity.endAll() }
            }
        }
    }

    private var lastSuccessfulFetchDate: Date? {
        [lastLiveFetch, lastStopTimesFetch].compactMap { $0 }.max()
    }

    /// Built by TransitCore's `LiveActivityContentBuilder` - the same rules
    /// and wording the backend uses for its background pushes - so the
    /// Lock Screen doesn't change style when the app closes and the server
    /// takes over.
    private func contentState(for snapshot: JourneyProgressModel.Snapshot) -> JourneyActivityAttributes.ContentState {
        let legs = displayPlan?.legs ?? plan?.legs ?? []
        let trackedVehicle = snapshot.trackedTripID.flatMap { vehiclesByTripID[$0] }
        let progress = LiveActivityProgress(
            legIndex: max(0, min(snapshot.progressLegIndex, legs.count - 1)),
            phase: snapshot.phase?.rawValue ?? "walking",
            arrived: snapshot.journeyArrived,
            stopsAway: snapshot.trackedStopsAway,
            nextStopName: trackedVehicle?.trip?.nextStop?.name,
            isRealtime: snapshot.trackingLevel == .live || snapshot.trackingLevel == .predicted,
            hasVehicle: trackedVehicle != nil && trackedVehicle?.state != "Unknown",
            rideStops: rideStopCount(tripID: snapshot.trackedTripID),
            occupancy: trackedVehicle.flatMap { $0.occupancy >= 0 ? $0.occupancy : nil },
            offline: isOffline
        )
        let content = LiveActivityContentBuilder.build(legs: legs, progress: progress)
        return JourneyActivityAttributes.ContentState(content)
    }

    /// Stops the rider travels on the tracked ride (board -> alight), from
    /// its stop list - nil until that list has loaded.
    func rideStopCount(tripID: String?) -> Int? {
        guard let tripID, let stops = tripStops[tripID],
              let leg = displayPlan?.legs.first(where: { $0.tripID == tripID }),
              let board = JourneyTracking.findStopSequence(in: stops, for: leg.fromStop),
              let alight = JourneyTracking.findStopSequence(in: stops, for: leg.toStop, after: board) else { return nil }
        let count = stops.filter { $0.sequence > board && $0.sequence <= alight }.count
        return count > 0 ? count : nil
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
