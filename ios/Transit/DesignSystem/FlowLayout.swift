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
        let frames = lineFrames(maxWidth: proposal.width ?? .infinity, subviews: subviews)
        let width = frames.map(\.maxX).max() ?? 0
        let height = frames.map(\.maxY).max() ?? 0
        return CGSize(width: width, height: height)
    }

    /// Breaks lines against the *proposed* width, the same one
    /// `sizeThatFits` measured with - not `bounds`, which is the tight
    /// width we reported, pixel-rounded. Re-wrapping against that could
    /// push the widest line's last chip onto an extra line the reported
    /// height never included, drawing it over whatever sits below.
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let frames = lineFrames(maxWidth: proposal.width ?? bounds.width, subviews: subviews)
        for (subview, frame) in zip(subviews, frames) {
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func lineFrames(maxWidth: CGFloat, subviews: Subviews) -> [CGRect] {
        var frames: [CGRect] = []
        var origin = CGPoint.zero
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x + size.width > maxWidth + 0.5, origin.x > 0 {
                origin.x = 0
                origin.y += lineHeight + lineSpacing
                lineHeight = 0
            }
            frames.append(CGRect(origin: origin, size: size))
            origin.x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        return frames
    }
}
