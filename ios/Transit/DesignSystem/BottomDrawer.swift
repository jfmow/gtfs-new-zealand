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

    @State private var dragOffset: CGFloat = 0
    /// Pulling down on the content while its list is scrolled to the top
    /// moves the drawer (like a system sheet) instead of doing nothing.
    @State private var pullOffset: CGFloat = 0
    /// The pull's translation when the list reached the top - the drawer
    /// follows the finger from there, rather than jumping by however far
    /// the list had scrolled first.
    @State private var pullStart: CGFloat?
    @State private var contentAtTop = true

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

    private var fullHeight: CGFloat { height(for: .expanded) }

    private var currentHeight: CGFloat {
        let proposed = height(for: detent) - dragOffset - pullOffset
        return min(max(proposed, collapsedHeight * 0.7), fullHeight)
    }

    // The drawer is always laid out at full height and slid down with an
    // offset. Resizing it on every drag frame re-laid-out the whole stop
    // list 60 times a second (the jank), and moved the view the drag was
    // measured in (the flicker and sticking).
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

            content
                .frame(maxHeight: .infinity, alignment: .top)
                // The part of the drawer slid below the screen edge at
                // rest - so the list's last rows can still scroll into view.
                // Changes only when the detent does, never mid-drag.
                .safeAreaPadding(.bottom, fullHeight - height(for: detent))
                .coordinateSpace(name: DrawerScrollAnchor.space)
                .onPreferenceChange(DrawerScrollOffsetKey.self) { contentAtTop = $0 >= -2 }
                .simultaneousGesture(pullToCollapse)
                .opacity(detent == .collapsed && dragOffset >= 0 ? 0 : 1)
                .allowsHitTesting(detent != .collapsed)
                .accessibilityHidden(detent == .collapsed)
        }
        .frame(height: fullHeight, alignment: .top)
        .frame(maxWidth: .infinity)
        // The background runs on under the home indicator to the screen's
        // edge; no clipShape here - it would trim that back to the safe
        // area and leave the drawer floating above the bottom.
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24, style: .continuous)
                .fill(Theme.background)
                .shadow(color: .black.opacity(0.25), radius: 16, y: -2)
                .padding(.bottom, -400)
        )
        .offset(y: fullHeight - currentHeight)
        .animation(.spring(duration: 0.35, bounce: 0.12), value: detent)
    }

    private var drag: some Gesture {
        // Global space: the drawer moves under the finger, so a local
        // translation would feed back into itself.
        DragGesture(minimumDistance: 4, coordinateSpace: .global)
            .onChanged { value in
                var t = Transaction()
                t.disablesAnimations = true
                withTransaction(t) { dragOffset = value.translation.height }
            }
            .onEnded { value in
                // Snap to the detent nearest where the fling would land -
                // animating from wherever the finger let go, including back
                // to the same detent.
                let landing = height(for: detent) - value.predictedEndTranslation.height
                let target = DrawerDetent.allCases.min { abs(height(for: $0) - landing) < abs(height(for: $1) - landing) } ?? detent
                withAnimation(.spring(duration: 0.35, bounce: 0.12)) {
                    dragOffset = 0
                    detent = target
                }
            }
    }

    private var pullToCollapse: some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .global)
            .onChanged { value in
                let dy = value.translation.height
                guard contentAtTop, dy > 0 else {
                    if pullOffset != 0 { pullOffset = 0 }
                    pullStart = nil
                    return
                }
                let start = pullStart ?? dy
                if pullStart == nil { pullStart = dy }
                var t = Transaction()
                t.disablesAnimations = true
                withTransaction(t) { pullOffset = max(0, dy - start) }
            }
            .onEnded { value in
                let pulled = pullOffset
                pullStart = nil
                guard pulled > 0 else { return }
                // Predictable steps: a real pull drops one size (full ->
                // half -> collapsed); a quick fling goes straight down.
                withAnimation(.spring(duration: 0.35, bounce: 0.12)) {
                    pullOffset = 0
                    if value.predictedEndTranslation.height > 500 {
                        detent = .collapsed
                    } else if pulled > 50 {
                        detent = detent == .expanded ? .medium : .collapsed
                    }
                }
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

/// Put at the very top of a drawer's scroll view content, so the drawer
/// knows when the list is scrolled to the top (and a pull down should move
/// the drawer rather than the list).
struct DrawerScrollAnchor: View {
    static let space = "bottomDrawerContent"

    var body: some View {
        GeometryReader { geo in
            Color.clear.preference(key: DrawerScrollOffsetKey.self, value: geo.frame(in: .named(Self.space)).minY)
        }
        .frame(height: 0)
    }
}

struct DrawerScrollOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
