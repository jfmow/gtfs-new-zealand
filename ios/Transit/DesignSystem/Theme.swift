import SwiftUI
import TransitCore

// Design system v3 (2026-09-23): the web app's own tokens, translated.
//
// The web (frontend/styles/globals.css + components/ui/*) is shadcn's
// neutral palette: near-white/near-black surfaces, a *neutral* primary
// (black button in light mode, white in dark), 1px borders, 10-12pt radii,
// Geist throughout. Colour only ever means something - a route's own
// colour, or a status (late, cancelled, live). v1/v2 of this file invented
// their own look instead (region-blue accent on everything, SF Rounded,
// 18pt shadowed cards), which is why the app never looked like the same
// product as the website.
//
// Token names match the CSS variables one-for-one so a web component can
// be ported by reading its Tailwind classes: `bg-muted` -> Theme.muted,
// `text-muted-foreground` -> Theme.mutedForeground, `border` ->
// Theme.border, `rounded-md` -> Theme.radiusMD.
enum Theme {
    // MARK: Surfaces (globals.css :root / .dark)

    static let background = Color(light: 0xFFFFFF, dark: 0x171717)
    static let foreground = Color(light: 0x0A0A0A, dark: 0xF5F5F5)
    static let card = Color(light: 0xFFFFFF, dark: 0x1F1F1F)
    static let cardForeground = foreground
    static let popover = Color(light: 0xFFFFFF, dark: 0x1F1F1F)
    static let primary = Color(light: 0x171717, dark: 0xF5F5F5)
    static let primaryForeground = Color(light: 0xFAFAFA, dark: 0x171717)
    static let secondary = Color(light: 0xF5F5F5, dark: 0x2B2B2B)
    static let secondaryForeground = foreground
    static let muted = Color(light: 0xF5F5F5, dark: 0x2B2B2B)
    /// Behind grouped forms and lists, so white rows stand out in light
    /// mode (iOS's grouped background); the page colour in dark mode.
    static let groupedBackground = Color(light: 0xF2F2F4, dark: 0x171717)
    static let mutedForeground = Color(light: 0x737373, dark: 0xA3A3A3)
    static let accent = Color(light: 0xF5F5F5, dark: 0x2E2E2E)
    static let accentForeground = foreground
    static let destructive = Color(light: 0xEF4444, dark: 0x8D2020)
    static let destructiveForeground = Color(light: 0xFAFAFA, dark: 0xFAFAFA)
    static let border = Color(light: 0xE5E5E5, dark: 0x2E2E2E)
    static let input = Color(light: 0xE5E5E5, dark: 0x2E2E2E)
    static let ring = Color(light: 0x0A0A0A, dark: 0xCCCCCC)

    // MARK: Status (the web's Tailwind palette uses for these)

    /// Delayed / tight connection - amber-600 / amber-500.
    static let warning = Color(light: 0xD97706, dark: 0xF59E0B)
    /// Cancelled / error text - red-600 / red-400 (readable, unlike the dim
    /// dark-mode `destructive` fill).
    static let danger = Color(light: 0xDC2626, dark: 0xF87171)
    /// On time / success - green-600 / green-400.
    static let success = Color(light: 0x16A34A, dark: 0x4ADE80)
    /// "Now" / live tracking - blue-600 / blue-400.
    static let live = Color(light: 0x2563EB, dark: 0x60A5FA)

    // MARK: Radius (tailwind.config.ts: --radius 0.75rem)

    static let radiusSM: CGFloat = 8
    static let radiusMD: CGFloat = 10
    static let radiusLG: CGFloat = 12
    /// `rounded-xl` - cards.
    static let radiusXL: CGFloat = 12

    /// The agency's own logo asset (copied from the web app's
    /// `public/provider logos/`), for the region picker.
    static func providerLogoImageName(for region: Region) -> String {
        switch region.slug {
        case "at": return "ProviderLogoAT"
        case "wel": return "ProviderLogoMetlink"
        case "christ": return "ProviderLogoMetro"
        default: return "ProviderLogoAT"
        }
    }
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor(light: UIColor(rgb: light), dark: UIColor(rgb: dark)))
    }
}

extension UIColor {
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

// MARK: - Typography (Geist, bundled from the web's `geist` package)

enum GeistWeight {
    case regular, medium, semibold, bold

    var postScriptName: String {
        switch self {
        case .regular: return "Geist-Regular"
        case .medium: return "Geist-Medium"
        case .semibold: return "Geist-SemiBold"
        case .bold: return "Geist-Bold"
        }
    }
}

extension Font {
    /// Geist at `size`, scaling with Dynamic Type relative to `textStyle`.
    static func geist(_ size: CGFloat, _ weight: GeistWeight = .regular, relativeTo textStyle: Font.TextStyle = .body) -> Font {
        .custom(weight.postScriptName, size: size, relativeTo: textStyle)
    }

    static func geistMono(_ size: CGFloat, medium: Bool = false, relativeTo textStyle: Font.TextStyle = .body) -> Font {
        .custom(medium ? "GeistMono-Medium" : "GeistMono-Regular", size: size, relativeTo: textStyle)
    }

    // The web's type scale (Tailwind), nudged up a point for touch.
    /// `text-lg font-semibold` - page headings.
    static let pageTitle = geist(19, .semibold, relativeTo: .title3)
    /// `text-base font-semibold` - card titles, headsigns.
    static let cardTitle = geist(16, .semibold, relativeTo: .headline)
    /// `text-sm` - body copy, the web's default size.
    static let bodyText = geist(15, relativeTo: .body)
    static let bodyMedium = geist(15, .medium, relativeTo: .body)
    /// `text-xs` - meta rows, captions.
    static let meta = geist(13, relativeTo: .footnote)
    static let metaMedium = geist(13, .medium, relativeTo: .footnote)
    /// `text-[11px]` - badges.
    static let badge = geist(11, .medium, relativeTo: .caption2)
    /// Big tabular numbers - countdowns, durations.
    static func number(_ size: CGFloat = 20) -> Font { geist(size, .bold, relativeTo: .title3).monospacedDigit() }

}

/// UIKit-drawn chrome (navigation bars, tab bar, search bars, segmented
/// controls) doesn't read SwiftUI's font environment - set Geist and the
/// neutral palette there once at launch.
enum ChromeAppearance {
    static func apply() {
        // Fonts only - the system keeps drawing the bars' own backgrounds.
        let navBar = UINavigationBar.appearance()
        navBar.titleTextAttributes = [.font: UIFont(name: "Geist-SemiBold", size: 17) ?? .systemFont(ofSize: 17, weight: .semibold)]
        navBar.largeTitleTextAttributes = [.font: UIFont(name: "Geist-Bold", size: 32) ?? .systemFont(ofSize: 32, weight: .bold)]
        UIBarButtonItem.appearance().setTitleTextAttributes([.font: UIFont(name: "Geist-Medium", size: 16) ?? .systemFont(ofSize: 16)], for: .normal)

        let tabFont = UIFont(name: "Geist-Medium", size: 10) ?? .systemFont(ofSize: 10, weight: .medium)
        UITabBarItem.appearance().setTitleTextAttributes([.font: tabFont], for: .normal)

        let segmentFont = UIFont(name: "Geist-Medium", size: 13) ?? .systemFont(ofSize: 13, weight: .medium)
        UISegmentedControl.appearance().setTitleTextAttributes([.font: segmentFont], for: .normal)
    }
}
