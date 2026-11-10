import ActivityKit
import SwiftUI
import WidgetKit

// Trip Live Activity - one vehicle counted down to the rider's stop, from the
// trip tracker's reminders. Same layout as the journey card: route tile,
// instruction + one line of detail, big countdown; then the vehicle sliding
// in toward your stop; then one status line.

typealias TripState = TripActivityAttributes.ContentState

struct TripLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripActivityAttributes.self) { context in
            TripLockScreen(attributes: context.attributes, state: context.state, isStale: context.isStale)
                .activityBackgroundTint(Tokens.card)
                .activitySystemActionForegroundColor(Tokens.foreground)
                .widgetURL(context.attributes.tripURL)
        } dynamicIsland: { context in
            let a = context.attributes
            let state = context.state
            let stale = context.isStale
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    TripStatus(attributes: a, state: state, isStale: stale)
                        .font(.geist(12, .medium))
                        .padding(.leading, 8)
                        .padding(.top, 2)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(a.headsign.isEmpty ? "" : "to \(a.headsign)")
                        .font(.geist(12, .medium))
                        .foregroundStyle(Color.white.opacity(0.7))
                        .lineLimit(1)
                        .padding(.trailing, 8)
                        .padding(.top, 2)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 12) {
                        HStack(alignment: .center, spacing: 12) {
                            TripTile(attributes: a, state: state, size: 44)
                            TripHeadline(attributes: a, state: state, titleSize: 15, onDark: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if !tripFinished(state) {
                                TripStopsAway(attributes: a, state: state, isStale: stale, numberSize: 26)
                            }
                        }
                        TripTrack(attributes: a, state: state, onDark: true)
                    }
                    .padding(.horizontal, 6)
                    .padding(.top, 4)
                }
            } compactLeading: {
                HStack(spacing: 4) {
                    Image(systemName: tripModeSymbol(a.vehicleMode) ?? "mappin.circle.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white)
                    if !a.routeShortName.isEmpty {
                        TripRouteChip(name: a.routeShortName, hex: a.routeColorHex, size: 11)
                    }
                }
                .padding(.leading, 2)
            } compactTrailing: {
                TripCompact(state: state, isStale: stale)
                    .padding(.trailing, 2)
            } minimal: {
                TripMinimal(attributes: a, state: state)
            }
            .widgetURL(a.tripURL)
            .keylineTint(a.routeColorHex.isEmpty ? Color.white : Color(hex: a.routeColorHex))
        }
    }
}

// MARK: - Lock Screen

private struct TripLockScreen: View {
    let attributes: TripActivityAttributes
    let state: TripState
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                TripTile(attributes: attributes, state: state, size: 46)
                TripHeadline(attributes: attributes, state: state, titleSize: 17, onDark: false)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !tripFinished(state) {
                    TripStopsAway(attributes: attributes, state: state, isStale: isStale, numberSize: 30)
                }
            }
            TripTrack(attributes: attributes, state: state, onDark: false)
            if !tripFinished(state) {
                TripStatus(attributes: attributes, state: state, isStale: isStale)
                    .font(.geist(13, .medium))
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

/// The route's colour with its vehicle and name; a tick once it's been.
private struct TripTile: View {
    let attributes: TripActivityAttributes
    let state: TripState
    let size: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
        Group {
            if state.phase == "gone" {
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.4, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(Tokens.success, in: shape)
            } else {
                let hex = attributes.routeColorHex.isEmpty ? Tokens.neutralRoute : attributes.routeColorHex
                VStack(spacing: 1) {
                    if let symbol = tripModeSymbol(attributes.vehicleMode) {
                        Image(systemName: symbol).font(.system(size: size * 0.28, weight: .semibold))
                    }
                    Text(attributes.routeShortName)
                        .font(.geist(size * 0.3, .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                }
                .foregroundStyle(RouteColors.text(onHex: hex))
                .padding(.horizontal, 3)
                .frame(width: size, height: size)
                .background(Color(hex: hex), in: shape)
            }
        }
        .accessibilityHidden(true)
    }
}

/// "Get off at …" / "Arriving at …", and the one fact that goes with it.
private struct TripHeadline: View {
    let attributes: TripActivityAttributes
    let state: TripState
    let titleSize: CGFloat
    let onDark: Bool

    private var title: String {
        let getOff = attributes.kind == "get_off"
        switch state.phase {
        case "gone": return getOff ? "At \(attributes.stopName)" : "Arrived at \(attributes.stopName)"
        case "next": return getOff ? "Get off next stop" : "\(attributes.stopName) is next"
        default: return getOff ? "Get off at \(attributes.stopName)" : "Arriving at \(attributes.stopName)"
        }
    }

    private var detail: String? {
        if state.phase == "cancelled" { return "This trip is cancelled" }
        if state.skipped { return "Not stopping at \(attributes.stopName)" }
        if state.phase == "gone" { return "Arrived \(tripClock(state.targetDate))" }
        return "Arrives \(tripClock(state.targetDate))"
    }

    private var urgent: Bool { state.phase == "next" && attributes.kind == "get_off" }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.geist(titleSize, .semibold))
                .foregroundStyle(urgent ? Tokens.warning : onDark ? Color.white : Tokens.foreground)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            if let detail {
                Text(detail)
                    .font(.geist(titleSize - 3))
                    .foregroundStyle(state.phase == "cancelled" || state.skipped ? Tokens.danger : Tokens.mutedForeground)
                    .lineLimit(1)
            }
        }
    }
}

