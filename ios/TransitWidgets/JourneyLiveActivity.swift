import ActivityKit
import SwiftUI
import WidgetKit

// Journey Live Activity - Lock Screen + Dynamic Island.
//
// Three rows: a route tile (vehicle + name in the route's colour), the
// instruction with one line of detail, and a big countdown; then one bar
// for the phase; then one status line. Tokens are the app's Theme values.
// The bar shows what matters most right then:
//
// - walking: time left to leave / reach the stop, draining live
// - waiting: the vehicle sliding in toward your stop
// - on board: stops ridden, from where you got on to your stop
// - arrived: the journey's legs as a recap
//
// Every text is line-limited so long stop names truncate rather than push
// the Lock Screen card past its height cap (it overflowed before).

// MARK: - Tokens (Transit/DesignSystem/Theme.swift - the widget can't import the app)

enum Tokens {
    static let card = Color(light: 0xFFFFFF, dark: 0x1F1F1F)
    static let foreground = Color(light: 0x0A0A0A, dark: 0xF5F5F5)
    static let mutedForeground = Color(light: 0x737373, dark: 0xA3A3A3)
    static let muted = Color(light: 0xF5F5F5, dark: 0x2B2B2B)
    static let border = Color(light: 0xE5E5E5, dark: 0x2E2E2E)
    static let warning = Color(light: 0xD97706, dark: 0xF59E0B)
    static let danger = Color(light: 0xDC2626, dark: 0xF87171)
    static let success = Color(light: 0x16A34A, dark: 0x4ADE80)
    static let live = Color(light: 0x2563EB, dark: 0x60A5FA)
    static let neutralRoute = "525252"
}

extension Font {
    enum GeistWeight: String { case regular = "Geist-Regular", medium = "Geist-Medium", semibold = "Geist-SemiBold", bold = "Geist-Bold" }
    static func geist(_ size: CGFloat, _ weight: GeistWeight = .regular) -> Font { .custom(weight.rawValue, size: size) }
}

typealias JourneyState = JourneyActivityAttributes.ContentState

// MARK: - Widget

struct JourneyLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: JourneyActivityAttributes.self) { context in
            LockScreenView(state: context.state, isStale: context.isStale)
                .activityBackgroundTint(Tokens.card)
                .activitySystemActionForegroundColor(Tokens.foreground)
                .widgetURL(context.attributes.journeyURL)
        } dynamicIsland: { context in
            let state = context.state
            let stale = context.isStale
            return DynamicIsland {
                // Beside the camera: how live it is, and where it ends. The
                // main row sits in the bottom region so tile, instruction
                // and countdown line up (the centre region starts lower
                // than the sides).
                DynamicIslandExpandedRegion(.leading) {
                    // Narrow beside the camera: the delay goes first.
                    ViewThatFits(in: .horizontal) {
                        FooterLine.Status(state: state, isStale: stale, showsOccupancy: false)
                        FooterLine.Status(state: state, isStale: stale, showsOccupancy: false, showsDelay: false)
                    }
                    .font(.geist(12, .medium))
                        .padding(.leading, 8)
                        .padding(.top, 2)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ViewThatFits(in: .horizontal) {
                        FooterLine.Trailing(state: state)
                        FooterLine.Trailing(state: state, showsThen: false)
                    }
                    .font(.geist(12, .medium))
                        .padding(.trailing, 8)
                        .padding(.top, 2)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 12) {
                        HStack(alignment: .center, spacing: 12) {
                            HeroTile(state: state, size: 44)
                            Headline(state: state, titleSize: 15, onDark: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if state.phase != "arrived" {
                                CountdownBlock(state: state, isStale: stale, numberSize: 26)
                            }
                        }
                        PhaseBar(state: state, onDark: true)
                    }
                    .padding(.horizontal, 6)
                    .padding(.top, 4)
                }
            } compactLeading: {
                HStack(spacing: 4) {
                    Image(systemName: phaseSymbol(state))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(state.phase == "arrived" ? Tokens.success : state.urgent ? Tokens.warning : .white)
                    if state.phase != "arrived", !state.routeShortName.isEmpty {
                        RouteChip(name: state.routeShortName, hex: state.routeColorHex, size: 11)
                    }
                }
                .padding(.leading, 2)
            } compactTrailing: {
                CompactHeadline(state: state, isStale: stale)
                    .padding(.trailing, 2)
            } minimal: {
                MinimalRing(state: state)
            }
            .widgetURL(context.attributes.journeyURL)
            .keylineTint(state.urgent ? Tokens.warning : state.routeColorHex.isEmpty ? Color.white : Color(hex: state.routeColorHex))
        }
    }
}

