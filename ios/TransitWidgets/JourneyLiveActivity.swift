import ActivityKit
import SwiftUI
import WidgetKit

// Journey Live Activity - Lock Screen + Dynamic Island.
//
// Same visual language as the app and the web: neutral card surface, colour
// only where it means something (the route badge, a delay/connection
// status), tabular numbers for times. One glance should answer "what do I do
// next, and how long have I got": the instruction on the left, the
// countdown on the right, the journey's legs underneath.

private enum Palette {
    static let card = Color(light: 0xFFFFFF, dark: 0x1F1F1F)
    static let foreground = Color(light: 0x0A0A0A, dark: 0xF5F5F5)
    static let muted = Color(light: 0x737373, dark: 0xA3A3A3)
    static let border = Color(light: 0xE5E5E5, dark: 0x2E2E2E)
    static let amber = Color(light: 0xB45309, dark: 0xF59E0B)
    static let red = Color(light: 0xDC2626, dark: 0xF87171)
    static let green = Color(light: 0x15803D, dark: 0x4ADE80)
}

struct JourneyLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: JourneyActivityAttributes.self) { context in
            LockScreenView(attributes: context.attributes, state: context.state, isStale: context.isStale)
                .activityBackgroundTint(Palette.card)
                .activitySystemActionForegroundColor(Palette.foreground)
                .widgetURL(context.attributes.journeyURL)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    RouteBadge(state: state, size: .regular)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 0) {
                        Countdown(state: state, isStale: context.isStale)
                            .font(.system(size: 22, weight: .semibold).monospacedDigit())
                            .foregroundStyle(statusColor(state.status, fallback: .white))
                        Text(state.countdownLabel.lowercased())
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(state.primaryText)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(state.secondaryText)
                            .font(.caption)
                            .foregroundStyle(statusColor(state.status, fallback: .secondary))
                            .lineLimit(1)
                        LegChain(state: state, onDark: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                RouteBadge(state: state, size: .compact)
            } compactTrailing: {
                Countdown(state: state, isStale: context.isStale)
                    .font(.system(size: 14, weight: .semibold).monospacedDigit())
                    .foregroundStyle(statusColor(state.status, fallback: .white))
                    .frame(maxWidth: 52)
            } minimal: {
                RouteBadge(state: state, size: .compact)
            }
            .widgetURL(context.attributes.journeyURL)
            .keylineTint(state.routeColorHex.isEmpty ? .white : Color(hex: state.routeColorHex))
        }
    }
}

// MARK: - Lock Screen

private struct LockScreenView: View {
    let attributes: JourneyActivityAttributes
    let state: JourneyActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                RouteBadge(state: state, size: .regular)

                VStack(alignment: .leading, spacing: 3) {
                    Text(state.primaryText)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(state.secondaryText)
                        .font(.system(size: 13))
                        .foregroundStyle(statusColor(state.status, fallback: Palette.muted))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                VStack(alignment: .trailing, spacing: 1) {
                    Countdown(state: state, isStale: isStale)
                        .font(.system(size: 24, weight: .semibold).monospacedDigit())
                        .foregroundStyle(statusColor(state.status, fallback: Palette.foreground))
                        .multilineTextAlignment(.trailing)
                        .frame(minWidth: 64, alignment: .trailing)
                    Text(isStale ? "updating…" : state.countdownLabel.lowercased())
                        .font(.system(size: 11))
                        .foregroundStyle(Palette.muted)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                ProgressBar(fraction: state.progressFraction, colorHex: state.routeColorHex)
                HStack(spacing: 8) {
                    LegChain(state: state, onDark: false)
                    Spacer(minLength: 8)
                    Text("Arrive \(state.arrivalDate, style: .time)")
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                }
            }
        }
        .padding(16)
        .opacity(isStale ? 0.7 : 1)
    }
}

// MARK: - Pieces

private struct RouteBadge: View {
    enum Size { case compact, regular }
    let state: JourneyActivityAttributes.ContentState
    let size: Size

    var body: some View {
        let compact = size == .compact
        Group {
            if state.phase == "arrived" {
                Image(systemName: "checkmark")
                    .font(.system(size: compact ? 11 : 15, weight: .bold))
            } else if state.phase == "walking" {
                // Walking to a ride: walker glyph, tinted with the ride's colour.
                Image(systemName: "figure.walk")
                    .font(.system(size: compact ? 11 : 16, weight: .semibold))
            } else {
                Text(state.routeShortName)
                    .font(.system(size: compact ? 10 : 13, weight: .bold))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .padding(.horizontal, 2)
            }
        }
        .foregroundStyle(state.phase == "arrived" || state.routeColorHex.isEmpty ? .white : RouteColors.text(onHex: state.routeColorHex))
        .frame(width: compact ? 22 : 38, height: compact ? 22 : 38)
        .background(badgeColor, in: RoundedRectangle(cornerRadius: compact ? 6 : 8, style: .continuous))
    }

    private var badgeColor: Color {
        if state.phase == "arrived" { return Palette.green }
        if state.routeColorHex.isEmpty { return Color(light: 0x525252, dark: 0x525252) }
        return Color(hex: state.routeColorHex)
    }
}

/// Counts down locally between pushes; shows "Now" once the moment's here.
private struct Countdown: View {
    let state: JourneyActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        if state.status == "arrived" {
            Text("Done")
        } else if state.status == "cancelled" {
            Text("—")
        } else if state.targetDate > Date() {
            Text(timerInterval: Date()...state.targetDate, countsDown: true, showsHours: false)
        } else {
            Text("Now")
        }
    }
}

private struct ProgressBar: View {
    let fraction: Double
    let colorHex: String

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.border)
                Capsule()
                    .fill(colorHex.isEmpty ? Palette.foreground : Color(hex: colorHex))
                    .frame(width: max(4, geo.size.width * max(0, min(1, fraction))))
            }
        }
        .frame(height: 4)
    }
}

/// The journey's legs as the results list shows them: walker glyphs and
/// route chips joined by chevrons, the current leg full-strength and the
/// rest faded.
private struct LegChain: View {
    let state: JourneyActivityAttributes.ContentState
    let onDark: Bool

    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(state.legChain.enumerated()), id: \.offset) { index, chip in
                if index > 0 {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 7, weight: .semibold))
                        .foregroundStyle(onDark ? Color.white.opacity(0.4) : Palette.muted)
                }
                Group {
                    if chip.mode == "walk" {
                        Image(systemName: "figure.walk")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(onDark ? Color.white : Palette.muted)
                    } else {
                        Text(chip.shortName)
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(chip.colorHex.isEmpty ? Color.gray : Color(hex: chip.colorHex), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    }
                }
                .opacity(index == state.legIndex || state.phase == "arrived" ? 1 : 0.45)
            }
        }
    }
}

private func statusColor(_ status: String, fallback: Color) -> Color {
    switch status {
    case "delayed", "tightConnection": return Palette.amber
    case "cancelled", "missedConnection": return Palette.red
    case "early", "arrived": return Palette.green
    default: return fallback
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