/// The big number: how many stops until yours ("Next" when it's the next
/// one). No live vehicle yet: the time it's due instead, since there's
/// nothing to count.
private struct TripStopsAway: View {
    let attributes: TripActivityAttributes
    let state: TripState
    let isStale: Bool
    let numberSize: CGFloat

    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(tripBigText(state))
                .font(.geist(numberSize, .bold).monospacedDigit())
                .foregroundStyle(state.phase == "cancelled" ? Tokens.danger : state.phase == "next" ? Tokens.warning : Tokens.foreground)
                .multilineTextAlignment(.trailing)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(caption)
                .font(.geist(12, .medium))
                .foregroundStyle(Tokens.mutedForeground)
                .lineLimit(1)
                .fixedSize()
        }
        .frame(minWidth: 60, maxWidth: 104, alignment: .trailing)
        .opacity(isStale ? 0.6 : 1)
    }

    private var caption: String {
        if state.phase == "cancelled" { return "cancelled" }
        if state.phase == "next" { return "stop" }
        if let away = tripStopsAway(state) { return away == 1 ? "stop away" : "stops away" }
        return "due"
    }
}

/// The vehicle sliding in toward your stop, up to eight stops out.
private struct TripTrack: View {
    let attributes: TripActivityAttributes
    let state: TripState
    let onDark: Bool

    var body: some View {
        let color = attributes.routeColorHex.isEmpty ? (onDark ? Color.white : Tokens.foreground) : Color(hex: attributes.routeColorHex)
        let ground = onDark ? Color.white.opacity(0.18) : Tokens.border
        let background = onDark ? Color.black : Tokens.card
        // Up to eight stops out the vehicle slides in toward your stop; further
        // out, or not live yet, it waits at the start.
        let window = 8.0
        let fraction = state.phase == "gone" ? 1 : tripStopsAway(state).map { 1 - min(Double($0), window) / window } ?? 0
        Group {
            GeometryReader { geo in
                let width = geo.size.width
                let x = max(9, min(width - 9, width * fraction))
                ZStack(alignment: .leading) {
                    Capsule().fill(ground).frame(height: 6)
                    Capsule().fill(color).frame(width: x, height: 6)
                    Image(systemName: "mappin.circle.fill")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Tokens.danger)
                        .background(Circle().fill(background))
                        .position(x: width - 7, y: 9)
                    Image(systemName: tripModeSymbol(attributes.vehicleMode) ?? "circle.fill")
                        .font(.system(size: tripModeSymbol(attributes.vehicleMode) == nil ? 5 : 8, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 18, height: 18)
                        .background(color, in: Circle())
                        .overlay(Circle().strokeBorder(background, lineWidth: 2))
                        .position(x: x, y: 9)
                }
            }
            .frame(height: 18)
            .accessibilityHidden(true)
        }
    }
}

