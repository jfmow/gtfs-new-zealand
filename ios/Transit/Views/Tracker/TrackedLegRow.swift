import SwiftUI
import TransitCore

/// The tracker drawer's itinerary: a vertical timeline with a time column,
/// a continuous rail (the route's colour for a ride, dotted for a walk, that
/// fills as the current leg progresses) and full-width rows - the current
/// leg's highlight runs edge to edge of the card. Same information as the
/// web's `route-detail-sheet.tsx` itinerary, laid out for a phone.
struct JourneyTimeline: View {
    let legs: [JourneyLeg]
    let status: (Int) -> TrackedLegRow.Status
    let progress: (Int) -> Double?
    let waitMinutes: (Int) -> Int?
    let destinationName: String
    let accent: Color
    /// Where the journey starts - adds a "Leave from" row at the top (the
    /// journey preview; the tracker leaves it out).
    var startName: String?

    /// A wait right before a ride that follows another ride is a transfer.
    private func isTransfer(before index: Int) -> Bool {
        legs.indices.contains(index) && legs[index].mode == "transit" && legs[..<index].contains { $0.mode == "transit" }
    }

    var body: some View {
        VStack(spacing: 0) {
            if let startName, let first = legs.first {
                TimelineRow(time: first.departureTime.date, rail: .dotted(Theme.mutedForeground.opacity(0.5)), marker: .start, highlighted: false) {
                    // A searched address can be very long - three lines is plenty.
                    Text("Leave from \(startName)").font(.bodyMedium).padding(.vertical, 10)
                        .lineLimit(3)
                }
            }
            ForEach(Array(legs.enumerated()), id: \.offset) { index, leg in
                TrackedLegRow(
                    leg: leg,
                    status: status(index),
                    progress: progress(index),
                    destinationName: index == legs.count - 1 ? destinationName : nil,
                    accent: accent
                )
                if index < legs.count - 1, let wait = waitMinutes(index), wait >= 1 || isTransfer(before: index + 1) {
                    let transfer = isTransfer(before: index + 1)
                    TimelineRow(time: nil, rail: .dotted(Theme.mutedForeground.opacity(0.4)), marker: .none, highlighted: false) {
                        Label(transfer ? (wait >= 1 ? "Transfer · \(wait) min wait" : "Transfer") : "\(wait) min wait",
                              systemImage: transfer ? "arrow.left.arrow.right" : "clock")
                            .font(.geist(12, relativeTo: .caption))
                            .foregroundStyle(Theme.mutedForeground)
                            .padding(.vertical, 6)
                    }
                    .opacity(status(index + 1) == .done ? 0.45 : 1)
                }
            }
            if let last = legs.last {
                TimelineRow(time: last.arrivalTime.date, rail: .none, marker: .destination, highlighted: false) {
                    Text("Arrive at \(destinationName)").font(.bodyMedium).padding(.vertical, 12)
                }
            }
        }
        .padding(.vertical, 6)
        .shadCardBackground()
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusXL, style: .continuous))
    }
}

/// One leg of the timeline.
struct TrackedLegRow: View {
    let leg: JourneyLeg
    let status: Status
    /// 0...1 through the leg - only for the leg being ridden right now.
    let progress: Double?
    /// For the final leg: what to call where it ends when it isn't a stop.
    var destinationName: String?
    let accent: Color

    enum Status { case done, current, upcoming }

    private var isWalk: Bool { leg.mode == "walk" }
    private var isCurrent: Bool { status == .current }
    private var routeHex: String { leg.route?.routeColor.isEmpty == false ? leg.route!.routeColor : "525252" }
    private var routeColor: Color { Color(hex: routeHex) }

    var body: some View {
        Group {
            if isWalk { walk } else { ride }
        }
        .opacity(status == .done ? 0.45 : 1)
    }

    // MARK: Walk

