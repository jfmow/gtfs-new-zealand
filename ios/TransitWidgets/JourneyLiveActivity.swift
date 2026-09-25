import ActivityKit
import SwiftUI
import WidgetKit

// Journey Live Activity - Lock Screen + Dynamic Island.
//
// Built from the same pieces as the in-app tracker drawer's hero header
// (JourneyTrackingView.heroHeader / statusChips): a route-coloured tile,
// the instruction in Geist, a big minutes countdown with a caption, and
// status chips. Tokens are the app's Theme values (globals.css). One glance
// answers "what do I do now, and how long have I got"; the middle row
// changes with the phase to show the thing that matters most right then:
//
// - walking: the walk (minutes, distance), or the ride already on its way
// - waiting: the vehicle's approach, stop by stop, and the platform
// - on board: a stop track from where you got on to your stop
// - a connection coming: "Then 70 at 9:40 · 4 min to change"
// - arrived: the journey's legs as a recap

// MARK: - Tokens (Transit/DesignSystem/Theme.swift - the widget can't import the app)

private enum Tokens {
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

private extension Font {
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
                DynamicIslandExpandedRegion(.leading) {
                    HeroTile(state: state, size: 44)
                        .padding(.leading, 4)
                        .padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    CountdownBlock(state: state, isStale: stale, numberSize: 24, compact: true)
                        .padding(.trailing, 4)
                        .padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(state.primaryText)
                            .font(.geist(15, .semibold))
                            .lineLimit(2)
                            .minimumScaleFactor(0.85)
                        if let subtitle = subtitle(state) {
                            Text(subtitle)
                                .font(.geist(12))
                                .foregroundStyle(statusColor(state.status) ?? Tokens.mutedForeground)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    // No footer: the expanded island has room for one row.
                    PhaseRow(state: state)
                        .padding(.horizontal, 4)
                        .padding(.top, 6)
                }
            } compactLeading: {
                HStack(spacing: 4) {
                    Image(systemName: phaseSymbol(state))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(state.phase == "arrived" ? Tokens.success : .white)
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
            .keylineTint(state.routeColorHex.isEmpty ? Color.white : Color(hex: state.routeColorHex))
        }
    }
}

// MARK: - Lock Screen

private struct LockScreenView: View {
    let state: JourneyState
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 12) {
                HeroTile(state: state, size: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.primaryText)
                        .font(.geist(17, .semibold))
                        .foregroundStyle(Tokens.foreground)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                        .fixedSize(horizontal: false, vertical: true)
                    if let subtitle = subtitle(state) {
                        Text(subtitle)
                            .font(.geist(13))
                            .foregroundStyle(statusColor(state.status) ?? Tokens.mutedForeground)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if state.phase != "arrived" {
                    CountdownBlock(state: state, isStale: isStale, numberSize: 26)
                }
            }

            PhaseRow(state: state)

            if state.phase != "arrived" {
                StatusFooter(state: state, isStale: isStale)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

// MARK: - Hero

/// The tracker drawer's hero tile: the route's colour and name, a walker
/// while walking, a green tick once arrived.
private struct HeroTile: View {
    let state: JourneyState
    let size: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
        Group {
            if state.phase == "arrived" {
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.42, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(Tokens.success, in: shape)
            } else if state.phase == "walking" || state.routeShortName.isEmpty {
                Image(systemName: "figure.walk")
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(Tokens.foreground)
                    .frame(width: size, height: size)
                    .background(Tokens.muted, in: shape)
                    .overlay(shape.strokeBorder(Tokens.border, lineWidth: 1))
            } else {
                let hex = state.routeColorHex.isEmpty ? Tokens.neutralRoute : state.routeColorHex
                Text(state.routeShortName)
                    .font(.geist(size * 0.34, .bold))
                    .foregroundStyle(RouteColors.text(onHex: hex))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .padding(.horizontal, 3)
                    .frame(width: size, height: size)
                    .background(Color(hex: hex), in: shape)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Big number + caption, like the drawer's "4 min / to departure".
private struct CountdownBlock: View {
    let state: JourneyState
    let isStale: Bool
    let numberSize: CGFloat
    var compact = false

    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Countdown(state: state, isStale: isStale)
                .font(.geist(numberSize, .bold).monospacedDigit())
                .foregroundStyle(countdownColor)
                .multilineTextAlignment(.trailing)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(caption)
                .font(.geist(12))
                .foregroundStyle(Tokens.mutedForeground)
                .lineLimit(1)
        }
        .frame(minWidth: 64, maxWidth: compact ? 84 : 120, alignment: .trailing)
    }

    private var countdownColor: Color {
        switch state.status {
        case "cancelled", "missedConnection": return Tokens.danger
        case "arrived": return Tokens.success
        default:
            // Amber when it's close, like the drawer's urgent countdown.
            return state.targetDate.timeIntervalSinceNow < 120 ? Tokens.warning : Tokens.foreground
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
        case "Departs in": return "to departure"
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

// MARK: - Phase row

private struct PhaseRow: View {
    let state: JourneyState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch state.phase {
            case "arrived":
                LegChain(state: state)
            case "onboard":
                StopTrack(state: state)
            case "waiting", "boarding":
                ApproachRow(state: state)
            default:
                WalkRow(state: state)
            }
            if state.phase != "arrived", let next = state.nextLeg {
                ConnectionLine(next: next, status: state.status)
            }
        }
    }
}

/// On board: where you got on, how far along you are, and your stop.
private struct StopTrack: View {
    let state: JourneyState

    private var toGo: Int? { state.stopsAway.map { $0 + 1 } }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let total = state.rideStops, let toGo {
                let done = max(0, min(total, total - toGo))
                Track(total: total, done: done, colorHex: state.routeColorHex)
            } else {
                // No stop list: a plain line from your stop to theirs.
                Track(total: 1, done: 0, colorHex: state.routeColorHex)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(state.boardStopName ?? "")
                    .font(.geist(11))
                    .foregroundStyle(Tokens.mutedForeground)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let toGo {
                    Text(toGo == 1 ? "next stop" : "\(toGo) stops")
                        .font(.geist(11, .semibold).monospacedDigit())
                        .foregroundStyle(Tokens.foreground)
                    Text("·").font(.geist(11)).foregroundStyle(Tokens.mutedForeground)
                }
                Text(state.alightStopName ?? state.headsign)
                    .font(.geist(11, .semibold))
                    .foregroundStyle(Tokens.foreground)
                    .lineLimit(1)
            }
        }
    }
}

/// A stop-by-stop track: `done` of `total` stops passed, the rest ahead,
/// your stop a ring at the end. Many stops shrink to a continuous line.
private struct Track: View {
    let total: Int
    let done: Int
    let colorHex: String

    var body: some View {
        let color = colorHex.isEmpty ? Tokens.foreground : Color(hex: colorHex)
        GeometryReader { geo in
            let width = geo.size.width
            let fraction = total > 0 ? CGFloat(done) / CGFloat(total) : 0
            let x = max(6, min(width - 6, width * fraction))
            ZStack(alignment: .leading) {
                Capsule().fill(Tokens.border).frame(height: 4)
                Capsule().fill(color).frame(width: x, height: 4)
                // Stop ticks, when there are few enough to tell apart.
                if total > 1, total <= 14 {
                    ForEach(1..<total, id: \.self) { i in
                        Circle()
                            .fill(i <= done ? color : Tokens.mutedForeground.opacity(0.45))
                            .frame(width: 5, height: 5)
                            .position(x: width * CGFloat(i) / CGFloat(total), y: 6)
                    }
                }
                // You.
                Circle()
                    .fill(color)
                    .frame(width: 12, height: 12)
                    .overlay(Circle().strokeBorder(Tokens.card, lineWidth: 2))
                    .position(x: x, y: 6)
                // Your stop.
                Circle()
                    .strokeBorder(Tokens.foreground, lineWidth: 2.5)
                    .background(Circle().fill(Tokens.card))
                    .frame(width: 12, height: 12)
                    .position(x: width - 6, y: 6)
            }
        }
        .frame(height: 12)
    }
}

/// Waiting: the vehicle's approach (stops away) and the platform.
private struct ApproachRow: View {
    let state: JourneyState

    var body: some View {
        HStack(spacing: 10) {
            if let away = state.stopsAway, state.hasVehicle {
                VehicleApproach(stopsAway: away, colorHex: state.routeColorHex)
                Text(away == 0 ? "Arriving now" : away == 1 ? "1 stop away" : "\(away) stops away")
                    .font(.geist(12, .semibold).monospacedDigit())
                    .foregroundStyle(Tokens.foreground)
                    .lineLimit(1)
                    .layoutPriority(1)
            } else {
                Label {
                    Text(state.boardStopName ?? state.headsign).lineLimit(1)
                } icon: {
                    Image(systemName: "mappin.and.ellipse")
                }
                .font(.geist(12))
                .foregroundStyle(Tokens.mutedForeground)
            }
            Spacer(minLength: 4)
            if let platform = state.platform {
                PlatformChip(platform: platform)
            }
        }
    }
}

/// A vehicle dot sliding toward your stop: up to five stops between.
private struct VehicleApproach: View {
    let stopsAway: Int
    let colorHex: String

    var body: some View {
        let color = colorHex.isEmpty ? Tokens.foreground : Color(hex: colorHex)
        let shown = min(stopsAway, 5)
        HStack(spacing: 3) {
            Image(systemName: "bus.fill")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(RouteColors.text(onHex: colorHex.isEmpty ? Tokens.neutralRoute : colorHex))
                .frame(width: 16, height: 16)
                .background(color, in: Circle())
            ForEach(0..<shown, id: \.self) { _ in
                Capsule().fill(Tokens.mutedForeground.opacity(0.5)).frame(width: 8, height: 3)
            }
            if stopsAway > shown {
                Text("…").font(.geist(10)).foregroundStyle(Tokens.mutedForeground)
            }
            Circle()
                .strokeBorder(Tokens.foreground, lineWidth: 2.5)
                .frame(width: 11, height: 11)
        }
        .accessibilityHidden(true)
    }
}

/// Walking: to your ride (or the ride coming toward you) - or to the
/// destination.
private struct WalkRow: View {
    let state: JourneyState

    var body: some View {
        HStack(spacing: 10) {
            if let away = state.stopsAway, state.hasVehicle, !state.routeShortName.isEmpty {
                VehicleApproach(stopsAway: away, colorHex: state.routeColorHex)
                Text(away == 0 ? "\(state.routeShortName) arriving" : "\(state.routeShortName) \(away == 1 ? "1 stop" : "\(away) stops") away")
                    .font(.geist(12, .semibold).monospacedDigit())
                    .foregroundStyle(Tokens.foreground)
                    .lineLimit(1)
                    .layoutPriority(1)
            } else {
                Image(systemName: "figure.walk")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Tokens.mutedForeground)
                Text(walkText)
                    .font(.geist(12))
                    .foregroundStyle(Tokens.mutedForeground)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            if let platform = state.platform {
                PlatformChip(platform: platform)
            }
        }
    }

    private var walkText: String {
        var parts: [String] = []
        if let minutes = state.walkMinutes { parts.append("\(minutes) min walk") }
        if let meters = state.walkMeters {
            parts.append(meters >= 1000 ? String(format: "%.1f km", Double(meters) / 1000) : "\(meters) m")
        }
        return parts.isEmpty ? "Walk to \(state.headsign)" : parts.joined(separator: " · ")
    }
}

private struct PlatformChip: View {
    let platform: String

    var body: some View {
        HStack(spacing: 3) {
            Text("Platform").font(.geist(11)).foregroundStyle(Tokens.mutedForeground)
            Text(platform).font(.geist(13, .bold)).foregroundStyle(Tokens.foreground)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Tokens.muted, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Tokens.border, lineWidth: 1))
    }
}

/// "Then [70] at 9:40 · 4 min to change" - amber when tight, red when
/// it's likely missed.
private struct ConnectionLine: View {
    let next: JourneyState.NextLeg
    let status: String

    var body: some View {
        let color: Color = status == "missedConnection" ? Tokens.danger : status == "tightConnection" ? Tokens.warning : Tokens.mutedForeground
        HStack(spacing: 5) {
            Image(systemName: status == "missedConnection" ? "exclamationmark.triangle.fill" : "arrow.turn.down.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(color)
            Text("Then").font(.geist(12)).foregroundStyle(Tokens.mutedForeground)
            RouteChip(name: next.routeShortName, hex: next.routeColorHex, size: 11)
            Text("at \(clock(Date(timeIntervalSince1970: next.departureUnix)))")
                .font(.geist(12).monospacedDigit())
                .foregroundStyle(Tokens.mutedForeground)
            Text("·").font(.geist(12)).foregroundStyle(Tokens.mutedForeground)
            Text(status == "missedConnection" ? "likely missed" : "\(max(0, next.connectMinutes)) min to change")
                .font(.geist(12, status == "onTime" ? .regular : .semibold))
                .foregroundStyle(color)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.85)
    }
}

// MARK: - Footer

/// Live / Scheduled / Updating chip, delay, occupancy - and arrival time.
private struct StatusFooter: View {
    let state: JourneyState
    let isStale: Bool

    var body: some View {
        HStack(spacing: 6) {
            if state.phase == "arrived" {
                Chip { Text("Journey complete") }
            } else {
                trackingChip
                if state.status == "cancelled" {
                    Chip(tint: Tokens.danger) { Text("Cancelled") }
                } else if state.delayMinutes >= 2 {
                    Chip(tint: Tokens.warning) { Text("\(state.delayMinutes) min late") }
                } else if state.delayMinutes <= -2 {
                    Chip(tint: Tokens.success) { Text("\(-state.delayMinutes) min early") }
                }
                if let occupancy = state.occupancy, let label = occupancyLabel(occupancy) {
                    Chip {
                        HStack(spacing: 3) {
                            OccupancyIcons(occupancy: occupancy)
                            Text(label)
                        }
                    }
                }
            }
            Spacer(minLength: 6)
            Text("Arrive \(clock(state.arrivalDate))")
                .font(.geist(12, .medium).monospacedDigit())
                .foregroundStyle(Tokens.mutedForeground)
                .lineLimit(1)
                .layoutPriority(1)
        }
    }

    @ViewBuilder private var trackingChip: some View {
        if state.offline && !isStale {
            // The app is still updating this from GPS and the timetable -
            // not stale, just not live.
            Chip {
                HStack(spacing: 4) {
                    Image(systemName: "wifi.slash").font(.system(size: 9, weight: .semibold))
                    Text(state.hasVehicle ? "Offline · GPS" : "Offline")
                }
            }
        } else if isStale {
            Chip {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 9, weight: .semibold))
                    Text("Updated \(clock(state.updatedDate))")
                }
            }
        } else if state.hasVehicle || state.isRealtime {
            Chip {
                HStack(spacing: 4) {
                    Circle().fill(Tokens.success).frame(width: 6, height: 6)
                    Text("Live")
                }
            }
        } else {
            Chip {
                HStack(spacing: 4) {
                    Image(systemName: "calendar").font(.system(size: 9, weight: .semibold))
                    Text("Timetable")
                }
            }
        }
    }

