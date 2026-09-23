import SwiftUI
import TransitCore

/// One in-app alert card - a straight port of `JourneyAlert` from
/// `use-journey-alerts.ts`.
struct JourneyAlert: Identifiable, Equatable {
    enum Variant { case info, action, success, error }
    let id: String
    let variant: Variant
    let title: String
    let body: String?
    /// Seconds before it auto-dismisses - also drives the timer bar.
    let duration: TimeInterval
}

/// Fires one-shot in-app alerts for the events a rider being live-tracked
/// actually cares about - straight port of `use-journey-alerts.ts`: the bus
/// is a stop away, get on now, your stop is next, get off here, transfer on
/// foot, you've arrived, missing a connection. Every distinct event fires
/// at most once per journey (keyed by trip id, so a multi-leg journey still
/// gets a fresh set per leg).
@MainActor
final class JourneyAlertCenter {
    private static let alertDuration: TimeInterval = 9
    private static let urgentDuration: TimeInterval = 15
    private static let maxStack = 3
    /// Trains/ferries always stop, so they get the tighter, alight-style
    /// threshold; buses are request-stop and need real lead time - matches
    /// `NEAR_ALIGHT_M` on the web.
    private static let nearAlightMeters: Double = 220

    private(set) var stack: [JourneyAlert] = []
    private var firedKeys: Set<String> = []
    private var hasFiredArrived = false
    private var hasFiredMissedConnection = false

    private func fire(_ key: String, _ variant: JourneyAlert.Variant, _ title: String, _ body: String? = nil, supersedes: [String] = [], urgent: Bool = false) {
        guard !firedKeys.contains(key) else { return }
        firedKeys.insert(key)
        for s in supersedes { stack.removeAll { $0.id.hasPrefix(s) } }
        let alert = JourneyAlert(id: key, variant: variant, title: title, body: body, duration: urgent ? Self.urgentDuration : Self.alertDuration)
        stack.append(alert)
        if stack.count > Self.maxStack { stack.removeFirst(stack.count - Self.maxStack) }
        // Buzz with it - the rider is often not looking at the screen.
        UINotificationFeedbackGenerator().notificationOccurred(urgent ? .warning : .success)
    }

    func dismiss(_ id: String) {
        stack.removeAll { $0.id == id }
    }

    /// Resets fired-state for a new journey (a different plan) - the fired
    /// set otherwise persists for the life of this object.
    func reset() {
        stack = []
        firedKeys = []
        hasFiredArrived = false
        hasFiredMissedConnection = false
    }

