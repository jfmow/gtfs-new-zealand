import SwiftUI
import TransitCore

/// The search a reminder is built from - `LeaveReminderContext` on the web.
struct PlannerSearchContext {
    var start: PlannerLocation?
    var end: PlannerLocation?
    var arriveBy: Bool
    var maxWalkKm: Double
    var walkSpeed: Double
    var maxTransfers: Int
    var onlyRoutes: [RouteSearchResult]
}

/// "Remind me when to leave" - `components/journey/leave-reminder-dialog.tsx`.
/// Heads-up chips (30/15/5 min before, and the "when to leave" go signal),
/// repeat once / weekdays / custom days with an optional end date.
struct LeaveReminderSheet: View {
    let plan: JourneyPlan
    let context: PlannerSearchContext

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss

    private enum Repeat: Hashable { case once, weekdays, custom }
    private static let offsetChoices: [(value: Int, label: String)] = [
        (30, "30 min before"), (15, "15 min before"), (5, "5 min before"), (0, "When to leave"),
    ]
    private static let dayLabels = ["M", "T", "W", "T", "F", "S", "S"]
    private static let dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    @State private var offsets: Set<Int> = [30, 15, 5, 0]
    @State private var repeatMode: Repeat = .once
    @State private var customDays = Array(repeating: false, count: 7)
    @State private var hasUntil = false
    @State private var until = Calendar.current.date(byAdding: .day, value: 30, to: Date()) ?? Date()
    @State private var isSubmitting = false

    private var leaveTime: Date? { JourneyReminderMath.leaveTime(plan) }

    private func offsetPassed(_ minutes: Int) -> Bool {
        guard repeatMode == .once, let leaveTime else { return false }
        return leaveTime.addingTimeInterval(-Double(minutes) * 60) <= Date().addingTimeInterval(15)
    }

    private var usableOffsets: [Int] {
        offsets.filter { !offsetPassed($0) }.sorted(by: >)
    }

    private var recurrenceMask: String {
        switch repeatMode {
        case .once: return ""
        case .weekdays: return "1111100"
        case .custom:
            let mask = customDays.map { $0 ? "1" : "0" }.joined()
            return mask.contains("1") ? mask : ""
        }
    }

    private var startPlace: JourneyReminderRequest.Place {
        if let start = context.start { return .init(label: start.label, coordinate: start.coordinate) }
        return .init(label: "Start", coordinate: Coordinate(latitude: plan.startLat, longitude: plan.startLon))
    }

    private var endPlace: JourneyReminderRequest.Place {
        if let end = context.end { return .init(label: end.label, coordinate: end.coordinate) }
        return .init(label: "Destination", coordinate: Coordinate(latitude: plan.endLat, longitude: plan.endLon))
    }

