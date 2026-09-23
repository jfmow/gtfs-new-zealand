import SwiftUI
import TransitCore

// The component kit - one SwiftUI piece per shadcn primitive the web uses
// (frontend/components/ui/*), with the same variants and sizes, so a web
// screen can be ported by reading its JSX.

// MARK: - Button (ui/button.tsx)

enum ShadVariant { case `default`, outline, secondary, ghost, destructive, link }
enum ShadSize { case sm, `default`, lg, icon, iconSm, pill }

struct ShadButtonStyle: ButtonStyle {
    var variant: ShadVariant = .default
    var size: ShadSize = .default
    var fullWidth = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        configuration.label
            .font(size == .sm || size == .iconSm ? .geist(13, .medium, relativeTo: .footnote) : .geist(15, .medium))
            .lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, horizontalPadding)
            .frame(minWidth: isIcon ? height : nil, minHeight: height)
            .frame(width: isIcon ? height : nil, height: height)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(background(pressed: pressed), in: shape)
            .overlay { if variant == .outline { shape.strokeBorder(Theme.input, lineWidth: 1) } }
            .shadow(color: .black.opacity(variant == .default || variant == .outline ? 0.05 : 0), radius: 1, y: 1)
            .contentShape(shape)
            .opacity(isEnabled ? 1 : 0.5)
            .animation(.easeOut(duration: 0.12), value: pressed)
    }

    private var isIcon: Bool { size == .icon || size == .iconSm }

    private var height: CGFloat {
        switch size {
        case .sm, .iconSm: return 32
        case .default, .icon: return 36
        case .lg: return 40
        case .pill: return 44
        }
    }

    private var horizontalPadding: CGFloat {
        switch size {
        case .icon, .iconSm: return 0
        case .sm: return 12
        case .lg: return 32
        default: return 16
        }
    }

    private var shape: some InsettableShape {
        RoundedRectangle(cornerRadius: size == .pill ? 22 : Theme.radiusMD, style: .continuous)
    }

    private var foreground: Color {
        switch variant {
        case .default: return Theme.primaryForeground
        case .destructive: return Theme.destructiveForeground
        case .link: return Theme.primary
        default: return Theme.foreground
        }
    }

    private func background(pressed: Bool) -> Color {
        switch variant {
        case .default: return Theme.primary.opacity(pressed ? 0.9 : 1)
        case .destructive: return Theme.destructive.opacity(pressed ? 0.9 : 1)
        case .secondary: return Theme.secondary.opacity(pressed ? 0.8 : 1)
        case .outline: return pressed ? Theme.accent : Theme.background
        case .ghost: return pressed ? Theme.accent : .clear
        case .link: return .clear
        }
    }
}

extension ButtonStyle where Self == ShadButtonStyle {
    static func shad(_ variant: ShadVariant = .default, size: ShadSize = .default, fullWidth: Bool = false) -> ShadButtonStyle {
        ShadButtonStyle(variant: variant, size: size, fullWidth: fullWidth)
    }
}

// MARK: - Card (ui/card.tsx: rounded-xl border bg-card shadow)

struct ShadCard<Content: View>: View {
    var padding: CGFloat = 14
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .shadCardBackground()
    }
}

extension View {
    /// The card surface on its own - for rows that manage their own padding.
    ///
    /// The shadow is on the background shape only. Applying `.shadow` to
    /// the whole card makes SwiftUI rasterise all its content to draw the
    /// shadow, which on tall cards (the departures board) left faint,
    /// enlarged "ghost" copies of the rows behind them (found 2026-09-23).
    func shadCardBackground(radius: CGFloat = Theme.radiusXL) -> some View {
        background {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(Theme.card)
                .shadow(color: .black.opacity(0.05), radius: 1.5, y: 1)
        }
        .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
    }

    /// `rounded-lg border bg-muted/40` - the web's inline notice/banner box.
    func mutedPanel() -> some View {
        background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
    }
}

// MARK: - Badge (ui/badge.tsx)

struct ShadBadge: View {
    enum Variant { case `default`, secondary, outline, destructive }
    let text: String
    var variant: Variant = .default

