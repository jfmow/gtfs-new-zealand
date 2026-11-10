import { Bus, Footprints, MapPin, Ship, TrainFront, type LucideIcon } from "@/components/icons"
import { useState, type ReactNode } from "react"
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type ViewStyle } from "react-native"
import { radius, spacing, type, useColors } from "@/theme"

/** Lucide icons per mode - the same set the web's map markers and stop list use. */
export function modeIcon(mode: string | undefined | null): LucideIcon {
    const m = (mode ?? "").toLowerCase()
    if (m.includes("train") || m.includes("rail")) return TrainFront
    if (m.includes("ferry")) return Ship
    if (m.includes("bus")) return Bus
    if (m === "walk") return Footprints
    return MapPin
}

/** "#0073bd" from a feed colour that may lack the '#' or be empty. */
export function hexColor(color: string | undefined | null, fallback: string): string {
    if (!color) return fallback
    return color.startsWith("#") ? color : `#${color}`
}

/** Readable text on a route colour. */
export function textOn(hex: string): string {
    const h = hex.replace("#", "")
    if (h.length !== 6) return "#fff"
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#0D1A12" : "#FFFFFF"
}

/** The mode's icon as an element (not a component made during render). */
export function ModeIcon({ mode, size, color, strokeWidth }: { mode: string | undefined | null; size: number; color: string; strokeWidth?: number }) {
    const m = (mode ?? "").toLowerCase()
    if (m.includes("train") || m.includes("rail")) return <TrainFront size={size} color={color} strokeWidth={strokeWidth} />
    if (m.includes("ferry")) return <Ship size={size} color={color} strokeWidth={strokeWidth} />
    if (m.includes("bus")) return <Bus size={size} color={color} strokeWidth={strokeWidth} />
    if (m === "walk") return <Footprints size={size} color={color} strokeWidth={strokeWidth} />
    return <MapPin size={size} color={color} strokeWidth={strokeWidth} />
}

/** A route tag - iOS `RouteBadge`: the route's colour, or ink when the feed gives none. */
/** iOS `RouteBadge`: the route name, semibold, on its colour (dark grey when it has none). */
export function RouteBadge({ name, color, mode, size = 12, dimmed }: { name: string; color?: string | null; mode?: string | null; size?: number; dimmed?: boolean }) {
    const bg = hexColor(color, "#424242")
    return (
        <View style={[styles.badge, { backgroundColor: bg, minWidth: size * 2, opacity: dimmed ? 0.5 : 1 }]} accessibilityLabel={`${mode ?? "route"} ${name}`}>
            <Text style={{ fontFamily: "Geist-SemiBold", fontSize: size, color: textOn(bg) }} numberOfLines={1}>{name}</Text>
        </View>
    )
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
    const colors = useColors()
    const body = [styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]
    if (!onPress) return <View style={body}>{children}</View>
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [body, pressed && { opacity: 0.7 }]}>
            {children}
        </Pressable>
    )
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
    const colors = useColors()
    return (
        <View style={styles.sectionRow}>
            <Text accessibilityRole="header" style={[type.metaMedium, { color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5 }]}>{children}</Text>
            {action}
        </View>
    )
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
    const colors = useColors()
    return <Text style={[type.meta, { color: colors.mutedForeground }, style as never]}>{children}</Text>
}