    private var targetText: String {
        let transit = plan.legs.first { $0.mode == "transit" }
        let date = context.arriveBy ? plan.arrivalTime.date : (transit?.scheduledDepartureTime.date ?? transit?.departureTime.date)
        return (context.arriveBy ? "arrive by " : "depart ") + (date?.formatted(date: .omitted, time: .shortened) ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(startPlace.label) → \(endPlace.label)")
                            .font(.bodyMedium)
                            .lineLimit(3)
                        Text(targetText.prefix(1).uppercased() + targetText.dropFirst())
                            .font(.meta)
                            .foregroundStyle(Theme.mutedForeground)
                        if let leaveTime, repeatMode == .once {
                            (Text("Leave at ").foregroundColor(Theme.mutedForeground)
                                + Text(leaveTime.formatted(date: .omitted, time: .shortened)).fontWeight(.semibold))
                                .font(.bodyText)
                                .padding(.top, 4)
                        }
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(Theme.card)
                }

                Section {
                    ForEach(Self.offsetChoices.reversed(), id: \.value) { choice in
                        offsetRow(choice.value)
                    }
                } header: {
                    Text("Notify me")
                } footer: {
                    Text(repeatMode == .once && usableOffsets.isEmpty && !offsets.isEmpty
                         ? "This journey leaves too soon to set a reminder. Try repeating it, or an earlier trip."
                         : "\"When it's time to leave\" is the go signal; the others are early nudges.")
                }

                Section {
                    Picker("Repeat", selection: $repeatMode) {
                        Text("Never").tag(Repeat.once)
                        Text("Weekdays").tag(Repeat.weekdays)
                        Text("Custom").tag(Repeat.custom)
                    }
                    .listRowBackground(Theme.card)
                    if repeatMode == .custom {
                        dayPicker.listRowBackground(Theme.card)
                    }
                    if repeatMode != .once {
                        Toggle("End repeat", isOn: $hasUntil)
                            .tint(Theme.success)
                            .listRowBackground(Theme.card)
                        if hasUntil {
                            DatePicker("Last day", selection: $until, in: Date()...(Calendar.current.date(byAdding: .day, value: 90, to: Date()) ?? Date()), displayedComponents: .date)
                                .listRowBackground(Theme.card)
                        }
                    }
                } footer: {
                    if !recurrenceMask.isEmpty {
                        Text("Each day we'll find the best journey with these settings and tell you when to leave. Up to 90 days ahead.")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .groupedPageBackground()
            .tint(Theme.primary)
            .navigationTitle("Remind me")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { await submit() }
                } label: {
                    HStack(spacing: 6) {
                        if isSubmitting { ProgressView().tint(Theme.primaryForeground) }
                        Text(isSubmitting ? "Setting…" : "Set reminder")
                    }
                }
                .buttonStyle(.shad(.default, size: .pill, fullWidth: true))
                .disabled(isSubmitting || usableOffsets.isEmpty || (repeatMode == .custom && recurrenceMask.isEmpty))
                .padding(16)
                .background(Theme.background)
            }
        }
    }

    private func offsetRow(_ minutes: Int) -> some View {
        let passed = offsetPassed(minutes)
        let isOn = offsets.contains(minutes) && !passed
        let title = minutes == 0 ? "When it's time to leave" : "\(minutes) minutes before"
        return Button {
            if offsets.contains(minutes) { offsets.remove(minutes) } else { offsets.insert(minutes) }
        } label: {
            HStack {
                Text(title).foregroundStyle(passed ? Theme.mutedForeground : Theme.foreground)
                if passed { Text("passed").font(.meta).foregroundStyle(Theme.mutedForeground) }
                Spacer()
                if isOn {
                    Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.primary)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
        }
        .disabled(passed)
        .listRowBackground(Theme.card)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    private var dayPicker: some View {
        HStack(spacing: 0) {
            ForEach(0..<7, id: \.self) { index in
                Button {
                    customDays[index].toggle()
                } label: {
                    Text(Self.dayLabels[index])
                        .font(.geist(13, .medium, relativeTo: .footnote))
                        .frame(width: 36, height: 36)
                        .foregroundStyle(customDays[index] ? Theme.primaryForeground : Theme.foreground)
                        .background(customDays[index] ? Theme.primary : Theme.muted, in: Circle())
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
                .accessibilityLabel(Self.dayNames[index])
                .accessibilityAddTraits(customDays[index] ? .isSelected : [])
            }
        }
        .padding(.vertical, 4)
    }

    private func submit() async {
        guard !usableOffsets.isEmpty else {
            environment.toasts.show(offsets.isEmpty ? "Pick at least one alert time" : "Those alert times have already passed", .error)
            return
        }
        let untilString: String? = hasUntil && !recurrenceMask.isEmpty ? {
            let f = DateFormatter()
            f.calendar = Calendar(identifier: .gregorian)
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy-MM-dd"
            return f.string(from: until)
        }() : nil

        guard let request = JourneyReminderRequest.make(
            plan: plan, start: startPlace, end: endPlace, arriveBy: context.arriveBy,
            maxWalkKm: context.maxWalkKm, walkSpeed: context.walkSpeed, maxTransfers: context.maxTransfers,
            onlyRoutes: context.onlyRoutes.map(\.routeID), offsets: usableOffsets,
            recurrence: recurrenceMask, recurrenceUntil: untilString, regionSlug: environment.region.slug
        ) else {
            environment.toasts.show("This journey has no ride to remind you about.", .error)
            return
        }

        if !environment.push.isAuthorized {
            await environment.push.requestPermission()
        }

        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let created = try await environment.api.addJourneyReminder(request)
            if let local = created.nextLeaveLocal, let leave = Self.localTime(local) {
                environment.toasts.show("Reminder set, leave around \(leave)")
            } else {
                environment.toasts.show("Reminder set. We'll work out your leave time on the day.")
            }
            await environment.notificationFeed.refresh()
            dismiss()
        } catch {
            environment.toasts.show(error.localizedDescription.isEmpty ? "Couldn't set the reminder" : error.localizedDescription, .error)
        }
    }

    /// "HH:MM" (NZ local, from the server) -> "8:05 am".
    private static func localTime(_ hhmm: String) -> String? {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        var c = DateComponents()
        c.hour = parts[0]
        c.minute = parts[1]
        guard let date = Calendar.current.date(from: c) else { return nil }
        return date.formatted(date: .omitted, time: .shortened)
    }
}
