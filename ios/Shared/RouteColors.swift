import SwiftUI

/// Route colour helpers shared by the app and the widget extension.
enum RouteColors {
    /// WCAG relative luminance of an "RRGGBB" hex colour (0 black ... 1
    /// white); nil for an empty/invalid string.
    static func luminance(hex: String) -> Double? {
        let clean = hex.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "#", with: "")
        guard clean.count == 6, let value = UInt32(clean, radix: 16) else { return nil }
        func channel(_ shift: UInt32) -> Double {
            let c = Double((value >> shift) & 0xFF) / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
    }

    /// Text colour for a label drawn on this route colour: near-black on
    /// light colours (yellow, lime, white routes), white otherwise. The feed
    /// doesn't send a route text colour, and white-on-yellow was unreadable.
    static func text(onHex hex: String) -> Color {
        (luminance(hex: hex) ?? 0) > 0.4 ? Color(red: 0.07, green: 0.07, blue: 0.07) : .white
    }
}
