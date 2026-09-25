import SwiftData
import SwiftUI
import TransitCore

/// The step-by-step planner's answer: one recommended journey as numbered
/// plain-English steps, with big Start / Remind me / Save buttons. Other
/// options are one tap away, and a search that finds nothing offers a way
/// back to the question to change.
struct EasyResultsView: View {
    @Bindable var model: EasyPlannerModel
    /// nil = back to the first question.
    let onChangeAnswer: (EasyPlannerModel.Step?) -> Void
    let onShowDetails: (JourneyPlan) -> Void
    let onStart: (JourneyPlan) -> Void
    let onStartOver: () -> Void

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \SavedTrip.sortOrder) private var savedTrips: [SavedTrip]

    @State private var reminderPlan: JourneyPlan?
    @State private var showsOtherWays = false
    @State private var saved = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                switch model.status {
                case .idle, .planning:
                    planning
                case .failed(let message):
                    failed(message)
                case .found:
                    found
                }
            }
            .padding(20)
        }
        .pageBackground()
        .navigationTitle("Your journey")
        .sheet(item: $reminderPlan) { plan in
            LeaveReminderSheet(plan: plan, context: model.searchContext)
                .shadSheet(detents: [.large])
        }
    }

    // MARK: - States

    private var planning: some View {
        VStack(spacing: 20) {
            ProgressView().controlSize(.large)
            Text("Finding the easiest way…")
                .font(.easyChoice)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
        .accessibilityElement(children: .combine)
    }

    private func failed(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Sorry")
                .font(.easyQuestion)
                .accessibilityAddTraits(.isHeader)
            Text(message)
                .font(.easyBody)
                .fixedSize(horizontal: false, vertical: true)
            Text("You could try:")
                .font(.easyBodyMedium)
                .padding(.top, 8)
            EasySecondaryButton(title: "Try again", systemImage: "arrow.clockwise") {
                Task { await model.plan(environment: environment) }
            }
            EasySecondaryButton(title: "Change the time", systemImage: "clock") { onChangeAnswer(.time) }
            EasySecondaryButton(title: "Change how you travel", systemImage: "bus") { onChangeAnswer(.mode) }
            EasySecondaryButton(title: "Change where you start", systemImage: "location") { onChangeAnswer(.start) }
            EasySecondaryButton(title: "Change where you're going", systemImage: "mappin") { onChangeAnswer(nil) }
        }
    }

    @ViewBuilder
    private var found: some View {
        if let best = model.plans.first {
            if let note = model.fallbackNote {
                Label {
                    Text(note).font(.easyBody).fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "info.circle.fill").foregroundStyle(Theme.live)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.live.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }

            EasyJourneyCard(plan: best, destinationName: destinationName, isRecommended: true)

            VStack(spacing: 12) {
                EasyPrimaryButton(title: "Start this journey", systemImage: "location.north.fill") { start(best) }
                if canRemind(best) {
                    EasySecondaryButton(title: "Remind me when to leave", systemImage: "alarm") { reminderPlan = best }
                }
                EasySecondaryButton(title: saved ? "Trip saved" : "Save this trip", systemImage: saved ? "checkmark" : "star") {
                    save()
                }
                .disabled(saved)
                EasySecondaryButton(title: "See it on a map", systemImage: "map") { onShowDetails(best) }
            }

            let others = Array(model.plans.dropFirst())
            if !others.isEmpty {
                EasySecondaryButton(
                    title: showsOtherWays ? "Hide other ways" : "See \(others.count) other way\(others.count == 1 ? "" : "s")",
                    systemImage: showsOtherWays ? "chevron.up" : "chevron.down"
                ) {
                    withAnimation { showsOtherWays.toggle() }
                }
                .padding(.top, 8)
                if showsOtherWays {
                    ForEach(others) { plan in
                        VStack(spacing: 12) {
                            EasyJourneyCard(plan: plan, destinationName: destinationName, isRecommended: false)
                            EasySecondaryButton(title: "Use this one", systemImage: "location.north.fill") { start(plan) }
                        }
                    }
                }
            }

            EasySecondaryButton(title: "Plan another journey", systemImage: "arrow.counterclockwise", action: onStartOver)
                .padding(.top, 8)
        }
    }

    // MARK: - Actions

    private var destinationName: String { model.destination?.label ?? "where you're going" }

    private func canRemind(_ plan: JourneyPlan) -> Bool {
        guard plan.legs.contains(where: { $0.mode == "transit" }), let departure = plan.departureTime.date else { return false }
        return departure > Date().addingTimeInterval(60)
    }

    /// Same as the journey screen's Start: one tracked journey at a time.
    private func start(_ plan: JourneyPlan) {
        guard let arrival = plan.arrivalTime.date else { return }
        for old in (try? modelContext.fetch(FetchDescriptor<ActiveJourney>())) ?? [] { modelContext.delete(old) }
        modelContext.insert(ActiveJourney(
            planID: plan.id, regionSlug: environment.region.slug, endLabel: destinationName, arrivalTime: arrival
        ))
        onStart(plan)
    }

    private func save() {
        guard let start = model.plannedStart, let end = model.destination else { return }
        let options = model.plannedOptions
        let trip = SavedTrip(
            name: end.label,
            startLabel: start.label, startCoordinate: start.coordinate,
            endLabel: end.label, endCoordinate: end.coordinate,
            maxWalkKm: options.maxWalkKm, walkSpeed: options.walkSpeed, maxTransfers: options.maxTransfers,
            colorHex: Swatches.color(at: savedTrips.count),
            sortOrder: savedTrips.count
        )
        trip.travelModes = model.plannedModes
        trip.minTransferSec = options.minTransferSec
        modelContext.insert(trip)
        environment.toasts.show("Trip saved")
        saved = true
    }
}