    /// Call once per tick with the current tracking state - mirrors the
    /// web hook's effect body exactly, including the trip-id-keyed dedup.
    func evaluate(
        plan: JourneyPlan,
        trackedLeg: JourneyLeg?,
        trackedVehicle: Vehicle?,
        trackedStops: [TripStopRef],
        boarded: Bool,
        journeyArrived: Bool,
        connectionRisk: JourneyTracking.ConnectionRisk?,
        endLabel: String
    ) {
        if journeyArrived, !hasFiredArrived {
            hasFiredArrived = true
            fire("journey:arrived", .success, "You've arrived", "Welcome to \(endLabel).")
        }
        if connectionRisk?.level == .missed, !hasFiredMissedConnection {
            hasFiredMissedConnection = true
            fire("journey:missed-connection", .error, "You're likely to miss a connection", "Tap \u{201c}Find a better route from here\u{201d} for other options.", urgent: true)
        }

        guard let trackedLeg, let trackedVehicle, let tripID = trackedLeg.tripID.isEmpty ? nil : trackedLeg.tripID else { return }

        let boardSeq = JourneyTracking.findStopSequence(in: trackedStops, for: trackedLeg.fromStop)
        let alightSeq = JourneyTracking.findStopSequence(in: trackedStops, for: trackedLeg.toStop, after: boardSeq)
        let curSeq = trackedVehicle.trip?.currentStop?.sequence
        let nextSeq = trackedVehicle.trip?.nextStop?.sequence
        let name = trackedLeg.route?.routeShortName.isEmpty == false ? trackedLeg.route!.routeShortName : trackedLeg.routeID

        let isTransfer = plan.legs.firstIndex(where: { $0.tripID == trackedLeg.tripID && $0.mode == "transit" }).map { idx in
            idx > 0 && plan.legs[0..<idx].contains { $0.mode == "transit" }
        } ?? false

        if !boarded, isTransfer, let boardStop = trackedLeg.fromStop {
            fire(
                "\(tripID):transfer", .info, "Transfer to the \(name)",
                "Make your way to \(boardStop.stopName)\(boardStop.platformNumber.isEmpty ? "" : " (platform \(boardStop.platformNumber))")."
            )
        }

        if !boarded, let boardSeq {
            let nextIsBoard = nextSeq == boardSeq
            let atOrPastBoard = (curSeq ?? -1) >= boardSeq
            let metresToBoard = trackedLeg.fromStop.map { Geo.haversineDistanceMeters(trackedVehicle.position.coordinate, $0.coordinate) } ?? .infinity
            let arriving = (nextIsBoard && metresToBoard <= JourneyProgressModel.boardProximityThreshold(for: trackedVehicle.type)) || atOrPastBoard

            if nextIsBoard, !arriving {
                fire("\(tripID):board-soon", .info, "The \(name) is one stop away", trackedLeg.fromStop.map { "Get ready to board at \($0.stopName)." } ?? "Get ready to board.")
            }
            if arriving {
                fire(
                    "\(tripID):board-now", .action, "Get on the \(name) now",
                    trackedLeg.fromStop.map { "It's arriving at \($0.stopName) - flag it down if needed." },
                    supersedes: ["\(tripID):board-soon", "\(tripID):transfer"], urgent: true
                )
            }
        }

        if boarded, let alightSeq {
            let nextIsAlight = nextSeq == alightSeq
            let atOrPast = (curSeq ?? -1) >= alightSeq
            let metresToAlight = trackedLeg.toStop.map { Geo.haversineDistanceMeters(trackedVehicle.position.coordinate, $0.coordinate) } ?? .infinity
            let arriving = (nextIsAlight && metresToAlight <= Self.nearAlightMeters) || atOrPast

            if nextIsAlight, !arriving {
                fire("\(tripID):alight-soon", .action, "Your stop is next", trackedLeg.toStop.map { "Get ready to get off the \(name) at \($0.stopName)." } ?? "Get ready to get off the \(name).")
            }
            if arriving {
                fire(
                    "\(tripID):alight-now", .action, "This is your stop",
                    trackedLeg.toStop.map { "Get off the \(name) here \u{2014} \($0.stopName)." } ?? "Get off the \(name) here.",
                    supersedes: ["\(tripID):alight-soon"], urgent: true
                )
            }
        }
    }
}

/// A centred stack of up to 3 alert cards, each with an auto-dismiss timer
/// bar - port of the web's `JourneyAlertOverlay`.
struct JourneyAlertOverlay: View {
    let alerts: [JourneyAlert]
    let onDismiss: (String) -> Void

    var body: some View {
        VStack(spacing: 8) {
            ForEach(alerts) { alert in
                JourneyAlertCard(alert: alert) { onDismiss(alert.id) }
            }
        }
        .padding(.horizontal, 16)
        .animation(.spring(duration: 0.3), value: alerts.map(\.id))
    }
}

private struct JourneyAlertCard: View {
    let alert: JourneyAlert
    let onDismiss: () -> Void
    @State private var fraction: Double = 1

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(alert.title).font(.subheadline.weight(.semibold))
                    if let body = alert.body {
                        Text(body).font(.caption).foregroundStyle(Theme.mutedForeground)
                    }
                }
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark").font(.caption2.weight(.bold)).foregroundStyle(Theme.mutedForeground)
                }
            }
            GeometryReader { geo in
                Capsule().fill(iconColor.opacity(0.25)).frame(height: 3)
                    .overlay(alignment: .leading) {
                        Capsule().fill(iconColor).frame(width: geo.size.width * fraction, height: 3)
                    }
            }
            .frame(height: 3)
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(iconColor.opacity(0.3), lineWidth: 1))
        .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
        .onAppear {
            withAnimation(.linear(duration: alert.duration)) { fraction = 0 }
            Task {
                try? await Task.sleep(for: .seconds(alert.duration))
                onDismiss()
            }
        }
    }

    private var iconColor: Color {
        switch alert.variant {
        case .info: return Theme.live
        case .action: return Theme.warning
        case .success: return Theme.success
        case .error: return Theme.danger
        }
    }
}