    private func occupancyLabel(_ value: Int) -> String? {
        switch value {
        case 0, 1: return "Seats free"
        case 2: return "Filling up"
        case 3: return "Standing room"
        case 4: return "Likely full"
        default: return nil
        }
    }
}

/// The app's StatusChipStyle: small, muted, bordered.
private struct Chip<Content: View>: View {
    var tint: Color? = nil
    @ViewBuilder let content: Content

    var body: some View {
        content
            .font(.geist(11, tint == nil ? .medium : .semibold))
            .foregroundStyle(tint ?? Tokens.foreground)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background((tint ?? Tokens.muted).opacity(tint == nil ? 1 : 0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(tint == nil ? Tokens.border : .clear, lineWidth: 1))
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
                    .foregroundStyle(i < filled ? Tokens.foreground : Tokens.mutedForeground.opacity(0.35))
            }
        }
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
                    RouteChip(name: chip.shortName, hex: chip.colorHex, size: 11)
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
            .padding(.horizontal, 5)
            .padding(.vertical, 1.5)
            .background(Color(hex: fill), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
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
        .foregroundStyle(statusColor(state.status) ?? .white)
        .opacity(isStale ? 0.6 : 1)
    }
}

/// A ring counting down to the moment that matters, round the phase glyph.
private struct MinimalRing: View {
    let state: JourneyState

