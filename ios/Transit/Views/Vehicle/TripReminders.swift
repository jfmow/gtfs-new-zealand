import SwiftUI
import TransitCore

/// One-shot per-trip reminders - shared between `VehicleQuickLookView` and
/// `JourneyTrackingView`, both of which let a person pick a reminder type
/// then tap the stop it applies to. Mirrors `tracker/stops-list.tsx`'s
/// `ReminderType` (minus `"leave"`, which needs a full journey plan to
/// compute against and is handled separately by the Planner's "Remind me
/// when to leave").
enum ReminderKind: String, CaseIterable, Identifiable {
    case getOff = "get_off"
    case arrival = "arrival"
    case nStopsAway = "n_stops_away"

    var id: String { rawValue }

    var menuLabel: String {
        switch self {
        case .getOff: return "Remind me to get off"
        case .arrival: return "Remind me on arrival"
        case .nStopsAway: return "Remind me N stops away"
        }
    }

    var menuIcon: String {
        switch self {
        case .getOff: return "figure.walk.arrival"
        case .arrival: return "location.fill"
        case .nStopsAway: return "number.circle"
        }
    }

    /// Matches the web banner copy in `tracker/stops-list.tsx` exactly.
    func bannerText(nStopsAway: Int) -> String {
        switch self {
        case .getOff: return "Tap the stop where you want to get off"
        case .arrival: return "Tap the stop to watch — you'll be told when the vehicle is arriving"
        case .nStopsAway: return "Tap the stop to watch — you'll be told when the vehicle is \(nStopsAway) stop\(nStopsAway == 1 ? "" : "s") away"
        }
    }

    func confirmationText(stopName: String, nStopsAway: Int) -> String {
        switch self {
        case .getOff: return "Reminder added! You'll get a notification when your stop is next"
        case .nStopsAway: return "Reminder set! You'll get a notification when the vehicle is \(nStopsAway) stop\(nStopsAway == 1 ? "" : "s") away"
        case .arrival: return "Arrival reminder set! You'll get a notification when approaching \(stopName)"
        }
    }
}

enum ReminderStatus: Equatable {
    case success(String)
    case failure(String)
}

/// The toolbar bell - a menu of reminder types when nothing's being picked,
/// a "Cancel" button while a stop is being tapped for one.
struct ReminderMenuButton: View {
    let isSelecting: Bool
    let onBegin: (ReminderKind) -> Void
    let onCancel: () -> Void

    var body: some View {
        if isSelecting {
            Button("Cancel", action: onCancel)
        } else {
            Menu {
                ForEach(ReminderKind.allCases) { kind in
                    Button {
                        onBegin(kind)
                    } label: {
                        Label(kind.menuLabel, systemImage: kind.menuIcon)
                    }
                }
            } label: {
                Image(systemName: "bell")
            }
        }
    }
}

/// The sticky blue instruction banner atop the stop list while a reminder
/// type is being placed - matches the web's equivalent in
/// `tracker/stops-list.tsx`.
struct ReminderBanner: View {
    let kind: ReminderKind
    @Binding var nStopsAway: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(kind.bannerText(nStopsAway: nStopsAway))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.blue)
            if kind == .nStopsAway {
                Stepper("Stops away: \(nStopsAway)", value: $nStopsAway, in: 1...20)
                    .font(.footnote)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.blue.opacity(0.08))
    }
}

struct ReminderStatusBanner: View {
    let status: ReminderStatus
    let onExpire: () -> Void

    var body: some View {
        Group {
            switch status {
            case .success(let message):
                Label(message, systemImage: "checkmark.circle.fill").foregroundStyle(Theme.success)
            case .failure(let message):
                Label(message, systemImage: "xmark.circle.fill").foregroundStyle(Theme.danger)
            }
        }
        .font(.footnote)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.card)
        .onAppear {
            Task {
                try? await Task.sleep(for: .seconds(6))
                onExpire()
            }
        }
    }
}
