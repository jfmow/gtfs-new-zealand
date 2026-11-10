import { SymbolView, type AndroidSymbol, type SFSymbol } from "expo-symbols"
import medium from "expo-symbols/androidWeights/medium"
import type { ComponentType } from "react"
import type { ColorValue, StyleProp, ViewStyle } from "react-native"

/**
 * The app's icons: the exact SF Symbols the SwiftUI app uses on iOS, and
 * the closest Google Material Symbol on Android (both via `expo-symbols`).
 *
 * Each export keeps the name and props of the Lucide icon it replaced
 * (`size`, `color`, `fill`, `style`), so screens import from here instead of
 * `lucide-react-native`. A `fill` other than "none"/"transparent" picks the
 * symbol's `.fill` variant, tinted with that colour - Lucide drew `color` as
 * the outline and `fill` inside, which SF Symbols express as one filled glyph.
 */
export interface IconProps {
    size?: number
    color?: ColorValue
    fill?: ColorValue
    /** Accepted for Lucide compatibility; SF Symbols use `weight` instead. */
    strokeWidth?: number
    style?: StyleProp<ViewStyle>
    accessibilityLabel?: string
}

export type LucideIcon = ComponentType<IconProps>

type Weight = "regular" | "medium" | "semibold" | "bold"

function make(ios: SFSymbol, android: AndroidSymbol, opts: { filled?: SFSymbol; weight?: Weight } = {}): LucideIcon {
    function Icon({ size = 24, color, fill, style, accessibilityLabel }: IconProps) {
        const filled = !!fill && fill !== "none" && fill !== "transparent" && !!opts.filled
        return (
            <SymbolView
                name={{ ios: filled ? opts.filled! : ios, android, web: android }}
                size={size}
                tintColor={(filled ? fill : color) ?? "#000"}
                weight={{ ios: opts.weight ?? "medium", android: medium }}
                style={style}
                accessible={!!accessibilityLabel}
                accessibilityLabel={accessibilityLabel}
            />
        )
    }
    Icon.displayName = `Icon(${ios})`
    return Icon
}

// Navigation and chrome
export const ChevronRight = make("chevron.right", "chevron_right", { weight: "semibold" })
export const ChevronLeft = make("chevron.left", "chevron_left", { weight: "semibold" })
export const ChevronDown = make("chevron.down", "expand_more", { weight: "semibold" })
export const ChevronUp = make("chevron.up", "expand_less", { weight: "semibold" })
export const X = make("xmark", "close", { weight: "semibold" })
export const Check = make("checkmark", "check", { weight: "semibold" })
export const Plus = make("plus", "add", { weight: "semibold" })
export const Minus = make("minus", "remove", { weight: "semibold" })
export const Ellipsis = make("ellipsis", "more_horiz", { weight: "semibold" })
export const EllipsisCircle = make("ellipsis.circle", "more_horiz")
export const Settings = make("gearshape", "settings", { filled: "gearshape.fill" })
export const Cloud = make("icloud", "cloud", { filled: "icloud.fill" })
export const Search = make("magnifyingglass", "search")
export const Share2 = make("square.and.arrow.up", "ios_share")
export const Trash2 = make("trash", "delete", { filled: "trash.fill" })
export const RefreshCw = make("arrow.clockwise", "refresh", { weight: "semibold" })
export const Expand = make("arrow.up.left.and.arrow.down.right", "open_in_full", { weight: "semibold" })
export const SlidersHorizontal = make("slider.horizontal.3", "tune")
export const ListFilter = make("line.3.horizontal.decrease.circle", "filter_list")
export const Palette = make("paintpalette", "palette", { filled: "paintpalette.fill" })
export const Bookmark = make("bookmark", "bookmark", { filled: "bookmark.fill" })
export const Star = make("star", "star", { filled: "star.fill" })
export const Hash = make("number.circle", "tag")

// Arrows
export const ArrowUp = make("arrow.up", "arrow_upward", { weight: "semibold" })
export const ArrowDown = make("arrow.down", "arrow_downward", { weight: "semibold" })
export const ArrowRight = make("arrow.right", "arrow_forward", { weight: "semibold" })
export const ArrowUpDown = make("arrow.up.arrow.down", "swap_vert", { weight: "semibold" })
export const ArrowLeftRight = make("arrow.left.arrow.right", "swap_horiz", { weight: "semibold" })
export const CornerUpRight = make("arrow.turn.up.right", "turn_right", { weight: "semibold" })
export const CornerUpLeft = make("arrow.turn.up.left", "turn_left", { weight: "semibold" })

// Places and location
export const MapPin = make("mappin", "location_on", { filled: "mappin.circle.fill" })
export const MapPinOff = make("mappin.slash", "location_off")
export const House = make("house", "home", { filled: "house.fill" })
export const Briefcase = make("briefcase", "work", { filled: "briefcase.fill" })
export const Flag = make("flag.checkered", "flag")
export const ArrowDownCircle = make("arrow.down.circle", "download_for_offline")
export const LocateFixed = make("location", "my_location", { filled: "location.fill" })
export const LocationNorthCircle = make("location.north.circle", "explore", { filled: "location.north.circle.fill" })
export const Navigation = make("location.north.fill", "navigation")
export const Navigation2 = make("location.north.fill", "navigation")
export const ScanLine = make("location.viewfinder", "location_searching")
export const Route = make("point.topleft.down.to.point.bottomright.curvepath", "route")

// Transport and people
export const Bus = make("bus.fill", "directions_bus")
export const TrainFront = make("tram.fill", "train")
export const Ship = make("ferry.fill", "directions_boat")
export const Bike = make("bicycle", "directions_bike")
export const Footprints = make("figure.walk", "directions_walk")
export const Accessibility = make("figure.roll", "accessible")
export const User = make("person.fill", "person")

// Time, alerts and status
export const Clock = make("clock", "schedule", { filled: "clock.fill" })
export const AlarmClock = make("alarm", "alarm", { filled: "alarm.fill" })
export const Bell = make("bell", "notifications", { filled: "bell.fill" })
export const BellRing = make("bell.badge", "notifications_active", { filled: "bell.badge.fill" })
export const TriangleAlert = make("exclamationmark.triangle", "warning", { filled: "exclamationmark.triangle.fill" })
export const MessageSquareWarning = make("exclamationmark.bubble", "feedback", { filled: "exclamationmark.bubble.fill" })
export const CircleCheck = make("checkmark.circle.fill", "check_circle")
export const Rss = make("dot.radiowaves.up.forward", "sensors", { weight: "semibold" })
export const WifiOff = make("antenna.radiowaves.left.and.right.slash", "wifi_tethering_off")
