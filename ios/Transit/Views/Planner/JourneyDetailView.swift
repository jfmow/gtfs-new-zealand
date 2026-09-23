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
                    SectionLabel(text: "\(plan.legs.count) leg\(plan.legs.count == 1 ? "" : "s")")
                    VStack(spacing: 0) {
                        ForEach(Array(plan.legs.enumerated()), id: \.offset) { index, leg in
                            if index > 0 { RowDivider() }
                            LegRow(leg: leg).padding(.horizontal, 14).padding(.vertical, 12)
                        }
                    }
                    .shadCardBackground()
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
                if let date = plan.departureTime.date { Text(date, style: .time).font(.number(24)) }
            }
            Spacer()
            VStack(spacing: 2) {
                Text(TimeFormatting.formatDuration(plan.totalDuration)).font(.metaMedium)
                ShadBadge(text: plan.transfers == 0 ? "Direct" : "\(plan.transfers) transfer\(plan.transfers == 1 ? "" : "s")",
                          variant: plan.transfers == 0 ? .default : .secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("Arrives").font(.meta).foregroundStyle(Theme.mutedForeground)
                if let date = plan.arrivalTime.date { Text(date, style: .time).font(.number(24)) }
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
                color = routeColor.isEmpty ? "404040" : routeColor
                transitIndex += 1
            }
            return RoutePolylineData(id: "leg-\(index)", coordinates: feature.geometry.lineCoordinates, colorHex: color)
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

/// One leg: a route badge (or walker), what to do, where from, and live
/// status.
struct LegRow: View {
    let leg: JourneyLeg

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if leg.mode == "walk" {
                    Image(systemName: "figure.walk")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.mutedForeground)
                        .frame(width: 36, height: 24)
                } else {
                    RouteBadge(name: leg.route?.routeShortName.isEmpty == false ? leg.route!.routeShortName : leg.routeID,
                               colorHex: leg.route?.routeColor ?? "", dimmed: !leg.tripUsable, size: 12)
                        .frame(minWidth: 36, alignment: .leading)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                if leg.mode == "walk" {
                    Text("Walk \(TimeFormatting.formatDistance(meters: leg.distanceKm * 1000))")
                        .font(.bodyMedium)
                    if let to = leg.toStop {
                        Text("to \(to.stopName)").font(.meta).foregroundStyle(Theme.mutedForeground)
                    }
                } else {
                    Text("To \(leg.toStop?.stopName ?? "")").font(.bodyMedium).fixedSize(horizontal: false, vertical: true)
                    if let from = leg.fromStop {
                        Text("from \(from.stopName)\(from.platformNumber.isEmpty ? "" : " · Platform \(from.platformNumber)")")
                            .font(.meta).foregroundStyle(Theme.mutedForeground)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !leg.tripUsable {
                        Text("Not running").font(.metaMedium).foregroundStyle(Theme.danger)
                    } else if let delay = leg.delaySeconds, delay >= 60 {
                        Text("Delayed \(delay / 60) min").font(.metaMedium).foregroundStyle(Theme.warning)
                    } else if let delay = leg.delaySeconds, delay <= -60 {
                        Text("Early \(-delay / 60) min").font(.metaMedium).foregroundStyle(Theme.success)
                    } else if leg.realtimeStatus == "on_time" {
                        Text("On time").font(.metaMedium).foregroundStyle(Theme.success)
                    }
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                if let departure = leg.departureTime.date {
                    Text(departure, style: .time).font(.metaMedium).monospacedDigit()
                }
                Text(TimeFormatting.formatDuration(leg.duration)).font(.meta).foregroundStyle(Theme.mutedForeground).monospacedDigit()
            }
        }
    }
}
