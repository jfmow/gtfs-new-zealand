import SwiftData
import SwiftUI
import TransitCore

/// The journey planner - `pages/plan.tsx`'s search form + results list.
struct PlannerView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \SavedTrip.sortOrder) private var savedTrips: [SavedTrip]

    @State private var start: PlannerLocation?
    @State private var end: PlannerLocation?
    @State private var timeType: JourneyPlanRequest.TimeType = .now
    @State private var date = Date()
    @State private var maxWalkKm: Double = 1.0
    @State private var walkSpeed: Double = 4.8
    @State private var maxTransfers: Int = 5

    @State private var results: [JourneyPlan] = []
    @State private var isPlanning = false
    @State private var errorMessage: String?
    @State private var hasPlanned = false

    var body: some View {
        NavigationStack {
            List {
                if !savedTrips.isEmpty { savedTripsSection }
                formSection
                if hasPlanned { resultsSection }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.paper)
            .navigationTitle("Planner")
            .tint(Theme.accent(for: environment.region))
            .navigationDestination(for: JourneyPlan.self) { plan in
                JourneyDetailView(plan: plan)
            }
        }
    }

    private var savedTripsSection: some View {
        Section("Saved trips") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(savedTrips) { trip in
                        Button {
                            apply(trip)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(trip.name).font(.subheadline.bold())
                                Text("\(trip.startLabel) → \(trip.endLabel)")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            .padding(10)
                            .background(Color(hex: trip.colorHex).opacity(0.15))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .listRowInsets(EdgeInsets())
            .padding(.horizontal)
        }
    }

    private var formSection: some View {
        Section("Journey") {
            LocationField(placeholder: "From", location: $start)
            LocationField(placeholder: "To", location: $end)

            Picker("When", selection: $timeType) {
                Text("Leave now").tag(JourneyPlanRequest.TimeType.now)
                Text("Leave at").tag(JourneyPlanRequest.TimeType.departat)
                Text("Arrive by").tag(JourneyPlanRequest.TimeType.arriveat)
            }
            if timeType != .now {
                DatePicker("Time", selection: $date)
                    .datePickerStyle(.compact)
            }

            Stepper("Max walk: \(maxWalkKm.formatted(.number.precision(.fractionLength(1)))) km", value: $maxWalkKm, in: 0.2...5, step: 0.2)
            Stepper("Max transfers: \(maxTransfers)", value: $maxTransfers, in: 0...5)

            Button {
                Task { await plan() }
            } label: {
                if isPlanning {
                    ProgressView().tint(.white)
                } else {
                    Text("Plan journey")
                }
            }
            .buttonStyle(.transitPrimary(Theme.accent(for: environment.region)))
            .disabled(start == nil || end == nil || isPlanning)
            .listRowBackground(Color.clear)

            if start != nil, end != nil {
                Button("Save this trip") { saveTrip() }
                    .font(.caption)
            }
        }
    }

    @ViewBuilder
    private var resultsSection: some View {
        Section("Results") {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(Theme.steel)
            } else if results.isEmpty {
                Text("No journeys found").foregroundStyle(Theme.steel)
            } else {
                ForEach(results) { plan in
                    NavigationLink(value: plan) {
                        JourneyResultCard(plan: plan)
                    }
                    .boardRow()
                }
            }
        }
    }

    private func plan() async {
        guard let start, let end else { return }
        isPlanning = true
        defer { isPlanning = false }
        hasPlanned = true
        do {
            let request = JourneyPlanRequest(
                start: start.coordinate, end: end.coordinate, date: date, timeType: timeType,
                maxWalkKm: maxWalkKm, walkSpeed: walkSpeed, maxTransfers: maxTransfers
            )
            let plans = try await environment.api.planJourney(request)
            results = JourneyPlanRanking.pruneDominatedPlans(plans)
            errorMessage = nil
        } catch {
            results = []
            errorMessage = error.localizedDescription
        }
    }

    private func saveTrip() {
        guard let start, let end else { return }
        let trip = SavedTrip(
            name: "\(start.label) → \(end.label)",
            startLabel: start.label, startCoordinate: start.coordinate,
            endLabel: end.label, endCoordinate: end.coordinate,
            maxWalkKm: maxWalkKm, walkSpeed: walkSpeed, maxTransfers: maxTransfers,
            colorHex: ["0073bd", "d52923", "97c93d", "8b5cf6"].randomElement() ?? "0073bd",
            sortOrder: savedTrips.count
        )
        modelContext.insert(trip)
    }

    private func apply(_ trip: SavedTrip) {
        start = PlannerLocation(label: trip.startLabel, coordinate: trip.startCoordinate)
        end = PlannerLocation(label: trip.endLabel, coordinate: trip.endCoordinate)
        maxWalkKm = trip.maxWalkKm
        walkSpeed = trip.walkSpeed
        maxTransfers = trip.maxTransfers
        Task { await plan() }
    }
}

struct JourneyResultCard: View {
    let plan: JourneyPlan

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(TimeFormatting.formatDuration(plan.totalDuration)).font(.heroNumber(20))
                Spacer()
                Text(transfersLabel).font(.caption).foregroundStyle(Theme.steel)
            }
            HStack(spacing: 4) {
                if let departure = plan.departureTime.date, let arrival = plan.arrivalTime.date {
                    Text(departure, style: .time)
                    Text("–")
                    Text(arrival, style: .time)
                }
            }
            .font(.subheadline.monospacedDigit())
            .foregroundStyle(Theme.steel)

            HStack(spacing: 4) {
                ForEach(Array(plan.legs.enumerated()), id: \.offset) { _, leg in
                    legChip(leg)
                }
            }
        }
        .padding(.vertical, 6)
    }

    private var transfersLabel: String {
        plan.transfers == 0 ? "Direct" : "\(plan.transfers) transfer\(plan.transfers == 1 ? "" : "s")"
    }

    @ViewBuilder
    private func legChip(_ leg: JourneyLeg) -> some View {
        if leg.mode == "walk" {
            Label("\(Int((leg.duration.timeInterval / 60).rounded()))m", systemImage: "figure.walk")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.steel)
        } else if let route = leg.route {
            Text(route.routeShortName)
                .font(.caption2.bold())
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color(hex: route.routeColor.isEmpty ? "6b7280" : route.routeColor))
                .foregroundStyle(.white)
                .clipShape(Capsule())
        }
    }
}