    private var walk: some View {
        TimelineRow(time: leg.departureTime.date, rail: .dotted(Theme.mutedForeground.opacity(0.5)),
                    marker: .icon("figure.walk", isCurrent ? accent : Theme.mutedForeground), highlighted: isCurrent, accent: accent) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Walk to \(leg.toStop?.stopName ?? destinationName ?? "your destination")")
                    .font(isCurrent ? .bodyMedium : .bodyText)
                    .fixedSize(horizontal: false, vertical: true)
                Text(walkSummary).font(.meta).foregroundStyle(Theme.mutedForeground)
            }
            .padding(.vertical, 10)
        }
    }

    private var walkSummary: String {
        let minutes = max(1, Int((leg.duration.timeInterval / 60).rounded()))
        guard leg.distanceKm > 0 else { return "\(minutes) min" }
        return "\(minutes) min · \(TimeFormatting.formatDistance(meters: leg.distanceKm * 1000))"
    }

    // MARK: Ride

    private var rideSummary: String {
        let minutes = max(1, Int((leg.duration.timeInterval / 60).rounded()))
        return "Ride \(minutes) min"
    }

    private var ride: some View {
        VStack(spacing: 0) {
            // Board
            TimelineRow(time: leg.departureTime.date, rail: .solid(routeColor, progress: progress, dimmed: status == .done),
                        marker: .route(leg.route?.routeShortName.isEmpty == false ? leg.route!.routeShortName : leg.routeID, routeHex),
                        highlighted: isCurrent, accent: accent) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(leg.fromStop?.stopName ?? "Board").font(isCurrent ? .bodyMedium : .bodyText)
                            .fixedSize(horizontal: false, vertical: true)
                        if let platform = leg.fromStop?.platformNumber, !platform.isEmpty {
                            ShadBadge(text: "Plat. \(platform)", variant: .outline)
                        }
                    }
                    Text(rideSummary).font(.meta).foregroundStyle(Theme.mutedForeground)
                    if !leg.tripUsable {
                        Label("Not running - check alternative routes", systemImage: "exclamationmark.triangle")
                            .font(.metaMedium).foregroundStyle(Theme.danger)
                    } else if let delay = leg.delaySeconds, abs(delay) >= 60 {
                        Text(delay > 0 ? "\(delay / 60) min late" : "\(-delay / 60) min early")
                            .font(.metaMedium).foregroundStyle(delay > 0 ? Theme.warning : Theme.success)
                    }
                }
                .padding(.vertical, 10)
            }

            // Alight
            TimelineRow(time: leg.arrivalTime.date, rail: .none, marker: .stop(routeColor), highlighted: isCurrent, accent: accent,
                        incoming: .solid(routeColor, progress: nil, dimmed: status == .done)) {
                HStack(spacing: 6) {
                    Text("Get off at \(leg.toStop?.stopName ?? "your stop")").font(.bodyText)
                        .fixedSize(horizontal: false, vertical: true)
                    if let platform = leg.toStop?.platformNumber, !platform.isEmpty {
                        ShadBadge(text: "Plat. \(platform)", variant: .outline)
                    }
                }
                .padding(.vertical, 10)
            }
        }
    }
}

/// A small muted pill for live facts - "Live", "2 stops away", "Plat. 4".
/// With a `tint`, the chip takes that status colour (late, cancelled).
struct StatusChipStyle: ViewModifier {
    var tint: Color?

    func body(content: Content) -> some View {
        content
            .font(.geist(12, .medium, relativeTo: .caption))
            .foregroundStyle(tint ?? Theme.foreground)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(tint.map { $0.opacity(0.14) } ?? Theme.muted, in: Capsule())
    }
}

/// A `TimelineRow`'s line segment and marker (top level so callers can
/// name them without the row's generic content type).
enum TimelineRail {
    case none
    case dotted(Color)
    /// `progress` fills the segment with full colour from the top.
    case solid(Color, progress: Double? = nil, dimmed: Bool = false)
}

enum TimelineMarker {
    case none
    case start
    case icon(String, Color)
    case route(String, String)  // name, colour hex
    case stop(Color)
    case destination
}


/// One timeline line: time column | rail + marker | content. The rail
/// segment runs from this row's marker down to the next row, so stacked
/// rows draw one continuous line.
struct TimelineRow<Content: View>: View {
    typealias Rail = TimelineRail
    typealias Marker = TimelineMarker

