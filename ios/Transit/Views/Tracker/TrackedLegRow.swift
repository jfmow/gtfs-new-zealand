import SwiftUI
import TransitCore

/// One leg in `JourneyTrackingView`'s itinerary drawer - a straight port of
/// `route-detail-sheet.tsx`'s `LegRow`: a walk leg collapses to one line
/// (icon + time + from → to + duration/distance), a transit leg gets the
/// full two-row board/alight "rail" (icon, a connecting line that fills
/// with the route colour as the ride progresses, platform badges, a live
/// info chip), and a wait row appears between legs when there's a
/// meaningful gap.
struct TrackedLegRow: View {
    let leg: JourneyLeg
    let isLast: Bool
    let status: Status
    /// The current phase's label ("Boarding now" etc.) - shown as a pill
    /// only on the currently-tracked leg.
    let currentLabel: String?
    /// The region's own accent colour, for the `currentLabel` pill - passed
    /// in rather than read from `@Environment` since this is otherwise a
    /// plain, environment-free row view.
    var accent: Color = .accentColor
    /// 0...1 through this leg's own scheduled span - only set for the leg
    /// actually being ridden/waited for right now.
    let progress: Double?
    let liveInfo: LiveInfo?
    /// Minutes until the next leg starts, from this leg's own end - nil/0
    /// suppresses the wait row (mirrors the web's `waitNs >= 60s` gate).
    let waitMinutes: Int?

    enum Status { case done, current, upcoming }

    struct LiveInfo {
        let stopsAway: Int?
        let occupancy: Int?
        let platform: String?
    }