    var body: some View {
        Text(text)
            .font(.badge)
            .lineLimit(1)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .foregroundStyle(foreground)
            .background(fill, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay {
                if variant == .outline {
                    RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Theme.border, lineWidth: 1)
                }
            }
    }

    private var foreground: Color {
        switch variant {
        case .default: return Theme.primaryForeground
        case .destructive: return Theme.destructiveForeground
        case .secondary, .outline: return Theme.foreground
        }
    }

    private var fill: Color {
        switch variant {
        case .default: return Theme.primary
        case .secondary: return Theme.secondary
        case .destructive: return Theme.destructive
        case .outline: return .clear
        }
    }
}

/// A route's short name on its own colour - the chip the web shows in the
/// results list, the departure board and the tracker. Grey when the route
/// has no colour, as on the web (`#424242`).
struct RouteBadge: View {
    let name: String
    var colorHex: String = ""
    var textColorHex: String = ""
    var dimmed = false
    var size: CGFloat = 12

    var body: some View {
        Text(name)
            .font(.geist(size, .semibold, relativeTo: .caption))
            .lineLimit(1)
            .foregroundStyle(textColorHex.isEmpty ? Color.white : Color(hex: textColorHex))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(colorHex.isEmpty ? Color(hex: "424242") : Color(hex: colorHex), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            .opacity(dimmed ? 0.5 : 1)
    }
}

// MARK: - Chip (leave-reminder Chip, platform filters, mode filters)

struct Chip: View {
    let label: String
    let isActive: Bool
    var isDisabled = false
    var systemImage: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 11, weight: .semibold)) }
                Text(label).strikethrough(isDisabled)
            }
            .font(.geist(13, .medium, relativeTo: .footnote))
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .foregroundStyle(isDisabled ? Theme.mutedForeground.opacity(0.6) : (isActive ? Theme.primaryForeground : Theme.foreground))
            .background(isDisabled ? Theme.muted : (isActive ? Theme.primary : Theme.background), in: Capsule())
            .overlay(Capsule().strokeBorder(isActive && !isDisabled ? Theme.primary : Theme.input, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}

// MARK: - Select (ui/select.tsx - an outlined trigger over a native menu)

struct ShadSelect<Value: Hashable>: View {
    /// Muted prefix inside the trigger - "Max walk:" etc. Optional.
    var label: String?
    @Binding var selection: Value
    let options: [(value: Value, title: String)]
    var fullWidth = false

    var body: some View {
        Menu {
            Picker(label ?? "", selection: $selection) {
                ForEach(options, id: \.value) { option in
                    Text(option.title).tag(option.value)
                }
            }
        } label: {
            HStack(spacing: 4) {
                if let label { Text(label).foregroundStyle(Theme.mutedForeground) }
                Text(options.first { $0.value == selection }?.title ?? "")
                    .foregroundStyle(Theme.foreground)
                if fullWidth { Spacer(minLength: 4) }
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.mutedForeground)
            }
            .font(.geist(13, relativeTo: .footnote))
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(minHeight: 32)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(Theme.background, in: RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous).strokeBorder(Theme.input, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .menuOrder(.fixed)
    }
}

// MARK: - Input (ui/input.tsx)

struct ShadTextFieldStyle: TextFieldStyle {
    var height: CGFloat = 40
    var leadingSystemImage: String?

    func _body(configuration: TextField<Self._Label>) -> some View {
        HStack(spacing: 8) {
            if let leadingSystemImage {
                Image(systemName: leadingSystemImage)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.mutedForeground)
            }
            configuration
                .font(.bodyText)
                .foregroundStyle(Theme.foreground)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: height)
        .background(Theme.background, in: RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous).strokeBorder(Theme.input, lineWidth: 1))
    }
}

extension TextFieldStyle where Self == ShadTextFieldStyle {
    static func shad(icon: String? = nil, height: CGFloat = 40) -> ShadTextFieldStyle {
        ShadTextFieldStyle(height: height, leadingSystemImage: icon)
    }
}

// MARK: - Section label ("● NEAR YOU", "Saved trips")

