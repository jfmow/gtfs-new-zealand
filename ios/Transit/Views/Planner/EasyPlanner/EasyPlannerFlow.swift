import SwiftData
import SwiftUI
import TransitCore

/// The step-by-step planner, for riders who find the full planner a lot to
/// take in: four questions, one per screen, then one recommended journey in
/// plain words. It's the whole Planner tab when Settings' "Planner" is "Step
/// by step" (see `PlannerTab`).
struct EasyPlannerFlow: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(DeepLinkRouter.self) private var router
    @Query(sort: \SavedTrip.sortOrder) private var savedTrips: [SavedTrip]
    @Query(sort: \SavedPlace.sortOrder) private var allPlaces: [SavedPlace]

    @AppStorage(PlannerStyle.storageKey) private var plannerStyleRaw = PlannerStyle.stepByStep.rawValue
    @State private var model = EasyPlannerModel()
    @State private var path: [EasyPlannerModel.Step] = []

    var body: some View {
        NavigationStack(path: $path) {
            destinationStep
                .appToolbar()
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Full planner") { plannerStyleRaw = PlannerStyle.standard.rawValue }
                    }
                }
                .navigationDestination(for: EasyPlannerModel.Step.self) { step in
                    Group {
                        switch step {
                        case .mode: modeStep
                        case .time: timeStep
                        case .start: startStep
                        case .results:
                            EasyResultsView(
                                model: model,
                                onChangeAnswer: { goBack(to: $0) },
                                onShowDetails: { path.append(.details($0)) },
                                onStart: { path.append(.track($0)) },
                                onStartOver: startOver
                            )
                        case .details(let plan):
                            JourneyDetailView(plan: plan, context: model.searchContext)
                        case .track(let plan):
                            JourneyTrackingView(plan: plan)
                        }
                    }
                }
                .navigationBarTitleDisplayMode(.inline)
        }
        .tint(Theme.primary)
        .task { await model.loadAvailableModes(api: environment.api) }
        // A saved place tapped on Home answers question 1.
        .onChange(of: router.pendingDestination, initial: true) { _, destination in
            guard let destination else { return }
            router.pendingDestination = nil
            model.destination = destination
            isChangingDestination = false
            path = [.mode]
        }
    }

    /// "Plan another journey": back to question 1 with a clean slate (the
    /// remembered mode and start answers stay).
    private func startOver() {
        model.reset()
        isChangingDestination = false
        isChangingStart = false
        path = []
    }

    /// Back to one question from the results ("Change the time").
    private func goBack(to step: EasyPlannerModel.Step?) {
        guard let step else {
            path = []
            return
        }
        if let index = path.firstIndex(of: step) {
            path = Array(path.prefix(through: index))
        }
    }

    // MARK: - 1. Where do you want to go?

    @State private var isChangingDestination = false

    private var destinationStep: some View {
        EasyQuestionScreen(
            number: 1, title: "Where do you want to go?", buttonTitle: "Next",
            canContinue: model.destination != nil, onContinue: { path.append(.mode) }
        ) {
            if let destination = model.destination, !isChangingDestination {
                EasySelectedPlace(place: destination) { isChangingDestination = true }
            } else {
                EasyPlaceSearch(
                    prompt: "Type a place or address",
                    storageKey: "recentEndLocations",
                    savedPlaces: savedPlaces(tripEnds: true)
                ) { place in
                    model.destination = place
                    isChangingDestination = false
                }
            }
        }
    }

    // MARK: - 2. How do you want to get there?

    private var modeStep: some View {
        EasyQuestionScreen(
            number: 2, title: "How do you want to get there?", buttonTitle: "Next",
            canContinue: true, onContinue: { path.append(.time) }
        ) {
            VStack(spacing: 12) {
                EasyChoiceCard(title: "Any way is fine", subtitle: "Bus, train or ferry", systemImage: "arrow.triangle.branch",
                               isSelected: model.modes.isEmpty) { model.modes = [] }
                ForEach(model.availableModes, id: \.self) { mode in
                    EasyChoiceCard(title: mode.label, subtitle: model.modes.contains(mode) ? "Tap again to remove" : nil,
                                   systemImage: mode.systemImage, isSelected: model.modes.contains(mode)) {
                        if model.modes.contains(mode) { model.modes.remove(mode) } else { model.modes.insert(mode) }
                    }
                }
            }
            Text("You can choose more than one.")
                .font(.easyBody)
                .foregroundStyle(Theme.mutedForeground)

            Toggle(isOn: $model.walkLess) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Walk less, fewer changes").font(.easyChoice)
                    Text("Short walks at an easy pace, at most one change, and extra time to change.")
                        .font(.easyBody)
                        .foregroundStyle(Theme.mutedForeground)
                }
            }
            .toggleStyle(.switch)
            .padding(16)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
            .padding(.top, 8)
        }
    }

    // MARK: - 3. What time do you want to get there?

    private var timeStep: some View {
        EasyQuestionScreen(
            number: 3, title: "What time do you want to get there?", buttonTitle: "Next",
            canContinue: model.when == .soon || model.arriveBy > Date(), onContinue: { path.append(.start) }
        ) {
            VStack(spacing: 12) {
                EasyChoiceCard(title: "As soon as I can", subtitle: "Leave now", systemImage: "hare",
                               isSelected: model.when == .soon) { model.when = .soon }
                EasyChoiceCard(title: "By a certain time", subtitle: "Choose the time below", systemImage: "clock",
                               isSelected: model.when == .arriveBy) { model.when = .arriveBy }
            }
            if model.when == .arriveBy {
                arriveByPicker
            }
        }
    }

    private var arriveByPicker: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                dayChip("Today", offset: 0)
                dayChip("Tomorrow", offset: 1)
            }
            DatePicker("Arrive by", selection: $model.arriveBy, in: Date()..., displayedComponents: [.hourAndMinute])
                .datePickerStyle(.wheel)
                .labelsHidden()
                .frame(maxWidth: .infinity)
            Text(arriveBySentence)
                .font(.easyBodyMedium)
                .fixedSize(horizontal: false, vertical: true)
            DatePicker("Another day", selection: $model.arriveBy, in: Date()..., displayedComponents: [.date])
                .font(.easyBody)
        }
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func dayChip(_ title: String, offset: Int) -> some View {
        let calendar = Calendar.current
        let target = calendar.date(byAdding: .day, value: offset, to: Date()) ?? Date()
        let isSelected = calendar.isDate(model.arriveBy, inSameDayAs: target)
        return Button {
            let time = calendar.dateComponents([.hour, .minute], from: model.arriveBy)
            model.arriveBy = calendar.date(bySettingHour: time.hour ?? 9, minute: time.minute ?? 0, second: 0, of: target) ?? model.arriveBy
        } label: {
            Text(title)
                .font(.easyChoice)
                .foregroundStyle(isSelected ? Theme.primaryForeground : Theme.foreground)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(isSelected ? Theme.primary : Theme.muted, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var arriveBySentence: String {
        let calendar = Calendar.current
        let time = model.arriveBy.formatted(date: .omitted, time: .shortened)
        let day: String
        if calendar.isDateInToday(model.arriveBy) {
            day = "today"
        } else if calendar.isDateInTomorrow(model.arriveBy) {
            day = "tomorrow"
        } else {
            day = "on " + model.arriveBy.formatted(.dateTime.weekday(.wide).day().month(.wide))
        }
        return "You want to arrive by \(time) \(day)."
    }

    // MARK: - 4. Where are you starting from?

    @State private var isChangingStart = false

    private var startStep: some View {
        EasyQuestionScreen(
            number: 4, title: "Where are you starting from?", buttonTitle: "Find my journey",
            canContinue: model.startChoice == .here || model.otherStart != nil,
            onContinue: {
                path.append(.results)
                Task { await model.plan(environment: environment) }
            }
        ) {
            VStack(spacing: 12) {
                EasyChoiceCard(title: "Where I am now", subtitle: "Uses your phone's location", systemImage: "location.fill",
                               isSelected: model.startChoice == .here) { model.startChoice = .here }
                EasyChoiceCard(title: "Somewhere else", subtitle: "Search for a place", systemImage: "magnifyingglass",
                               isSelected: model.startChoice == .elsewhere) { model.startChoice = .elsewhere }
            }
            if model.startChoice == .here, locationDenied {
                Text("This app isn't allowed to use your location. You can turn it on in the Settings app, or choose \"Somewhere else\".")
                    .font(.easyBody)
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if model.startChoice == .elsewhere {
                if let start = model.otherStart, !isChangingStart {
                    EasySelectedPlace(place: start) { isChangingStart = true }
                } else {
                    EasyPlaceSearch(
                        prompt: "Type a place or address",
                        storageKey: "recentStartLocations",
                        savedPlaces: savedPlaces(tripEnds: false)
                    ) { place in
                        model.otherStart = place
                        isChangingStart = false
                    }
                }
            }
        }
        .onAppear {
            if model.startChoice == .here { environment.location.requestPermission() }
        }
    }

    private var locationDenied: Bool {
        let status = environment.location.authorizationStatus
        return status == .denied || status == .restricted
    }

    /// The rider's named places first, then the ends (or starts) of their
    /// saved trips, one per label.
    private func savedPlaces(tripEnds: Bool) -> [EasySavedPlace] {
        let named = allPlaces
            .filter { $0.regionSlug == environment.region.slug }
            .map { EasySavedPlace(icon: $0.placeIcon.systemImage, location: $0.plannerLocation) }
        let fromTrips = savedTrips.map {
            EasySavedPlace(icon: "star.fill", location: tripEnds
                ? PlannerLocation(label: $0.endLabel, coordinate: $0.endCoordinate)
                : PlannerLocation(label: $0.startLabel, coordinate: $0.startCoordinate))
        }
        var seen = Set<String>()
        return (named + fromTrips).filter { seen.insert($0.location.label).inserted }
    }
}
