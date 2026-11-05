import SwiftUI

// Widget-extension-only copy of the app's `Color(hex:)` (in
// `Transit/Views/Home/HomeView.swift`) - can't share it via `Shared/`
// without a duplicate-symbol conflict, since `Shared/` sources compile into
// *both* the Transit app target (which already declares this) and this one.
extension Color {
    init(hex: String) {
        var sanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        sanitized = sanitized.replacingOccurrences(of: "#", with: "")
        guard sanitized.count == 6, let value = UInt32(sanitized, radix: 16) else {
            self.init(red: 0.42, green: 0.45, blue: 0.5)
            return
        }
        let r = Double((value >> 16) & 0xFF) / 255
        let g = Double((value >> 8) & 0xFF) / 255
        let b = Double(value & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}