/// The web's small section heading: `text-xs font-display uppercase
/// tracking-wide text-muted-foreground`, optionally led by the pulsing live
/// dot used on "Near you".
struct SectionLabel: View {
    let text: String
    var liveDot = false

    var body: some View {
        HStack(spacing: 6) {
            if liveDot { LiveDot() }
            Text(text.uppercased())
                .font(.geist(11, .medium, relativeTo: .caption))
                .tracking(0.6)
                .foregroundStyle(Theme.mutedForeground)
        }
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(text)
    }
}

struct LiveDot: View {
    var color: Color = Theme.primary
    @State private var pulse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 6, height: 6)
            .overlay(
                Circle().stroke(color.opacity(0.5), lineWidth: 1)
                    .scaleEffect(pulse ? 2.2 : 1)
                    .opacity(pulse ? 0 : 1)
            )
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { pulse = true }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Empty / error states (ui/empty.tsx, ui/error-screen.tsx)

struct EmptyState: View {
    let systemImage: String
    let title: String
    var message: String?
    var action: (label: String, run: () -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(Theme.mutedForeground)
                .frame(width: 44, height: 44)
                .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous))
            Text(title).font(.cardTitle).foregroundStyle(Theme.foreground)
            if let message {
                Text(message)
                    .font(.meta)
                    .foregroundStyle(Theme.mutedForeground)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let action {
                Button(action.label, action: action.run).buttonStyle(.shad(.outline, size: .sm)).padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .padding(.horizontal, 24)
    }
}

/// "Could not load departures" + the trace id with a copy button, as the
/// web's ErrorScreen shows it.
struct ErrorState: View {
    let title: String
    let error: Error
    var retry: (() -> Void)?

    @State private var copied = false

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(Theme.danger)
                .frame(width: 44, height: 44)
                .background(Theme.danger.opacity(0.12), in: Circle())
            Text(title).font(.cardTitle).foregroundStyle(Theme.foreground)
            Text(error.localizedDescription)
                .font(.meta)
                .foregroundStyle(Theme.mutedForeground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            if let traceID = (error as? APIError)?.traceID {
                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel(text: "Trace ID")
                    HStack {
                        Text(traceID)
                            .font(.geistMono(12, relativeTo: .caption))
                            .foregroundStyle(Theme.mutedForeground)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 8)
                        Button {
                            UIPasteboard.general.string = traceID
                            copied = true
                        } label: {
                            Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 12))
                        }
                        .buttonStyle(.shad(.ghost, size: .iconSm))
                        .accessibilityLabel("Copy trace ID")
                    }
                    .padding(.leading, 12)
                    .padding(.trailing, 4)
                    .mutedPanel()
                }
                .padding(.top, 8)
            }

            if let retry {
                Button("Try again", action: retry).buttonStyle(.shad(.outline, size: .sm)).padding(.top, 4)
            }
        }
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .padding(.horizontal, 24)
    }
}

// MARK: - Sheet (ui/drawer.tsx on mobile)

extension View {
    /// The web's Drawer: background surface, grabber, content-sized detents.
    func shadSheet(detents: Set<PresentationDetent> = [.medium, .large]) -> some View {
        presentationDetents(detents)
            .presentationDragIndicator(.visible)
            .presentationBackground(Theme.background)
            .presentationCornerRadius(20)
    }
}

// MARK: - Page scaffold

extension View {
    /// Every screen's root: the web's page background, Geist as the default
    /// font for any Text that doesn't set one.
    func pageBackground() -> some View {
        background(Theme.background.ignoresSafeArea())
            .font(.bodyText)
            .foregroundStyle(Theme.foreground)
    }
}

// MARK: - Conditional modifiers

extension View {
    @ViewBuilder
    func `if`<Transformed: View>(_ condition: Bool, transform: (Self) -> Transformed) -> some View {
        if condition { transform(self) } else { self }
    }
}

// MARK: - Hex colours

extension Color {
    /// "RRGGBB" (with or without '#'), as GTFS route colours come.
    init(hex: String) {
        var value: UInt64 = 0
        let cleaned = hex.trimmingCharacters(in: CharacterSet(charactersIn: "# "))
        Scanner(string: cleaned).scanHexInt64(&value)
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
