import SwiftUI

/// Regular width (iPad, bar a narrow Split View window): a map screen's
/// detail as a floating panel down the map's leading edge, like Maps on
/// iPad - in place of the bottom drawer or sheet the phone layout uses,
/// which on a big screen either covers the map or stretches across it.
struct MapSidePanel<Content: View>: View {
    static var width: CGFloat { 400 }
    static var margin: CGFloat { 16 }
    /// The leading strip the panel takes - what controls floating over the
    /// map beside it, and camera insets, keep clear of.
    static var occupiedWidth: CGFloat { width + margin }

    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(width: Self.width)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Theme.background, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.2), radius: 16, y: 4)
            .padding(Self.margin)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// `MapSidePanel`'s geometry, without naming a content type.
typealias MapSidePanelMetrics = MapSidePanel<EmptyView>
