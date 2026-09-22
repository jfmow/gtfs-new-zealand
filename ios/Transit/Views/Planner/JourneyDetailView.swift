import SwiftData
import SwiftUI
import TransitCore

/// A single plan's pre-departure preview: leg-by-leg breakdown + route map.
/// "Start this journey" hands off to `JourneyTrackingView`, which runs the
/// live state machine (`JourneyProgressModel`) - this view stays static by
/// design, for previewing a plan before committing to it.
struct JourneyDetailView: View {
    let plan: JourneyPlan

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.modelContext) private var modelContext
    @State private var isActive = false
    @State private var isTracking = false

    private var accent: Color { Theme.accent(for: environment.region) }

    var body: some View {
        VStack(spacing: 0) {
            TransitMapView(polylines: polylines, camera: .fitAll)
                .frame(height: 220)

            List {
                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Departs").font(.caption).foregroundStyle(Theme.steel)
                            if let date = plan.departureTime.date { Text(date, style: .time).font(.heroNumber(26)) }
                        }
                        Spacer()
                        Image(systemName: "arrow.right").foregroundStyle(Theme.steel)
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("Arrives").font(.caption).foregroundStyle(Theme.steel)
                            if let date = plan.arrivalTime.date { Text(date, style: .time).font(.heroNumber(26)) }
                        }
                    }
                    .padding(.vertical, 4)
                    Text(TimeFormatting.formatDuration(plan.totalDuration)).font(.subheadline).foregroundStyle(Theme.steel)
                }
                .boardRow()

                Section("Legs") {
                    ForEach(Array(plan.legs.enumerated()), id: \.offset) { _, leg in
                        LegRow(leg: leg).boardRow()
                    }
                }

                if plan.legs.contains(where: { !$0.tripUsable }) {
                    Section {
                        Label("Service disruption on this route", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Theme.alert)
                    }
                    .boardRow()
                }

                Section {
                    Button(isActive ? "Journey started" : "Start this journey") {
                        startJourney()
                    }
                    .buttonStyle(.transitPrimary(accent))
                    .disabled(isActive)
                    .listRowBackground(Color.clear)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.paper)
        }
        .navigationTitle("Journey")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $isTracking) {
            JourneyTrackingView(plan: plan)
        }
        .tint(accent)
    }

    private var polylines: [RoutePolylineData] {
        guard let features = plan.routeGeoJSON?.features else { return [] }
        return features.enumerated().map { index, feature in
            let mode = feature.properties?["mode"]?.stringValue ?? "walk"
            return RoutePolylineData(id: "leg-\(index)", coordinates: feature.geometry.lineCoordinates, colorHex: mode == "walk" ? "9CA3AF" : environment.region.brandColorHex)
        }
    }

    private func startJourney() {
        guard let arrival = plan.arrivalTime.date else { return }
        let journey = ActiveJourney(
            planID: plan.id, regionSlug: environment.region.slug,
            endLabel: plan.legs.last?.toStop?.stopName ?? "Destination", arrivalTime: arrival
        )
        modelContext.insert(journey)
        isActive = true
        isTracking = true
        // Live Activity start hooks in once ActivityKit wiring lands (Phase 7).
    }
}

struct LegRow: View {
    let leg: JourneyLeg

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: leg.mode == "walk" ? "figure.walk" : "tram.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(leg.mode == "walk" ? Theme.steel : Color.white)
                .frame(width: 26, height: 26)
                .background(leg.mode == "walk" ? Color.clear : Color(hex: leg.route?.routeColor ?? "0073bd"))
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 2) {
                if leg.mode == "walk" {
                    Text("Walk \(TimeFormatting.formatDistance(meters: leg.distanceKm * 1000))")
                        .font(.subheadline)
                } else {
                    Text("\(leg.route?.routeShortName ?? leg.routeID) to \(leg.toStop?.stopName ?? "")")
                        .font(.subheadline.bold())
                    if let from = leg.fromStop {
                        Text("from \(from.stopName)").font(.caption).foregroundStyle(Theme.steel)
                    }
                    if let delay = leg.delaySeconds, delay > 0 {
                        Text("Delayed \(delay / 60) min").font(.caption).foregroundStyle(Theme.delayed)
                    } else if leg.realtimeStatus == "on_time" {
                        Text("On time").font(.caption).foregroundStyle(Theme.onTime)
                    }
                }
            }

            Spacer()
            Text(TimeFormatting.formatDuration(leg.duration)).font(.caption.monospacedDigit()).foregroundStyle(Theme.steel)
        }
        .padding(.vertical, 3)
    }
}