/// Live or timetable, then how late.
private struct TripStatus: View {
    let attributes: TripActivityAttributes
    let state: TripState
    let isStale: Bool

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(state.isRealtime && !isStale ? Tokens.success : Tokens.mutedForeground)
                .frame(width: 7, height: 7)
            Text(state.isRealtime ? (isStale ? "Updating…" : "Live") : "Timetable")
                .foregroundStyle(Tokens.mutedForeground)
            if state.delayMinutes > 1 {
                Text("\(state.delayMinutes) min late").foregroundStyle(Tokens.warning)
            } else if state.delayMinutes < -1 {
                Text("\(-state.delayMinutes) min early").foregroundStyle(Tokens.warning)
            } else if state.isRealtime {
                Text("On time").foregroundStyle(Tokens.mutedForeground)
            }
        }
        .lineLimit(1)
    }
}

private struct TripCompact: View {
    let state: TripState
    let isStale: Bool

    var body: some View {
        Group {
            if state.phase == "gone" {
                Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Tokens.success)
            } else if state.phase == "cancelled" {
                Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Tokens.danger)
            } else if state.phase == "next" {
                Text("Next").font(.geist(13, .bold)).foregroundStyle(Tokens.warning)
            } else if let away = tripStopsAway(state) {
                Text(away == 1 ? "1 stop" : "\(away) stops").font(.geist(13, .bold).monospacedDigit())
            } else {
                Text(tripClock(state.targetDate)).font(.geist(13, .bold).monospacedDigit())
            }
        }
        .foregroundStyle(.white)
        .opacity(isStale ? 0.6 : 1)
    }
}

private struct TripMinimal: View {
    let attributes: TripActivityAttributes
    let state: TripState

    var body: some View {
        let tint = attributes.routeColorHex.isEmpty ? Color.white : Color(hex: attributes.routeColorHex)
        let symbol = tripModeSymbol(attributes.vehicleMode) ?? "mappin"
        if state.phase == "gone" {
            Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Tokens.success)
        } else if state.phase == "next" {
            Image(systemName: "mappin").font(.system(size: 11, weight: .bold)).foregroundStyle(Tokens.warning)
        } else if let away = tripStopsAway(state) {
            Text("\(away)").font(.geist(13, .bold).monospacedDigit()).foregroundStyle(tint)
        } else {
            Image(systemName: symbol).font(.system(size: 11, weight: .bold)).foregroundStyle(tint)
        }
    }
}

private struct TripRouteChip: View {
    let name: String
    let hex: String
    let size: CGFloat

    var body: some View {
        let fill = hex.isEmpty ? Tokens.neutralRoute : hex
        Text(name)
            .font(.geist(size, .bold))
            .foregroundStyle(RouteColors.text(onHex: fill))
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 5)
            .padding(.vertical, 1.5)
            .background(Color(hex: fill), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

// MARK: - Helpers

private func tripFinished(_ state: TripState) -> Bool { state.phase == "gone" }

/// Stops until yours, counting it (1 = it's next) - nil without a placed vehicle.
private func tripStopsAway(_ state: TripState) -> Int? {
    guard state.hasVehicle, let away = state.stopsAway, away >= 0 else { return nil }
    return away + 1
}

private func tripBigText(_ state: TripState) -> String {
    if state.phase == "cancelled" { return "—" }
    if state.phase == "next" { return "Next" }
    if let away = tripStopsAway(state) { return "\(away)" }
    return tripClock(state.targetDate)
}

private func tripModeSymbol(_ mode: String) -> String? {
    switch mode {
    case "bus": return "bus.fill"
    case "train": return "tram.fill"
    case "ferry": return "ferry.fill"
    default: return nil
    }
}

private let tripClockFormatter: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "h:mma"
    return f
}()

private func tripClock(_ date: Date) -> String {
    tripClockFormatter.string(from: date).lowercased()
}