export function Button({ title, onPress, variant = "primary", icon, disabled, loading, style, ...rest }: {
    title: string
    onPress?: () => void
    variant?: "primary" | "secondary" | "ghost" | "destructive"
    icon?: LucideIcon
    disabled?: boolean
    loading?: boolean
    style?: StyleProp<ViewStyle>
} & Omit<PressableProps, "style" | "children">) {
    const colors = useColors()
    const bg = variant === "primary" ? colors.primary : variant === "secondary" ? colors.muted : variant === "destructive" ? colors.destructive : "transparent"
    const fg = variant === "primary" ? colors.primaryForeground : variant === "destructive" ? colors.destructiveForeground : colors.foreground
    const Icon = icon
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !!disabled }}
            disabled={disabled || loading}
            onPress={onPress}
            style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, style]}
            {...rest}
        >
            {loading ? <ActivityIndicator color={fg} /> : Icon ? <Icon size={15} color={fg} /> : null}
            <Text style={[type.bodyMedium, { color: fg }]}>{title}</Text>
        </Pressable>
    )
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: LucideIcon }) {
    const colors = useColors()
    const Icon = icon
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: !!selected }}
            onPress={onPress}
            style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.background, borderColor: selected ? colors.primary : colors.border }]}
        >
            {Icon ? <Icon size={11} color={selected ? colors.primaryForeground : colors.foreground} /> : null}
            <Text style={[type.metaMedium, { color: selected ? colors.primaryForeground : colors.foreground }]}>{label}</Text>
        </Pressable>
    )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
    const colors = useColors()
    return (
        <View style={[styles.segmented, { backgroundColor: colors.muted }]} accessibilityRole="tablist">
            {options.map((o) => {
                const selected = o.value === value
                return (
                    <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => onChange(o.value)} style={[styles.segment, selected && { backgroundColor: colors.card }]}>
                        <Text style={[type.metaMedium, { color: selected ? colors.foreground : colors.mutedForeground }]}>{o.label}</Text>
                    </Pressable>
                )
            })}
        </View>
    )
}

export function SearchField(props: TextInputProps & { value: string; onChangeText: (s: string) => void }) {
    const colors = useColors()
    return (
        <TextInput
            placeholderTextColor={colors.mutedForeground}
            autoCorrect={false}
            clearButtonMode="while-editing"
            {...props}
            style={[type.body, styles.search, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }, props.style]}
        />
    )
}

export function EmptyState({ icon, title, body, action }: { icon?: LucideIcon; title: string; body?: string; action?: ReactNode }) {
    const colors = useColors()
    const Icon = icon
    return (
        <View style={[styles.empty, { borderColor: colors.border }]}>
            {Icon ? <Icon size={22} color={colors.mutedForeground} /> : null}
            <Text style={[type.bodyMedium, { color: colors.foreground, textAlign: "center" }]}>{title}</Text>
            {body ? <Text style={[type.meta, { color: colors.mutedForeground, textAlign: "center" }]}>{body}</Text> : null}
            {action}
        </View>
    )
}

export function Loading() {
    const colors = useColors()
    return <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.mutedForeground} />
}

export function ErrorText({ children }: { children: ReactNode }) {
    const colors = useColors()
    return <Text style={[type.meta, { color: colors.danger, marginVertical: spacing.sm }]}>{children}</Text>
}

export function Divider() {
    const colors = useColors()
    return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
}

const styles = StyleSheet.create({
    badge: { alignItems: "center", justifyContent: "center", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: "flex-start" },
    card: { borderWidth: 1, borderRadius: radius.xl, padding: spacing.md },
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg, marginBottom: spacing.sm },
    // iOS `.shad(size: .pill)`: a 44 pt capsule.
    button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: 22 },
    chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 32, borderRadius: 16, borderWidth: 1 },
    segmented: { flexDirection: "row", borderRadius: radius.md, padding: 3 },
    segment: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: radius.sm },
    search: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, minHeight: 44 },
    empty: { alignItems: "center", gap: spacing.sm, padding: spacing.xl, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed" },
})

/** A round translucent button over content (map controls, the header's back / gear) - iOS glass buttons. */
export function GlassButton({ icon: Icon, label, onPress, size = 44, active, children }: { icon?: LucideIcon; label: string; onPress: () => void; size?: number; active?: boolean; children?: ReactNode }) {
    const colors = useColors()
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={6}
            onPress={onPress}
            style={({ pressed }) => [glass.button, { width: size, height: size, borderRadius: size / 2, backgroundColor: active ? colors.primary : colors.card + "EE", borderColor: colors.border }, pressed && { opacity: 0.7 }]}
        >
            {Icon ? <Icon size={size * 0.45} color={active ? colors.primaryForeground : colors.foreground} /> : children}
        </Pressable>
    )
}

