import SwiftUI

/// Where a `BottomDrawer` rests.
enum DrawerDetent: CaseIterable {
    /// Just the header - the map gets the screen.
    case collapsed
    /// About half the screen.
    case medium
    /// Nearly full height.
    case expanded
}

/// A drawer over a full-screen map - drag the header (or tap the handle) to
/// switch between collapsed, half and full height; the content scrolls
/// inside. Drawn in the view itself rather than as a system sheet, so it
/// can't fight navigation pops or other sheets (the journey tracker's sheet
/// needed several workarounds for exactly that).
struct BottomDrawer<Header: View, Content: View>: View {
    @Binding var detent: DrawerDetent
    /// The header's own height; the collapsed drawer shows just this.
    let collapsedHeight: CGFloat
    /// Height of the area the drawer lives in (usually the whole screen).
    let availableHeight: CGFloat
    /// Space always left free above an expanded drawer.
    var topClearance: CGFloat = 110
    @ViewBuilder var header: Header
    @ViewBuilder var content: Content

    @GestureState private var dragOffset: CGFloat = 0

    static func height(for detent: DrawerDetent, collapsed: CGFloat, available: CGFloat, topClearance: CGFloat) -> CGFloat {
        switch detent {
        case .collapsed: return collapsed
        case .medium: return max(collapsed, available * 0.48)
        case .expanded: return max(collapsed, available - topClearance)
        }
    }

    private func height(for detent: DrawerDetent) -> CGFloat {
        Self.height(for: detent, collapsed: collapsedHeight, available: availableHeight, topClearance: topClearance)
    }

    private var currentHeight: CGFloat {
        let proposed = height(for: detent) - dragOffset
        return min(max(proposed, collapsedHeight * 0.7), height(for: .expanded))
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                Capsule()
                    .fill(Theme.mutedForeground.opacity(0.4))
                    .frame(width: 36, height: 5)
                    .padding(.top, 8)
                    .padding(.bottom, 6)
                    .accessibilityHidden(true)
                header
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .gesture(drag)
            .onTapGesture { cycle() }
            .accessibilityElement(children: .contain)
            .accessibilityAction(named: detent == .collapsed ? "Expand" : "Collapse") { cycle() }

            if detent != .collapsed || dragOffset < 0 {
                content
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(height: currentHeight, alignment: .top)
        .frame(maxWidth: .infinity)
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24, style: .continuous)
                .fill(Theme.background)
                .shadow(color: .black.opacity(0.25), radius: 16, y: -2)
                .ignoresSafeArea(edges: .bottom)
        )
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24, style: .continuous))
        .animation(.spring(duration: 0.35, bounce: 0.15), value: detent)
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 6)
            .updating($dragOffset) { value, state, _ in state = value.translation.height }
            .onEnded { value in
                // Snap to the detent nearest where the fling would land.
                let landing = height(for: detent) - value.predictedEndTranslation.height
                detent = DrawerDetent.allCases.min { abs(height(for: $0) - landing) < abs(height(for: $1) - landing) } ?? detent
            }
    }

    private func cycle() {
        switch detent {
        case .collapsed: detent = .medium
        case .medium: detent = .expanded
        case .expanded: detent = .collapsed
        }
    }
}
