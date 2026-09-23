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

    @Environment(AppEnvironment.self) private var environment
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.modelContext) private var modelContext
    @State private var isActive = false
    @State private var isTracking = false
    @State private var isShowingReminder = false

    private var hasTransit: Bool { plan.legs.contains { $0.mode == "transit" } }
    private var hasDisruption: Bool { plan.legs.contains { $0.mode == "transit" && !$0.tripUsable } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                TransitMapView(waypoints: waypoints, polylines: polylines, camera: .fitAll)
                    .frame(height: 240)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))

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
                        startName: context?.start?.label ?? plan.legs.first?.fromStop?.stopName
                    )
                }

                actions
            }
            .padding(16)
        }
        .pageBackground()
        .navigationTitle("Journey")
        .navigationBarTitleDisplayMode(.inline)
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
        .navigationDestination(isPresented: $isTracking) {
            JourneyTrackingView(plan: plan, presentedFromLink: presentedFromLink)
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
        PlannerSearchContext(start: nil, end: nil, arriveBy: false, maxWalkKm: 1, walkSpeed: 4.8, maxTransfers: 5, onlyRoutes: [])
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
        var result: [WaypointAnnotation] = []
        if let first = plan.legs.first?.fromStop {
            result.append(WaypointAnnotation(id: "start", coordinate: first.coordinate, label: "Start", isDestination: false))
        }
        if let last = plan.legs.last?.toStop {
            result.append(WaypointAnnotation(id: "end", coordinate: last.coordinate, label: "End", isDestination: true))
        }
        return result
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