    var body: some View {
        let tint = state.routeColorHex.isEmpty ? Color.white : Color(hex: state.routeColorHex)
        if state.phase == "arrived" {
            Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Tokens.success)
        } else if state.targetDate > state.updatedDate {
            ProgressView(timerInterval: state.updatedDate...state.targetDate, countsDown: true) {
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

/// The line under the instruction. The server's `secondaryText` repeats
/// what the phase row now draws (stops away, platform, the connection), so
/// with structured data the widget says the one thing that row doesn't.
private func subtitle(_ state: JourneyState) -> String? {
    switch state.phase {
    case "arrived":
        return "Arrived \(clock(state.arrivalDate))"
    case "onboard":
        if state.hasVehicle, let next = state.nextStopName, !next.isEmpty, state.stopsAway != 0 { return "Next stop: \(next)" }
        if state.boardStopName != nil, state.stopsAway != 0 { return "Due \(clock(state.targetDate))" }
    case "waiting", "boarding":
        if let board = state.boardStopName { return "at \(board)" }
    default:
        break
    }
    return state.secondaryText.isEmpty ? nil : state.secondaryText
}

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
    case "walking": return "figure.walk"
    case "waiting": return "clock"
    case "boarding": return "bell.fill"
    default: return "tram.fill"
    }
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

private extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let v = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
        })
    }
}