// MARK: - Lock Screen

/// Three rows, sized to stay inside the Lock Screen's ~160pt cap whatever
/// the names: headline + countdown, the phase's progress bar, one status
/// line. Every text is line-limited, so long stop names truncate instead of
/// pushing the card past its height.
private struct LockScreenView: View {
    let state: JourneyState
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                HeroTile(state: state, size: 46)
                Headline(state: state, titleSize: 17, onDark: false)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if state.phase != "arrived" {
                    CountdownBlock(state: state, isStale: isStale, numberSize: 30)
                }
            }
            PhaseBar(state: state, onDark: false)
            if state.phase != "arrived" {
                FooterLine(state: state, isStale: isStale)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

// MARK: - Headline

/// What to do now, and the one fact that goes with it.
private struct Headline: View {
    let state: JourneyState
    let titleSize: CGFloat
    let onDark: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(state.primaryText)
                .font(.geist(titleSize, .semibold))
                .foregroundStyle(state.urgent ? Tokens.warning : onDark ? Color.white : Tokens.foreground)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            if let detail = detailLine(state) {
                Text(detail)
                    .font(.geist(titleSize - 3))
                    .foregroundStyle(statusColor(state.status) ?? Tokens.mutedForeground)
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - Hero

/// The route's colour with its vehicle and name; a walker while walking
/// (amber when it's time to go), a tick once arrived.
private struct HeroTile: View {
    let state: JourneyState
    let size: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
        Group {
            if state.phase == "arrived" {
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.4, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(Tokens.success, in: shape)
            } else if state.phase == "walking" || state.routeShortName.isEmpty {
                Image(systemName: state.urgent ? "figure.walk.departure" : "figure.walk")
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(state.urgent ? Color.black : Tokens.foreground)
                    .frame(width: size, height: size)
                    .background(state.urgent ? Tokens.warning : Tokens.muted, in: shape)
            } else {
                let hex = state.routeColorHex.isEmpty ? Tokens.neutralRoute : state.routeColorHex
                VStack(spacing: 1) {
                    if let symbol = vehicleSymbol(state) {
                        Image(systemName: symbol)
                            .font(.system(size: size * 0.28, weight: .semibold))
                    }
                    Text(state.routeShortName)
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

/// Big countdown + a short caption ("to leave", "departs", "to your stop").
private struct CountdownBlock: View {
    let state: JourneyState
    let isStale: Bool
    let numberSize: CGFloat

    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Countdown(state: state, isStale: isStale)
                .font(.geist(numberSize, .bold).monospacedDigit())
                .foregroundStyle(countdownColor)
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

    private var countdownColor: Color {
        switch state.status {
        case "cancelled", "missedConnection": return Tokens.danger
        case "arrived": return Tokens.success
        default:
            // Amber when it's close, like the drawer's urgent countdown.
            return state.urgent || state.targetDate.timeIntervalSinceNow < 120 ? Tokens.warning : Tokens.foreground
        }
    }

    private var caption: String {
        switch state.status {
        case "arrived": return "arrived"
        case "cancelled": return "cancelled"
        default: break
        }
        switch state.countdownLabel {
        case "Leave in": return "to leave"
        case "Departs in": return "departs"
        case "Arrives in": return "to your stop"
        case "Arrive in": return "to arrive"
        default: return state.countdownLabel.lowercased()
        }
    }
}

/// A "6:04" timer counted down by the system, "Now" once the target has
/// passed at render time.
private struct Countdown: View {
    let state: JourneyState
    let isStale: Bool

    var body: some View {
        if state.status == "arrived" {
            Text(clock(state.arrivalDate))
        } else if state.status == "cancelled" {
            Text("—")
        } else if state.targetDate <= Date() {
            Text("Now")
        } else {
            MinutesText(target: state.targetDate)
        }
    }
}

/// The countdown, kept up to date by the system between pushes. It has to
/// be a timer that stops at 0:00: the widget isn't redrawn when the target
/// passes, and the iOS 18 `.offset(to:)` "6 minutes" format has no floor -
/// with `sign: .never` it went back up ("1 minute", "2 minutes", ...) once
/// the bus was due and no update had arrived.
private struct MinutesText: View {
    let target: Date

    var body: some View {
        Text(timerInterval: Date()...target, countsDown: true, showsHours: false)
    }
}

// MARK: - Phase bar

/// One bar, whatever the phase: stops ridden on board, the vehicle closing
/// in while you wait, time running down while you walk, the legs once
/// you've arrived.
private struct PhaseBar: View {
    let state: JourneyState
    let onDark: Bool

    private var color: Color {
        if state.urgent { return Tokens.warning }
        return state.routeColorHex.isEmpty ? (onDark ? .white : Tokens.foreground) : Color(hex: state.routeColorHex)
    }

    var body: some View {
        switch state.phase {
        case "arrived":
            LegChain(state: state)
                .frame(maxWidth: .infinity, alignment: .leading)
        case "onboard":
            let total = max(1, state.rideStops ?? 1)
            let toGo = state.stopsAway.map { $0 + 1 } ?? total
            KnobTrack(fraction: Double(max(0, total - toGo)) / Double(total), ticks: total <= 14 ? total : 0,
                      color: color, symbol: vehicleSymbol(state), onDark: onDark)
        case "waiting", "boarding":
            if let away = state.stopsAway, state.hasVehicle {
                // Up to eight stops out, the vehicle slides in toward you.
                let window = 8.0
                KnobTrack(fraction: 1 - min(Double(away), window) / window, ticks: 0,
                          color: color, symbol: vehicleSymbol(state), onDark: onDark)
            } else {
                TimeBar(state: state, color: color, onDark: onDark)
            }
        default:
            TimeBar(state: state, color: color, onDark: onDark)
        }
    }
}

/// A thick bar with a knob - the vehicle - at `fraction`, and your stop as
/// a ring at the end.
private struct KnobTrack: View {
    let fraction: Double
    let ticks: Int
    let color: Color
    /// The vehicle's glyph; a plain dot when the mode isn't known.
    let symbol: String?
    let onDark: Bool

    var body: some View {
        let ground = onDark ? Color.white.opacity(0.18) : Tokens.border
        let background = onDark ? Color.black : Tokens.card
        GeometryReader { geo in
            let width = geo.size.width
            let x = max(9, min(width - 9, width * fraction))
            ZStack(alignment: .leading) {
                Capsule().fill(ground).frame(height: 6)
                Capsule().fill(color).frame(width: x, height: 6)
                if ticks > 1 {
                    ForEach(1..<ticks, id: \.self) { i in
                        let tx = width * CGFloat(i) / CGFloat(ticks)
                        Circle()
                            .fill(tx <= x ? background.opacity(0.7) : Tokens.mutedForeground.opacity(0.5))
                            .frame(width: 3, height: 3)
                            .position(x: tx, y: 9)
                    }
                }
                Circle()
                    .strokeBorder(onDark ? Color.white : Tokens.foreground, lineWidth: 2.5)
                    .background(Circle().fill(background))
                    .frame(width: 12, height: 12)
                    .position(x: width - 6, y: 9)
                Image(systemName: symbol ?? "circle.fill")
                    .font(.system(size: symbol == nil ? 5 : 8, weight: .bold))
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

/// Time left in this segment - the walk or the wait - drained live by the
/// system between updates.
private struct TimeBar: View {
    let state: JourneyState
    let color: Color
    let onDark: Bool

    private var interval: ClosedRange<Date> {
        let start = state.segmentStartUnix, end = state.segmentEndUnix
        if start > 0, end > start {
            return Date(timeIntervalSince1970: start)...Date(timeIntervalSince1970: end)
        }
        let target = state.targetDate
        return min(Date(), target.addingTimeInterval(-600))...target
    }

    var body: some View {
        ProgressView(timerInterval: interval, countsDown: true) {
            EmptyView()
        } currentValueLabel: {
            EmptyView()
        }
        .progressViewStyle(.linear)
        .tint(color)
        .scaleEffect(x: 1, y: 1.5, anchor: .center)
        .frame(height: 10)
        .accessibilityHidden(true)
    }
}

// MARK: - Footer

/// One line: how live the times are, any delay, how full - then the
/// connection if there is one, otherwise the arrival time. Occupancy drops
/// off first when it's too narrow.
private struct FooterLine: View {
    let state: JourneyState
    let isStale: Bool

    var body: some View {
        HStack(spacing: 10) {
            ViewThatFits(in: .horizontal) {
                Status(state: state, isStale: isStale, showsOccupancy: true)
                Status(state: state, isStale: isStale, showsOccupancy: false)
            }
            Spacer(minLength: 6)
            Trailing(state: state).layoutPriority(1)
        }
        .font(.geist(12, .medium))
        .lineLimit(1)
    }

    /// Live / Timetable / Offline / Updated, then any delay and occupancy.
    struct Status: View {
        let state: JourneyState
        let isStale: Bool
        let showsOccupancy: Bool
        var showsDelay = true

        var body: some View {
            HStack(spacing: 10) {
                tracking
                if !showsDelay {
                    EmptyView()
                } else if state.status == "cancelled" {
                    Text("Cancelled").foregroundStyle(Tokens.danger)
                } else if state.delayMinutes >= 2 {
                    Text("\(state.delayMinutes) min late").foregroundStyle(Tokens.warning)
                } else if state.delayMinutes <= -2 {
                    Text("\(-state.delayMinutes) min early").foregroundStyle(Tokens.success)
                }
                if showsOccupancy, let occupancy = state.occupancy, occupancy >= 0, occupancy <= 4 {
                    OccupancyIcons(occupancy: occupancy)
                }
            }
            .lineLimit(1)
            .fixedSize()
        }

        @ViewBuilder private var tracking: some View {
            HStack(spacing: 5) {
                if state.phase == "arrived" {
                    EmptyView()
                } else if state.offline && !isStale {
                    // Still updating from GPS and the timetable - not
                    // stale, just not live.
                    Image(systemName: "wifi.slash").font(.system(size: 9, weight: .semibold))
                    Text("Offline")
                } else if isStale {
                    Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 9, weight: .semibold))
                    Text("Updated \(clock(state.updatedDate))")
                } else if state.hasVehicle || state.isRealtime {
                    Circle().fill(Tokens.success).frame(width: 6, height: 6)
                    Text("Live")
                } else {
                    Image(systemName: "calendar").font(.system(size: 9, weight: .semibold))
                    Text("Timetable")
                }
            }
            .foregroundStyle(Tokens.mutedForeground)
        }
    }

    /// "Then [70] 9:49am" when there's a connection, else "Arrive 10:18am".
    struct Trailing: View {
        let state: JourneyState
        var showsThen = true

        var body: some View {
            Group {
                if state.phase == "arrived" {
                    EmptyView()
                } else if let next = state.nextLeg {
                    let color: Color = state.status == "missedConnection" ? Tokens.danger : state.status == "tightConnection" ? Tokens.warning : Tokens.mutedForeground
                    HStack(spacing: 5) {
                        if showsThen { Text("Then").foregroundStyle(Tokens.mutedForeground) }
                        RouteChip(name: next.routeShortName, hex: next.routeColorHex, size: 11)
                        Text(state.status == "missedConnection" ? "likely missed" : clock(Date(timeIntervalSince1970: next.departureUnix)))
                            .monospacedDigit()
                            .foregroundStyle(color)
                    }
                } else {
                    Text("Arrive \(clock(state.arrivalDate))")
                        .monospacedDigit()
                        .foregroundStyle(Tokens.mutedForeground)
                }
            }
            .lineLimit(1)
            .fixedSize()
        }
    }
}

private struct OccupancyIcons: View {
    let occupancy: Int

    var body: some View {
        let filled = occupancy <= 1 ? 1 : occupancy == 2 ? 2 : 3
        HStack(spacing: 1) {
            ForEach(0..<3, id: \.self) { i in
                Image(systemName: "person.fill")
                    .font(.system(size: 8))
                    .foregroundStyle(i < filled ? (occupancy >= 3 ? Tokens.warning : Tokens.mutedForeground) : Tokens.mutedForeground.opacity(0.3))
            }
        }
        .accessibilityLabel(occupancy <= 1 ? "Seats free" : occupancy == 2 ? "Filling up" : occupancy == 3 ? "Standing room" : "Likely full")
    }
}

// MARK: - Leg chain (arrived recap)

private struct LegChain: View {
    let state: JourneyState

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(state.legChain.enumerated()), id: \.offset) { index, chip in
                if index > 0 {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 7, weight: .semibold))
                        .foregroundStyle(Tokens.mutedForeground)
                }
                if chip.mode == "walk" {
                    Image(systemName: "figure.walk")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Tokens.mutedForeground)
                } else {
                    HStack(spacing: 3) {
                        if let symbol = modeSymbol(chip.mode) {
                            Image(systemName: symbol)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(Tokens.mutedForeground)
                        }
                        RouteChip(name: chip.shortName, hex: chip.colorHex, size: 11)
                    }
                }
            }
        }
    }
}

private struct RouteChip: View {
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

/// The line under the instruction - the one fact that goes with it, in a
/// single line (the platform rides here rather than in its own chip).
private func detailLine(_ state: JourneyState) -> String? {
    let platform = state.platform.map { "Platform \($0)" }
    switch state.phase {
    case "arrived":
        return "Arrived \(clock(state.arrivalDate))"
    case "onboard":
        let toGo = state.stopsAway.map { $0 + 1 }
        let stops = toGo.map { $0 == 1 ? "next stop" : "\($0) stops" }
        if state.hasVehicle, let next = state.nextStopName, !next.isEmpty, state.stopsAway != 0 {
            // The count first - the name truncates, the count shouldn't.
            return [stops, "next \(next)"].compactMap { $0 }.joined(separator: " · ")
        }
        return stops ?? (state.secondaryText.isEmpty ? nil : state.secondaryText)
    case "waiting", "boarding":
        let approach: String? = state.hasVehicle ? state.stopsAway.map { $0 == 0 ? "Arriving now" : $0 == 1 ? "1 stop away" : "\($0) stops away" } : state.boardStopName.map { "at \($0)" }
        let parts = [approach, platform].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    default:
        if let away = state.stopsAway, state.hasVehicle, !state.routeShortName.isEmpty {
            return away == 0 ? "\(state.routeShortName) arriving" : "\(state.routeShortName) \(away == 1 ? "1 stop" : "\(away) stops") away"
        }
        var parts: [String] = []
        if let minutes = state.walkMinutes { parts.append("\(minutes) min walk") }
        if let platform {
            parts.append(platform)
        } else if let meters = state.walkMeters {
            parts.append(meters >= 1000 ? String(format: "%.1f km", Double(meters) / 1000) : "\(meters) m")
        }
        if parts.isEmpty { return state.secondaryText.isEmpty ? nil : state.secondaryText }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Dynamic Island compact/minimal

/// The phase's headline, short enough for the compact island: stops left
/// while riding (the number that matters on board), minutes otherwise.
private struct CompactHeadline: View {
    let state: JourneyState
    let isStale: Bool

    var body: some View {
        Group {
            if state.phase == "arrived" {
                Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Tokens.success)
            } else if isLeaveNow(state) {
                Text("Leave").font(.geist(13, .bold)).foregroundStyle(Tokens.warning)
            } else if state.phase == "onboard", let away = state.stopsAway, state.hasVehicle {
                Text(away == 0 ? "Next" : "\(away + 1) stops")
                    .font(.geist(13, .bold).monospacedDigit())
            } else if state.targetDate > Date() {
                MinutesText(target: state.targetDate)
                    .font(.geist(13, .bold).monospacedDigit())
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 52)
            } else {
                Text("Now").font(.geist(13, .bold))
            }
        }
        .foregroundStyle(statusColor(state.status) ?? (state.urgent ? Tokens.warning : .white))
        .opacity(isStale ? 0.6 : 1)
    }
}

/// A ring counting down to the moment that matters, round the phase glyph.
/// It drains across the current segment - the walk, the wait at the stop,
/// or the ride - then the next one starts full. Never from `updatedDate`:
/// every content update moves that to now, which restarted the ring from
/// full each time the island was expanded.
private struct MinimalRing: View {
    let state: JourneyState

    /// With no segment (e.g. "Leave by"): full until this long before the
    /// countdown target, empty at it.
    private static let fallbackWindow: TimeInterval = 10 * 60

    private var ringInterval: ClosedRange<Date> {
        let start = state.segmentStartUnix, end = state.segmentEndUnix
        if start > 0, end > start {
            return Date(timeIntervalSince1970: start)...Date(timeIntervalSince1970: end)
        }
        return state.targetDate.addingTimeInterval(-Self.fallbackWindow)...state.targetDate
    }

    var body: some View {
        let tint = state.routeColorHex.isEmpty ? Color.white : Color(hex: state.routeColorHex)
        if state.phase == "arrived" {
            Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Tokens.success)
        } else if state.segmentEndUnix > 0 || state.targetDate > state.updatedDate {
            // A segment that's run over stays an empty ring until the next
            // update moves on to the next segment.
            ProgressView(timerInterval: ringInterval, countsDown: true) {
                EmptyView()
            } currentValueLabel: {
                Image(systemName: phaseSymbol(state)).font(.system(size: 9, weight: .bold))
            }
            .progressViewStyle(.circular)
            .tint(tint)
        } else {
            Image(systemName: phaseSymbol(state)).font(.system(size: 11, weight: .bold)).foregroundStyle(tint)
        }
    }
}

// MARK: - Helpers

private let clockFormatter: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "h:mma"
    return f
}()

/// "9:05am", like the rest of the app.
private func clock(_ date: Date) -> String {
    clockFormatter.string(from: date).lowercased()
}

private func phaseSymbol(_ state: JourneyState) -> String {
    switch state.phase {
    case "arrived": return "checkmark"
    case "walking": return state.urgent ? "figure.walk.departure" : "figure.walk"
    // Waiting or boarding: the vehicle you're waiting for, when known.
    case "waiting": return vehicleSymbol(state) ?? "clock"
    case "boarding": return vehicleSymbol(state) ?? "bell.fill"
    default: return vehicleSymbol(state) ?? "arrow.triangle.turn.up.right.circle.fill"
    }
}

/// The ride's vehicle - matches `TravelMode.systemImage` in the app. Nil
/// when the mode isn't known, rather than guessing a bus for a train.
private func vehicleSymbol(_ state: JourneyState) -> String? {
    modeSymbol(state.vehicleMode)
}

private func modeSymbol(_ mode: String) -> String? {
    switch mode {
    case "bus": return "bus.fill"
    case "train": return "tram.fill"
    case "ferry": return "ferry.fill"
    default: return nil
    }
}

/// The "Leave now" window: urgent, and already counting down to the ride
/// rather than to the leave time.
private func isLeaveNow(_ state: JourneyState) -> Bool {
    state.urgent && state.phase == "walking" && state.countdownLabel == "Departs in"
}

/// Colour only where it means something - nil keeps the neutral default.
private func statusColor(_ status: String) -> Color? {
    switch status {
    case "delayed", "tightConnection": return Tokens.warning
    case "cancelled", "missedConnection": return Tokens.danger
    case "arrived": return Tokens.success
    default: return nil
    }
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let v = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
        })
    }
}
