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
    @State private var reminderState: ReminderState = .idle

    private enum ReminderState: Equatable {
        case idle, saving, saved, failed(String)
    }

    private var accent: Color { Theme.accent(for: environment.region) }

    var body: some View {
        VStack(spacing: 0) {
            TransitMapView(polylines: polylines, camera: .fitAll)
                .frame(height: 220)

            List {
                Section {
                    TransitCard {
                        VStack(spacing: 8) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Departs").font(.caption).foregroundStyle(Theme.steel)
                                    if let date = plan.departureTime.date { Text(date, style: .time).font(.heroNumber(26)) }
                                }
                                Spacer()
                                Image(systemName: "arrow.right").foregroundStyle(accent)
                                Spacer()
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text("Arrives").font(.caption).foregroundStyle(Theme.steel)
                                    if let date = plan.arrivalTime.date { Text(date, style: .time).font(.heroNumber(26)) }
                                }
                            }
                            Text(TimeFormatting.formatDuration(plan.totalDuration)).font(.subheadline).foregroundStyle(Theme.steel)
                        }
                    }
                }
                .cardListRow()

                Section("Legs") {
                    ForEach(Array(plan.legs.enumerated()), id: \.offset) { _, leg in
                        TransitCard { LegRow(leg: leg) }.cardListRow()
                    }
                }

                if plan.legs.contains(where: { !$0.tripUsable }) {
                    Section {
                        TransitCard {
                            Label("Service disruption on this route", systemImage: "exclamationmark.triangle")
                                .foregroundStyle(Theme.alert)
                        }
                    }
                    .cardListRow()
                }

                Section {
                    Button(isActive ? "Journey started" : "Start this journey") {
                        startJourney()
                    }
                    .buttonStyle(.transitPrimary(accent))
                    .disabled(isActive)
                    .listRowBackground(Color.clear)
                    .cardListRow()

                    if plan.legs.contains(where: { $0.mode == "transit" }) {
                        reminderButton
                            .listRowBackground(Color.clear)
                            .cardListRow()
                    }
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

    @ViewBuilder
    private var reminderButton: some View {
        switch reminderState {
        case .idle:
            Button {
                Task { await setLeaveByReminder() }
            } label: {
                Label("Remind me when to leave", systemImage: "bell")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(accent)
        case .saving:
            ProgressView().frame(maxWidth: .infinity)
        case .saved:
            Label("We'll remind you when to leave", systemImage: "checkmark.circle.fill")
                .foregroundStyle(Theme.onTime)
                .frame(maxWidth: .infinity)
        case .failed(let message):
            VStack(spacing: 4) {
                Label("Couldn't set reminder", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(Theme.alert)
                Text(message).font(.caption).foregroundStyle(Theme.steel)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func setLeaveByReminder() async {
        reminderState = .saving
        do {
            try await environment.api.addLeaveByReminder(for: plan)
            reminderState = .saved
        } catch {
            reminderState = .failed(error.localizedDescription)
        }
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
        HStack(alignment: .top, spacing: 12) {
            CircularBadge(diameter: 36, fill: leg.mode == "walk" ? Theme.steel.opacity(0.5) : Color(hex: leg.route?.routeColor ?? "0073bd")) {
                Image(systemName: leg.mode == "walk" ? "figure.walk" : "tram.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
            }

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
