import SwiftUI
import TransitCore

/// The planner's "Upcoming reminders": leave-by reminders soonest first,
/// each saying when it's next for (and how it repeats). Tapping one opens
/// its journey, or the planner filled in for the next occurrence when a
/// repeat hasn't been planned for the day yet.
struct UpcomingRemindersList: View {
    let reminders: [JourneyReminderDTO]
    let onOpen: (JourneyReminderTarget) -> Void

    @Environment(AppEnvironment.self) private var environment
    /// Each planned reminder's journey shifted to realtime, by reminder id -
    /// so the row's leave/arrive match what the journey says right now.
    @State private var livePlans: [Int: JourneyPlan] = [:]

    /// How far ahead live times are worth fetching; beyond this the feed has
    /// nothing and the server's estimate is as good.
    private static let liveWindow: TimeInterval = 3 * 3600

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Upcoming reminders")
            VStack(spacing: 0) {
                ForEach(Array(reminders.enumerated()), id: \.element.id) { index, reminder in
                    if index > 0 { RowDivider() }
                    row(reminder)
                }
            }
            .shadCardBackground()
        }
        .task(id: reminders.map(\.id)) {
            while !Task.isCancelled {
                await refreshLivePlans()
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }

    private func refreshLivePlans() async {
        var updated: [Int: JourneyPlan] = [:]
        for reminder in reminders {
            guard let planID = reminder.planID, !planID.isEmpty,
                  let date = reminder.nextLeaveDate ?? reminder.targetDate,
                  date.timeIntervalSinceNow < Self.liveWindow
            else { continue }
            if let plan = try? await environment.api.livePlan(id: planID) {
                updated[reminder.id] = plan
            } else if let previous = livePlans[reminder.id] {
                updated[reminder.id] = previous
            }
        }
        livePlans = updated
    }

    private func row(_ reminder: JourneyReminderDTO) -> some View {
        Button {
            if let target = reminder.target { onOpen(target) }
        } label: {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Theme.muted)
                    .overlay(
                        Image(systemName: reminder.isRepeating ? "alarm.waves.left.and.right" : "alarm")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.foreground)
                    )
                    .frame(width: 36, height: 36)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(reminder.startLabel.isEmpty ? "Start" : reminder.startLabel) → \(reminder.endLabel.isEmpty ? "Destination" : reminder.endLabel)")
                        .font(.bodyMedium)
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(2)
                    Text(Self.when(reminder, live: livePlans[reminder.id]))
                        .font(.meta)
                        .foregroundStyle(Theme.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.mutedForeground.opacity(0.7))
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(reminder.target == nil)
    }

    /// "Today · leave 10:07 am · arrive 10:36 am · Weekdays" - from the live
    /// journey when there is one, else the server's leave estimate and the
    /// arrive-by target.
    static func when(_ reminder: JourneyReminderDTO, live: JourneyPlan?) -> String {
        var parts: [String] = []
        let leave = live?.departureTime.date ?? reminder.nextLeaveDate
        let arrive = live?.arrivalTime.date
        if let day = leave ?? reminder.targetDate {
            let label = JourneyReminderMath.relativeDay(day)
            parts.append(label.prefix(1).uppercased() + label.dropFirst())
        }
        if let leave {
            parts.append("leave \(live == nil ? "~" : "")\(leave.formatted(date: .omitted, time: .shortened))")
        }
        if let arrive {
            parts.append("arrive \(arrive.formatted(date: .omitted, time: .shortened))")
        } else if reminder.timeType == "arriveat" {
            parts.append("arrive by \(localTime(reminder.targetHHMM) ?? reminder.targetHHMM)")
        } else if leave == nil {
            // A repeat not planned for the day yet: all we have is the ride
            // the rider picked (a depart-at target is its boarding time).
            parts.append("catch the \(localTime(reminder.targetHHMM) ?? reminder.targetHHMM)")
        }
        if reminder.isRepeating {
            parts.append(JourneyReminderMath.weekdayMaskLabel(reminder.recurrence))
        }
        return parts.joined(separator: " · ")
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
