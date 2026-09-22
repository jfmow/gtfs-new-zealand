import SwiftUI
import TransitCore

// Design plan v2 (revised per direction: modern, shadcn-inspired, "2026 not
// 2018" - soft rounded surfaces, circular badges, confident colour, not the
// flat signage-board look v1 started with).
//
// Subject: a native companion for NZ public transport (Auckland Transport,
// Metlink Wellington, Metro Christchurch) - trains, buses, ferries. Used
// one-handed, often mid-walk, in bright sun or at night; the job is "get me
// there" but the *feel* should be current-generation, not a 2018 utility app.
//
// Color (named):
//   ink        #14171C / #F2F3F5   primary text
//   paper      #F7F7F5 / #0D0F12   app background - cool near-white/black
//   card       #FFFFFF / #16191E   card surface, sits above paper
//   cardBorder #EBECEF / #262A31   hairline border on a card, not a shadow-only edge
//   steel      #6B7280 / #8B92A0   secondary text/icons
//   accent     dynamic per region - AT blue #0073BD / Metlink lime #CED940 /
//              Metro indigo #2A286B - the one bold colour per screen, taken
//              from each agency's own real branding, not invented
//   delayed #E8A33D   alert/cancelled #D6494A   onTime #3FA66B
//
// Type: system (SF Pro), used with intent - `.rounded` design + bold +
// monospaced digits for every time-critical number (countdowns, platforms),
// `.rounded` semibold for headings, plain SF Pro for body copy.
//
// Layout: soft rounded cards (18pt corner radius, 1px hairline border, a
// faint shadow - shadcn's "shadow-sm", not a heavy drop shadow) floating on
// the paper background with breathing room between them, not edge-to-edge
// table rows. Every row leads with a circular icon/glyph badge (route mode,
// cause icon, region swatch) rather than a plain colour rail. Full-bleed
// maps with pill floating controls.
//
// Principles: (1) soft cards, not flat rows or SaaS-shadow clichés, (2)
// circles carry meaning - every leading badge is a circle, consistent
// across the app, (3) one bold colour per screen - the region's own brand
// colour - used with more confidence than a single accent line (badge
// fills, active-state tints, gradients on the hero elements), (4) numbers
// are the hero - countdowns/durations get the boldest, roundest, most
// legible treatment, (5) motion only for live state changes.
enum Theme {
    static let ink = Color(light: 0x14171C, dark: 0xF2F3F5)
    static let paper = Color(light: 0xF7F7F5, dark: 0x0D0F12)
    static let card = Color(light: 0xFFFFFF, dark: 0x16191E)
    static let cardBorder = Color(light: 0xEBECEF, dark: 0x262A31)
    static let steel = Color(light: 0x6B7280, dark: 0x8B92A0)
    static let hairline = Color(light: 0xE3E5E8, dark: 0x24272C)

    static let delayed = Color(light: 0xC97A17, dark: 0xE8A33D)
    static let alert = Color(light: 0xC13A3B, dark: 0xE8595A)
    static let onTime = Color(light: 0x2E8B57, dark: 0x4CBF7F)

    static let cardRadius: CGFloat = 18
    static let badgeRadius: CGFloat = 40

    /// The one bold colour for the current screen - the active region's own
    /// brand colour (AT blue / Metlink lime / Metro indigo).
    static func accent(for region: Region) -> Color {
        Color(hex: region.brandColorHex)
    }
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor(light: UIColor(rgb: light), dark: UIColor(rgb: dark)))
    }
}

private extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }

    convenience init(light: UIColor, dark: UIColor) {
        self.init(dynamicProvider: { $0.userInterfaceStyle == .dark ? dark : light })
    }
}

// MARK: - Typography

extension Font {
    /// The "hero number" treatment - departure countdowns, platform
    /// numbers, delay minutes: bold, rounded, monospaced digits so they
    /// don't jitter as they tick over.
    static func heroNumber(_ size: CGFloat = 22) -> Font {
        .system(size: size, weight: .bold, design: .rounded).monospacedDigit()
    }

    static func sectionHeading(_ size: CGFloat = 20) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
    }
}

// MARK: - Cards

/// A soft rounded surface - the app's base unit of layout. Wrap row content
/// in this instead of relying on List's own chrome.
struct TransitCard<Content: View>: View {
    var padding: CGFloat = 14
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
                    .strokeBorder(Theme.cardBorder, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.05), radius: 10, x: 0, y: 4)
    }
}

/// Clears a `List` row's own chrome so a `TransitCard` inside it reads as a
/// floating card, with breathing room between rows instead of hairline
/// dividers - swipe actions/pull-to-refresh still work, List just gets out
/// of the way visually.
struct CardListRowStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
    }
}

extension View {
    /// Use on a `TransitCard` (or any row content) placed inside a `List` -
    /// the app's default row treatment.
    func cardListRow() -> some View { modifier(CardListRowStyle()) }

    /// Kept for call sites still using the flatter v1 treatment where a
    /// hairline still makes sense (dense settings-style rows); prefer
    /// `cardListRow()` for anything list-of-items shaped.
    func boardRow() -> some View {
        listRowBackground(Theme.paper).listRowSeparatorTint(Theme.hairline)
    }
}

/// A circular icon/glyph badge - the app's consistent leading element
/// (route mode, alert cause, region swatch), replacing a plain colour rail.
struct CircularBadge<Content: View>: View {
    var diameter: CGFloat = 40
    var fill: Color
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(width: diameter, height: diameter)
            .background(fill.gradient, in: Circle())
    }
}

// MARK: - Buttons

/// A solid, region-accented primary action - the one bold shape per screen.
struct PrimaryButtonStyle: ButtonStyle {
    let accent: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(accent.gradient.opacity(configuration.isPressed ? 0.85 : 1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static func transitPrimary(_ accent: Color) -> PrimaryButtonStyle { PrimaryButtonStyle(accent: accent) }
}