    let time: Date?
    let rail: Rail
    let marker: Marker
    let highlighted: Bool
    var accent: Color = Theme.live
    /// The line coming into this row's marker from the row above - without
    /// it a stack of stops shows a gap above every marker.
    var incoming: TimelineRail = .none
    @ViewBuilder var content: Content

    /// Grows with Dynamic Type so "12:45 PM" never truncates at large sizes.
    @ScaledMetric(relativeTo: .footnote) private var timeWidth: CGFloat = 58
    private let railWidth: CGFloat = 34

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Group {
                if let time {
                    Text(time, style: .time)
                        .font(.geist(13, highlighted ? .semibold : .medium, relativeTo: .footnote))
                        .monospacedDigit()
                        .foregroundStyle(highlighted ? Theme.foreground : Theme.mutedForeground)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .padding(.top, 11)
                } else {
                    Color.clear
                }
            }
            .frame(width: timeWidth, alignment: .trailing)

            railColumn.frame(width: railWidth)

            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.trailing, 14)
        .background(highlighted ? accent.opacity(0.08) : .clear)
        .overlay(alignment: .leading) {
            if highlighted { Rectangle().fill(accent).frame(width: 3) }
        }
    }

    private var railColumn: some View {
        ZStack(alignment: .top) {
            // Segment from the row's top down to the marker.
            GeometryReader { geo in
                switch incoming {
                case .solid(let color, _, let dimmed):
                    Capsule().fill(color.opacity(dimmed ? 0.3 : 1))
                        .frame(width: 4, height: 20)
                        .frame(width: geo.size.width)
                case .dotted(let color):
                    Path { p in
                        p.move(to: CGPoint(x: geo.size.width / 2, y: 0))
                        p.addLine(to: CGPoint(x: geo.size.width / 2, y: 18))
                    }
                    .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [1, 5]))
                case .none:
                    EmptyView()
                }
            }
            // Segment from the marker's centre down to the next row.
            GeometryReader { geo in
                let top: CGFloat = 20
                let height = max(0, geo.size.height - top)
                switch rail {
                case .none:
                    EmptyView()
                case .dotted(let color):
                    Path { p in
                        p.move(to: CGPoint(x: geo.size.width / 2, y: top))
                        p.addLine(to: CGPoint(x: geo.size.width / 2, y: geo.size.height))
                    }
                    .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [1, 5]))
                case .solid(let color, let progress, let dimmed):
                    ZStack(alignment: .top) {
                        Capsule().fill(color.opacity(dimmed ? 0.3 : (progress == nil ? 1 : 0.3)))
                            .frame(width: 4, height: height)
                        if let progress {
                            Capsule().fill(color)
                                .frame(width: 4, height: height * max(0, min(1, progress)))
                                .animation(.linear(duration: 1), value: progress)
                        }
                    }
                    .frame(width: geo.size.width)
                    .offset(y: top)
                }
            }
            markerView.padding(.top, 8)
        }
    }

    @ViewBuilder
    private var markerView: some View {
        switch marker {
        case .none:
            Color.clear.frame(width: 1, height: 24)
        case .start:
            Circle().fill(Theme.card).frame(width: 16, height: 16)
                .overlay(Circle().strokeBorder(Theme.foreground, lineWidth: 3))
                .padding(.top, 4)
        case .icon(let name, let color):
            Image(systemName: name)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 24, height: 24)
                .background(Theme.card, in: Circle())
                .overlay(Circle().strokeBorder(color.opacity(0.5), lineWidth: 1.5))
        case .route(let name, let hex):
            Text(name)
                .font(.geist(10, .bold, relativeTo: .caption2))
                .foregroundStyle(RouteColors.text(onHex: hex))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.horizontal, 3)
                .frame(minWidth: 26, minHeight: 24)
                .background(Color(hex: hex), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        case .stop(let color):
            Circle().fill(Theme.card).frame(width: 14, height: 14)
                .overlay(Circle().strokeBorder(color, lineWidth: 3))
                .padding(.top, 5)
        case .destination:
            Image(systemName: "flag.checkered")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(Theme.danger, in: Circle())
        }
    }
}
