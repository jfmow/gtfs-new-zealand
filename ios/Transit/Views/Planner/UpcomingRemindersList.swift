import SwiftUI
import TransitCore

/// The planner's "Upcoming reminders": leave-by reminders soonest first,
/// each saying when it's next for (and how it repeats). Tapping one opens
/// its journey, or the planner filled in for the next occurrence when a
/// repeat hasn't been planned for the day yet.
struct UpcomingRemindersList: View {
    let reminders: [JourneyReminderDTO]
    let onOpen: (JourneyReminderTarget) -> Void

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
                    Text(Self.when(reminder))
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

    /// "Tomorrow · arrive by 8:30 am · leave ~8:02 · Weekdays"
    static func when(_ reminder: JourneyReminderDTO) -> String {
        var parts: [String] = []
        // A depart-at target is the ride's boarding time, not when to walk
        // out the door - that's next_leave_local.
        let verb = reminder.timeType == "arriveat" ? "arrive by" : "depart"
        if let date = reminder.targetDate {
            let day = JourneyReminderMath.relativeDay(date)
            parts.append(day.prefix(1).uppercased() + day.dropFirst())
            // target_unix is the boarding time on a one-off reminder, not the
            // arrive-by time - target_hhmm is always what the rider asked for.
            let time = localTime(reminder.targetHHMM) ?? date.formatted(date: .omitted, time: .shortened)
            parts.append("\(verb) \(time)")
        } else {
            parts.append("\(verb) \(reminder.targetHHMM)")
        }
        if let local = reminder.nextLeaveLocal, !local.isEmpty {
            parts.append("leave ~\(local)")
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
