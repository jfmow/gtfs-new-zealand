import SwiftData
import SwiftUI
import TransitCore

/// A single plan's leg-by-leg detail + route map. This is the static view -
/// `RouteDetailSheet`'s live leg-advance/phase/hysteresis logic
/// (`route-detail-sheet.tsx`) is Phase 5; this view is what Phase 5 will
/// upgrade in place once that state machine exists.
struct JourneyDetailView: View {
    let plan: JourneyPlan

    @Environment(\.modelContext) private var modelContext
    @State private var isActive = false

    var body: some View {
        VStack(spacing: 0) {
            TransitMapView(polylines: polylines, camera: .fitAll)
                .frame(height: 220)

            List {
                Section {
                    HStack {
                        VStack(alignment: .leading) {
                            Text("Departs").font(.caption).foregroundStyle(.secondary)
                            if let date = plan.departureTime.date { Text(date, style: .time).font(.title3.bold()) }
                        }
                        Spacer()
                        Image(systemName: "arrow.right")
                        Spacer()
                        VStack(alignment: .trailing) {
                            Text("Arrives").font(.caption).foregroundStyle(.secondary)
                            if let date = plan.arrivalTime.date { Text(date, style: .time).font(.title3.bold()) }
                        }
                    }
                    Text(TimeFormatting.formatDuration(plan.totalDuration)).font(.subheadline).foregroundStyle(.secondary)
                }

                Section("Legs") {
                    ForEach(Array(plan.legs.enumerated()), id: \.offset) { _, leg in
                        LegRow(leg: leg)
                    }
                }

                if plan.legs.contains(where: { !$0.tripUsable }) {
                    Section {
                        Label("Service disruption on this route", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                }

                Section {
                    Button(isActive ? "Journey started" : "Start this journey") {
                        startJourney()
                    }
                    .disabled(isActive)
                }
            }
        }
        .navigationTitle("Journey")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var polylines: [RoutePolylineData] {
        guard let features = plan.routeGeoJSON?.features else { return [] }
        return features.enumerated().map { index, feature in
            let mode = feature.properties?["mode"]?.stringValue ?? "walk"
            let color = mode == "walk" ? "64748b" : "0073bd"
            return RoutePolylineData(id: "leg-\(index)", coordinates: feature.geometry.lineCoordinates, colorHex: color)
        }
    }

    private func startJourney() {
        guard let arrival = plan.arrivalTime.date else { return }
        let journey = ActiveJourney(
            planID: plan.id, regionSlug: "at", endLabel: plan.legs.last?.toStop?.stopName ?? "Destination",
            arrivalTime: arrival
        )
        modelContext.insert(journey)
        isActive = true
        // Live Activity start hooks in once ActivityKit wiring lands (Phase 7).
    }
}

struct LegRow: View {
    let leg: JourneyLeg

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: leg.mode == "walk" ? "figure.walk" : "tram.fill")
                .foregroundStyle(leg.mode == "walk" ? Color.secondary : Color.white)
                .frame(width: 24, height: 24)
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
                        Text("from \(from.stopName)").font(.caption).foregroundStyle(.secondary)
                    }
                    if let delay = leg.delaySeconds, delay > 0 {
                        Text("Delayed \(delay / 60) min").font(.caption).foregroundStyle(.orange)
                    } else if leg.realtimeStatus == "on_time" {
                        Text("On time").font(.caption).foregroundStyle(.green)
                    }
                }
            }

            Spacer()
            Text(TimeFormatting.formatDuration(leg.duration)).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