    private var isWalk: Bool { leg.mode == "walk" }
    private var routeColor: Color { Color(hex: leg.route?.routeColor.isEmpty == false ? leg.route!.routeColor : "424242") }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let currentLabel {
                Label {
                    Text(currentLabel).font(.caption.weight(.semibold))
                } icon: {
                    Circle().fill(Color.white).frame(width: 5, height: 5)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(accent, in: Capsule())
                .foregroundStyle(.white)
                .padding(.bottom, 4)
            }

            if !isWalk, leg.tripUsable == false {
                Label("This service is not running. Check alternative routes.", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
                    .padding(8)
                    .background(Theme.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                    .padding(.bottom, 6)
            }

            if isWalk {
                walkRow
            } else {
                transitRows
            }

            if !isLast, let waitMinutes, waitMinutes >= 1 {
                HStack(spacing: 12) {
                    Image(systemName: "clock").font(.caption2).frame(width: 28)
                    Text("\(waitMinutes) min wait")
                }
                .font(.caption)
                .foregroundStyle(Theme.mutedForeground)
                .padding(.vertical, 4)
            }
        }
        .opacity(status == .done ? 0.4 : 1)
    }

    // MARK: - Walk leg

    private var walkRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "figure.walk")
                .font(.caption)
                .foregroundStyle(Theme.mutedForeground)
                .frame(width: 28, height: 28)
                .overlay(Circle().strokeBorder(Theme.mutedForeground.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [3])))

            HStack(spacing: 4) {
                Text(leg.departureTime.date ?? Date(), style: .time).font(.subheadline.weight(.medium)).monospacedDigit()
                Text(leg.fromStop?.stopName ?? "Start").font(.subheadline).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                Image(systemName: "arrow.right").font(.caption2).foregroundStyle(Theme.mutedForeground.opacity(0.6))
                Text(leg.toStop?.stopName ?? "Destination").font(.subheadline).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                Text(walkSummary).font(.caption).foregroundStyle(Theme.mutedForeground.opacity(0.7))
            }
            .lineLimit(1)
            .layoutPriority(1)
        }
        .padding(.vertical, 6)
    }

    private var walkSummary: String {
        let minutes = max(0, Int((leg.duration.timeInterval / 60).rounded()))
        var text = "· \(minutes) min"
        if leg.distanceKm > 0 { text += String(format: " · %.2f km", leg.distanceKm) }
        return text
    }

    // MARK: - Transit leg

    private var transitRows: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                railIcon
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(leg.departureTime.date ?? Date(), style: .time).font(.subheadline.weight(.semibold)).monospacedDigit()
                        Text(leg.fromStop?.stopName ?? "Start").font(.subheadline).foregroundStyle(Theme.mutedForeground)
                        if let platform = leg.fromStop?.platformNumber, !platform.isEmpty {
                            platformBadge(platform)
                        }
                        if let headsign = leg.fromStop?.stopHeadsign, !headsign.isEmpty {
                            Text("towards \(headsign)").font(.caption2).foregroundStyle(Theme.mutedForeground)
                        }
                        if leg.fromStop?.wheelchairBoarding == 1 {
                            Image(systemName: "figure.roll").font(.caption2).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)

                    if let liveInfo, liveInfo.stopsAway != nil || liveInfo.platform != nil || liveInfo.occupancy != nil {
                        liveInfoChip(liveInfo)
                    }
                }
                .padding(.bottom, 10)
            }

            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    if isLast {
                        Circle().fill(Theme.danger).frame(width: 16, height: 16)
                            .overlay(Circle().strokeBorder(Theme.background, lineWidth: 2))
                    } else {
                        Circle().fill(Theme.background).frame(width: 13, height: 13)
                            .overlay(Circle().strokeBorder(Theme.mutedForeground.opacity(0.5), lineWidth: 2))
                    }
                }
                .frame(width: 28)

                HStack(spacing: 6) {
                    Text(leg.arrivalTime.date ?? Date(), style: .time).font(.subheadline.weight(.semibold)).monospacedDigit()
                    Text(leg.toStop?.stopName ?? "Destination").font(.subheadline).foregroundStyle(Theme.mutedForeground)
                    if let platform = leg.toStop?.platformNumber, !platform.isEmpty {
                        platformBadge(platform)
                    }
                    if leg.toStop?.wheelchairBoarding == 1 {
                        Image(systemName: "figure.roll").font(.caption2).foregroundStyle(Theme.mutedForeground)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// The board icon + the connecting line down to the alight dot, filling
    /// with the route colour as `progress` advances - `GeometryReader`
    /// gives the line its parent's actual height (set by the board row's
    /// content next to it), matching the web's flex-sized rail column.
    private var railIcon: some View {
        VStack(spacing: 2) {
            ZStack {
                Circle().fill(routeColor.opacity(leg.tripUsable == false ? 0.5 : 1))
                Image(systemName: vehicleIconName).font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
            }
            .frame(width: 24, height: 24)

            GeometryReader { geo in
                ZStack(alignment: .top) {
                    Capsule().fill(routeColor.opacity(status == .done ? 0.2 : 0.35))
                    if let progress {
                        Capsule().fill(routeColor).frame(height: geo.size.height * max(0, min(1, progress)))
                            .animation(.linear(duration: 1), value: progress)
                    }
                }
            }
            .frame(width: 2)
            .frame(maxHeight: .infinity)
        }
        .frame(width: 28)
    }

    private var vehicleIconName: String {
        switch leg.route?.routeType {
        case 2: return "tram.fill" // rail
        case 4: return "ferry.fill"
        default: return "bus.fill"
        }
    }

    private func platformBadge(_ platform: String) -> some View {
        Text("Plat. \(platform)")
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func liveInfoChip(_ info: LiveInfo) -> some View {
        HStack(spacing: 6) {
            Label {
                Text("Live").font(.caption2.weight(.semibold))
            } icon: {
                Circle().fill(Theme.success).frame(width: 5, height: 5)
            }
            if let stopsAway = info.stopsAway {
                Text("\(stopsAway) \(stopsAway == 1 ? "stop" : "stops") away")
            }
            if let platform = info.platform {
                Text("Platform \(platform)")
            }
            if let occupancy = info.occupancy {
                OccupancyIconsView(occupancy: occupancy)
                Text(OccupancyText.label(occupancy))
            }
        }
        .font(.caption2)
        .foregroundStyle(Theme.mutedForeground)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Theme.mutedForeground.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
    }
}
