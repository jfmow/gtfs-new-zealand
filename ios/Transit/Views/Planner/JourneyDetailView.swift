import SwiftData
import SwiftUI
import TransitCore

/// A single plan before committing to it - the web's route detail sheet in
/// its preview state: the route on a map, departs/arrives, each leg, then
/// Start / Remind me / Share. "Start this journey" hands off to
/// `JourneyTrackingView`, which runs the live state machine.
struct JourneyDetailView: View {
    let plan: JourneyPlan
    /// The planner search this came from - reminders use its real labels
    /// and options. Nil when opened from a link.
    var context: PlannerSearchContext?
    /// Shown inside a link's full-screen cover rather than the Planner tab.
    var presentedFromLink = false
    /// The Planner's detail column on iPad, beside the results - not a
    /// screen of its own, so it leaves the navigation title to the Planner.
    var isEmbedded = false

    @Environment(AppEnvironment.self) private var environment
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.modelContext) private var modelContext
    @State private var isActive = false
    @State private var isTracking = false
    @State private var isShowingReminder = false
    @State private var isShowingMap = false
    /// Trip ids with a vehicle in the live feed - nil until the first
    /// fetch, when the timeline falls back to the plan's own answer.
    @State private var liveTripIDs: Set<String>?

    /// Keeps the tracking icons current while the preview is open - a bus
    /// that wasn't out yet when you searched can start reporting since.
    private func refreshLiveVehicles() async {
        let tripIDs = plan.legs.filter { $0.mode == "transit" && !$0.tripID.isEmpty }.map(\.tripID)
        guard !tripIDs.isEmpty else { return }
        while !Task.isCancelled {
            if let vehicles = try? await environment.api.liveVehicles(tripIDs: tripIDs) {
                liveTripIDs = Set(vehicles.map(\.tripID))
            }
            try? await Task.sleep(for: .seconds(30))
        }
    }

    private var hasTransit: Bool { plan.legs.contains { $0.mode == "transit" } }
    private var hasDisruption: Bool { plan.legs.contains { $0.mode == "transit" && !$0.tripUsable } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // A still preview: a tap opens the route full screen, where
                // it can be panned and zoomed.
                Button { isShowingMap = true } label: {
                    TransitMapView(waypoints: waypoints, polylines: polylines, camera: .fitAll)
                        .allowsHitTesting(false)
                        .frame(height: isEmbedded ? 340 : 240)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
                        // The map ignores touches, so without this only the
                        // expand badge would take the tap.
                        .contentShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
                        .overlay(alignment: .topTrailing) {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.foreground)
                                .frame(width: 32, height: 32)
                                .background(.regularMaterial, in: Circle())
                                .padding(8)
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Map of this journey")
                .accessibilityHint("Opens the map full screen")

                summary

                if hasDisruption {
                    Label("Service disruption on this route. Check alternative routes.", systemImage: "exclamationmark.triangle")
                        .font(.bodyText)
                        .foregroundStyle(Theme.danger)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.danger.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous).strokeBorder(Theme.danger.opacity(0.3), lineWidth: 1))
                }

                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: "Your trip")
                    // The same timeline as live tracking, so the preview and
                    // the tracker read the same way.
                    JourneyTimeline(
                        legs: plan.legs,
                        status: { _ in .upcoming },
                        progress: { _ in nil },
                        waitMinutes: waitMinutes(after:),
                        destinationName: context?.end?.label ?? plan.legs.last?.toStop?.stopName ?? "your destination",
                        accent: Theme.live,
                        startName: context?.start?.label ?? plan.legs.first?.fromStop?.stopName,
                        tracked: { index in
                            // A trip id can repeat on another day - a ride hours
                            // off keeps the plan's answer rather than today's bus.
                            guard let liveTripIDs, let leg = plan.legs[safe: index], leg.mode == "transit",
                                  let depart = leg.departureTime.date, depart.timeIntervalSinceNow < 3 * 3600 else { return nil }
                            return liveTripIDs.contains(leg.tripID)
                        }
                    )
                }

                actions
            }
            .padding(16)
            .readableContentWidth()
        }
        .pageBackground()
        .if(!isEmbedded) { view in
            view.navigationTitle("Journey").navigationBarTitleDisplayMode(.inline)
        }
        .toolbar {
            if let shareURL {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: shareURL, subject: Text("My journey"), message: Text(shareMessage)) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Share this journey")
                }
            }
        }
        .onAppear {
            // Came back after minimising the tracker: it's still running.
            let id = plan.id
            isActive = ((try? modelContext.fetchCount(FetchDescriptor<ActiveJourney>(predicate: #Predicate { $0.planID == id }))) ?? 0) > 0
            router.visibleJourneyDetailPlanID = id
        }
        .onDisappear {
            if router.visibleJourneyDetailPlanID == plan.id { router.visibleJourneyDetailPlanID = nil }
        }
        .task(id: plan.id) { await refreshLiveVehicles() }
        .navigationDestination(isPresented: $isTracking) {
            JourneyTrackingView(plan: plan, presentedFromLink: presentedFromLink)
        }
        .fullScreenCover(isPresented: $isShowingMap) {
            NavigationStack {
                TransitMapView(waypoints: waypoints, polylines: polylines, camera: .fitAll, showsUserLocation: true)
                    .ignoresSafeArea(edges: .bottom)
                    .navigationTitle("Journey map")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { isShowingMap = false }
                        }
                    }
            }
        }
        .sheet(isPresented: $isShowingReminder) {
            LeaveReminderSheet(plan: plan, context: context ?? defaultContext).shadSheet(detents: [.large])
        }
    }

    private var summary: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Departs").font(.meta).foregroundStyle(Theme.mutedForeground)
                if let date = plan.departureTime.date {
                    Text(date, style: .time).font(.number(24)).lineLimit(1).minimumScaleFactor(0.6)
                }
            }
            Spacer(minLength: 6)
            VStack(spacing: 2) {
                Text(TimeFormatting.formatDuration(plan.totalDuration)).font(.metaMedium).lineLimit(1)
                ShadBadge(text: plan.transfers == 0 ? "Direct" : "\(plan.transfers) transfer\(plan.transfers == 1 ? "" : "s")",
                          variant: plan.transfers == 0 ? .default : .secondary)
                    .fixedSize()
            }
            .layoutPriority(1)
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 2) {
                Text("Arrives").font(.meta).foregroundStyle(Theme.mutedForeground)
                if let date = plan.arrivalTime.date {
                    Text(date, style: .time).font(.number(24)).lineLimit(1).minimumScaleFactor(0.6)
                }
            }
        }
        .padding(14)
        .shadCardBackground()
    }

    private var actions: some View {
        VStack(spacing: 8) {
            Button {
                if isActive { isTracking = true } else { startJourney() }
            } label: {
                Label(isActive ? "Resume tracking" : "Start this journey", systemImage: "location.north.fill")
            }
            .buttonStyle(.shad(.default, size: .pill, fullWidth: true))

            if hasTransit, (plan.departureTime.date ?? .distantPast) > Date().addingTimeInterval(60) {
                Button {
                    isShowingReminder = true
                } label: {
                    Label("Remind me when to leave", systemImage: "alarm")
                }
                .buttonStyle(.shad(.outline, size: .pill, fullWidth: true))
            }
        }
    }

    private func waitMinutes(after index: Int) -> Int? {
        guard index + 1 < plan.legs.count,
              let end = plan.legs[index].arrivalTime.date,
              let start = plan.legs[index + 1].departureTime.date else { return nil }
        return max(0, Int((start.timeIntervalSince(end) / 60).rounded()))
    }

    private var defaultContext: PlannerSearchContext {
        PlannerSearchContext(start: nil, end: nil, arriveBy: false, maxWalkKm: 1, walkSpeed: WalkSpeed.normal, maxTransfers: 5, onlyRoutes: [])
    }

    /// `/journey?id=` on the web - opens (and can track) this exact plan.
    private var shareURL: URL? {
        URL(string: "https://trains.suddsy.dev/journey?id=\(plan.id)&region=\(environment.region.slug)")
    }

    private var shareMessage: String {
        let arrival = plan.arrivalTime.date?.formatted(date: .omitted, time: .shortened) ?? ""
        return arrival.isEmpty ? "Follow my journey" : "Follow my journey - arriving around \(arrival)"
    }

    /// Each ride in its own route colour, walks in grey.
    private var polylines: [RoutePolylineData] {
        guard let features = plan.routeGeoJSON?.features else { return [] }
        let transitColors = plan.legs.filter { $0.mode == "transit" }.map { $0.route?.routeColor ?? "" }
        var transitIndex = 0
        return features.enumerated().map { index, feature in
            let mode = feature.properties?["mode"]?.stringValue ?? "walk"
            var color = "9CA3AF"
            if mode != "walk" {
                let routeColor = transitIndex < transitColors.count ? transitColors[transitIndex] : ""
                color = routeColor.isEmpty ? environment.region.brandColorHex : routeColor
                transitIndex += 1
            }
            return RoutePolylineData(id: "leg-\(index)", coordinates: feature.geometry.lineCoordinates, colorHex: color, isWalk: mode == "walk")
        }
    }

    private var waypoints: [WaypointAnnotation] {
        WaypointAnnotation.journey(plan, fallbackColorHex: environment.region.brandColorHex)
    }

    private func startJourney() {
        guard let arrival = plan.arrivalTime.date else { return }
        // Only one journey is tracked at a time.
        for old in (try? modelContext.fetch(FetchDescriptor<ActiveJourney>())) ?? [] { modelContext.delete(old) }
        let journey = ActiveJourney(
            planID: plan.id, regionSlug: environment.region.slug,
            endLabel: context?.end?.label ?? plan.legs.last?.toStop?.stopName ?? "your destination", arrivalTime: arrival
        )
        modelContext.insert(journey)
        isActive = true
        isTracking = true
    }
}
