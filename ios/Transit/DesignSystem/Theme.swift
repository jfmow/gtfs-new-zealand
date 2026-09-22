import SwiftUI
import TransitCore

// Design plan (see the frontend-design skill's process: plan, then build):
//
// Subject: a native companion for NZ public transport (Auckland Transport,
// Metlink Wellington, Metro Christchurch) - trains, buses, ferries. Used
// one-handed, often mid-walk, in bright sun or at night; the job is "get me
// there", not "impress me".
//
// Color (named):
//   ink      #14171C  primary text - near-black, not pure black
//   paper    #F7F7F5 / #0D0F12 (light/dark)  app background - cool
//            near-white/near-black, not the warm-cream AI default
//   steel    #6B7280  secondary text/icons
//   hairline #E3E5E8 / #24272C  row dividers
//   accent   dynamic per region - AT blue #0073BD / Metlink lime #CED940 /
//            Metro indigo #2A286B - the one bold colour per screen, taken
//            from each agency's own real branding, not invented
//   delayed  #E8A33D   alert/cancelled #D6494A   onTime #3FA66B
//
// Type: system (SF Pro) for Dynamic Type/accessibility, used with intent -
// `.rounded` design + bold + monospaced digits for every time-critical
// number (countdowns, platforms), `.rounded` semibold for headings, plain
// SF Pro for body copy.
//
// Layout: "the board, not the brochure" - flat hairline-divided rows
// (`.plain` lists), not floating SaaS cards with soft shadows; full-bleed
// maps with pill floating controls; one accent colour per screen.
//
// Principles: (1) the board, not the brochure, (2) one bold colour per
// screen - the region's own brand colour, (3) numbers are the hero, (4)
// motion only for live state changes (a vehicle glides; nothing else
// animates gratuitously).
enum Theme {
    static let ink = Color(light: 0x14171C, dark: 0xF2F3F5)
    static let paper = Color(light: 0xF7F7F5, dark: 0x0D0F12)
    static let paperRaised = Color(light: 0xFFFFFF, dark: 0x15181C)
    static let steel = Color(light: 0x6B7280, dark: 0x8B92A0)
    static let hairline = Color(light: 0xE3E5E8, dark: 0x24272C)

    static let delayed = Color(light: 0xC97A17, dark: 0xE8A33D)
    static let alert = Color(light: 0xC13A3B, dark: 0xE8595A)
    static let onTime = Color(light: 0x2E8B57, dark: 0x4CBF7F)

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

// MARK: - Shared row/list chrome ("the board, not the brochure")

/// A flat, hairline-divided row - the app's default list treatment instead
/// of SwiftUI's default inset-grouped card look.
struct BoardRowStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .listRowBackground(Theme.paper)
            .listRowSeparatorTint(Theme.hairline)
    }
}

extension View {
    func boardRow() -> some View { modifier(BoardRowStyle()) }
}

/// A solid, region-accented primary action - the one bold shape per screen.
struct PrimaryButtonStyle: ButtonStyle {
    let accent: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(accent.opacity(configuration.isPressed ? 0.85 : 1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static func transitPrimary(_ accent: Color) -> PrimaryButtonStyle { PrimaryButtonStyle(accent: accent) }
}