/// One journey in plain words: when to leave, numbered steps, when you'll
/// arrive.
struct EasyJourneyCard: View {
    let plan: JourneyPlan
    let destinationName: String
    let isRecommended: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if isRecommended {
                Text("The easiest way")
                    .font(.easyBodyMedium)
                    .foregroundStyle(Theme.success)
            }
            timeLine(label: "Leave at", date: plan.departureTime.date)

            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(EasyJourneyStep.steps(for: plan, destinationName: destinationName).enumerated()), id: \.offset) { index, step in
                    stepRow(number: index + 1, step: step)
                }
            }

            timeLine(label: "You'll arrive at", date: plan.arrivalTime.date)

            if plan.legs.contains(where: { $0.mode == "transit" && !$0.tripUsable }) {
                Label("One of these services has a problem today. It may not run.", systemImage: "exclamationmark.triangle.fill")
                    .font(.easyBodyMedium)
                    .foregroundStyle(Theme.danger)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(isRecommended ? Theme.primary : Theme.border, lineWidth: isRecommended ? 2 : 1)
        )
    }

    @ViewBuilder
    private func timeLine(label: String, date: Date?) -> some View {
        if let date {
            (Text(label + " ").font(.easyChoice).foregroundColor(Theme.mutedForeground)
                + Text(EasyJourneyStep.clock(date)).font(.geist(22, .bold, relativeTo: .title2)).foregroundColor(Theme.foreground))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func stepRow(number: Int, step: EasyJourneyStep) -> some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                Circle().fill(Theme.muted)
                Image(systemName: icon(for: step.kind))
                    .font(.system(size: 14, weight: .semibold))
            }
            .frame(width: 32, height: 32)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("\(number). \(step.headline)")
                    .font(.easyChoice)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail = step.detail {
                    Text(detail)
                        .font(.easyBody)
                        .foregroundStyle(Theme.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func icon(for kind: EasyJourneyStep.Kind) -> String {
        switch kind {
        case .walk: "figure.walk"
        case .ride(let mode): mode?.systemImage ?? "bus.fill"
        }
    }
}
