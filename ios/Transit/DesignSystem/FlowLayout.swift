import SwiftUI

/// A left-aligned wrapping row - subviews flow left-to-right and wrap onto a
/// new line once they'd overflow the available width, instead of an
/// `HStack`'s hard clip/squish. Used anywhere a chain of small chips (leg
/// summaries, filter pills) can't be guaranteed to fit on one line - a
/// result with several transfers previously had its whole leg-chip chain
/// squeezed into a fixed-width `HStack` and clipped unreadably.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var origin = CGPoint.zero
        var lineHeight: CGFloat = 0
        var width: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x + size.width > maxWidth, origin.x > 0 {
                origin.x = 0
                origin.y += lineHeight + lineSpacing
                lineHeight = 0
            }
            origin.x += size.width + spacing
            width = max(width, origin.x - spacing)
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: width, height: origin.y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var origin = bounds.origin
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x + size.width > bounds.maxX, origin.x > bounds.origin.x {
                origin.x = bounds.origin.x
                origin.y += lineHeight + lineSpacing
                lineHeight = 0
            }
            subview.place(at: origin, proposal: ProposedViewSize(size))
            origin.x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