/** A pill holding a few icon buttons (the board's bell / star / more). */
export function Capsule({ children }: { children: ReactNode }) {
    const colors = useColors()
    return <View style={[glass.capsule, { backgroundColor: colors.card + "EE", borderColor: colors.border }]}>{children}</View>
}

export function CapsuleButton({ icon: Icon, label, onPress, color, fill }: { icon: LucideIcon; label: string; onPress: () => void; color?: string; fill?: string }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => [glass.capsuleButton, pressed && { opacity: 0.6 }]}>
            <Icon size={18} color={color ?? colors.foreground} fill={fill ?? "transparent"} />
        </Pressable>
    )
}

/** A title-case section heading with an optional trailing action ("Your stops ... Edit"). */
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
    const colors = useColors()
    return (
        <View style={glass.section}>
            <Text accessibilityRole="header" style={[type.cardTitle, { color: colors.foreground }]}>{title}</Text>
            {action && onAction ? (
                <Pressable accessibilityRole="button" hitSlop={8} onPress={onAction}>
                    <Text style={[type.metaMedium, { color: colors.mutedForeground }]}>{action}</Text>
                </Pressable>
            ) : null}
        </View>
    )
}

const glass = StyleSheet.create({
    button: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
    capsule: { flexDirection: "row", alignItems: "center", borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4, height: 44 },
    capsuleButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    section: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: 10 },
})

/**
 * A text button for a stack header (Cancel, Close, Done, Save). iOS 26 wraps
 * header items in its own glass capsule and centres them, so no margins
 * here; Android puts them flush against the title, so it gets a gap.
 */
export function HeaderTextButton({ title, onPress, side, bold, disabled }: { title: string; onPress: () => void; side: "left" | "right"; bold?: boolean; disabled?: boolean }) {
    const colors = useColors()
    return (
        <Text
            accessibilityRole="button"
            accessibilityState={{ disabled: !!disabled }}
            onPress={disabled ? undefined : onPress}
            style={[
                { fontSize: 17, fontFamily: bold ? "Geist-SemiBold" : "Geist-Regular", color: disabled ? colors.mutedForeground : bold ? colors.primary : colors.foreground },
                Platform.OS === "android" && (side === "left" ? { marginRight: spacing.lg } : { marginLeft: spacing.lg }),
            ]}
        >
            {title}
        </Text>
    )
}

/**
 * SwiftUI's `ViewThatFits` over a row of items: shows as many items as fit
 * on one line, dropping from the end - so lower-priority details disappear
 * whole instead of being cut off mid-word. Items are measured once in an
 * invisible copy of the row.
 */
export function FitRow({ items, gap = 10 }: { items: ReactNode[]; gap?: number }) {
    const [width, setWidth] = useState(0)
    const [sizes, setSizes] = useState<number[]>([])
    const measure = (i: number, w: number) =>
        setSizes((prev) => {
            const next = Array.from({ length: items.length }, (_, k) => prev[k] ?? -1)
            if (next[i] === w) return prev
            next[i] = w
            return next
        })
    let shown = items.length
    if (width > 0 && sizes.length === items.length && sizes.every((w) => w >= 0)) {
        let used = 0
        shown = 0
        for (const w of sizes) {
            const next = used + (shown > 0 ? gap : 0) + w
            // A few points' slack: Android can draw text a little wider than it measured.
            if (next > width - 6) break
            used = next
            shown += 1
        }
    }
    return (
        <View style={{ flexDirection: "row", overflow: "hidden" }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            {/* Invisible measuring copy - each item at its natural width. */}
            {/* Wide enough that nothing is squeezed - Android limits absolute children to the parent's width otherwise. */}
            <View style={{ position: "absolute", left: 0, top: 0, width: 4000, opacity: 0, flexDirection: "row", alignItems: "flex-start", gap }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {items.map((item, i) => (
                    <View key={i} style={{ flexShrink: 0 }} onLayout={(e) => measure(i, e.nativeEvent.layout.width)}>{item}</View>
                ))}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap }}>{items.slice(0, shown).map((item, i) => <View key={i} style={{ flexShrink: 0 }}>{item}</View>)}</View>
        </View>
    )
}
