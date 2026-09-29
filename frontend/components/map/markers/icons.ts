import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ArrowDown, Backpack, Bus, Flag, MapPin, Ship, TrainFront, type LucideIcon } from "lucide-react"

/**
 * Map marker artwork, drawn with the same Lucide icons the lists use
 * (`StopModeTile`, the planner's mode chips) so the map and the rest of the
 * UI read as one set. Markers are plain HTML strings (MapLibre markers are
 * DOM elements), so each icon is rendered to SVG markup once and cached.
 */
const svgCache = new Map<string, string>()

function iconSvg(Icon: LucideIcon, size: number, color: string): string {
    const key = `${Icon.displayName}|${size}|${color}`
    let svg = svgCache.get(key)
    if (!svg) {
        svg = renderToStaticMarkup(createElement(Icon, { size, color, strokeWidth: 2.25, "aria-hidden": true }))
        svgCache.set(key, svg)
    }
    return svg
}

const FOREGROUND = "#18181b"
const SHADOW = "0 1px 4px rgba(15, 23, 42, 0.35)"

/** Stop-mode colours, matching the iOS map's stop pins. */
const MODE_COLORS: Record<string, string> = {
    train: "#0073bd",
    ferry: "#2a286b",
    bus: "#64748b",
}

export function modeIcon(mode: string): LucideIcon {
    if (mode === "train") return TrainFront
    if (mode === "ferry") return Ship
    if (mode === "school bus") return Backpack
    return Bus
}

/** "RRGGBB" / "#RRGGBB" -> "#rrggbb", or undefined for an empty/invalid value. */
export function normalizeHex(value?: string): string | undefined {
    const hex = value?.trim().replace(/^#/, "")
    return hex && /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : undefined
}

/** Black or white, whichever reads better on `hex`. */
function contrastOn(hex: string): string {
    const n = parseInt(hex.slice(1), 16)
    const channel = (c: number) => {
        const v = c / 255
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    const luminance = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
    return luminance > 0.4 ? FOREGROUND : "#ffffff"
}

/** A filled circle with a white ring and an icon in the middle. */
function badge(Icon: LucideIcon, fill: string, size: number): string {
    const fg = contrastOn(fill)
    return `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${fill};border:2px solid #fff;box-shadow:${SHADOW};box-sizing:border-box;display:flex;align-items:center;justify-content:center;">${iconSvg(Icon, Math.round(size * 0.5), fg)}</div>`
}

/**
 * A live vehicle: its mode icon on its route colour (dark when the route has
 * none), kept upright. Bearing is shown as a small pointer riding round the
 * edge of the badge, rather than by spinning the icon on its side.
 */
export function vehicleMarkerHtml(mode: string, color: string | undefined, bearing: number | undefined, size: number): string {
    const fill = normalizeHex(color) ?? FOREGROUND
    // Bearing 0 is indistinguishable from "no data" (proto3 default).
    const pointer = bearing !== undefined && bearing !== 0
        ? `<div style="position:absolute;inset:-7px;transform:rotate(${bearing}deg);pointer-events:none;">
             <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:7px solid ${fill};filter:drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff);"></div>
           </div>`
        : ""
    return `<div style="position:relative;width:${size}px;height:${size}px;">${pointer}${badge(modeIcon(mode), fill, size)}</div>`
}

/** A stop pin: mode icon on its mode colour, with a tail pointing at the stop. */
export function stopPinHtml(mode: string, size: number): string {
    return pinHtml(modeIcon(mode), MODE_COLORS[mode] ?? MODE_COLORS.bus, size)
}

function pinHtml(Icon: LucideIcon, fill: string, size: number): string {
    return `<div style="position:relative;width:${size}px;height:${size + 6}px;">
        ${badge(Icon, fill, size)}
        <div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid #fff;"></div>
    </div>`
}

/** A plain dot marking a stop along a route. */
function dotHtml(fill: string, ring: string, size: number): string {
    return `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${fill};border:2.5px solid ${ring};box-shadow:${SHADOW};box-sizing:border-box;"></div>`
}

export type MarkerIcon =
    | "bus" | "train" | "ferry" | "school bus"
    | "dot" | "dot gray" | "pin" | "user"
    | "stop marker" | "end marker" | "marked stop marker" | "next stop marker"
    | "start marker" | "current stop marker" | "hidden"
    | "train stop marker" | "bus stop marker" | "ferry stop marker"

/** Whether an icon marks an exact point (centred on it) rather than hanging above it like a pin. */
export function isCentredIcon(icon: MarkerIcon): boolean {
    return icon === "dot" || icon === "dot gray" || icon === "current stop marker" || icon === "start marker"
        || icon === "user" || icon === "hidden" || icon === "bus" || icon === "train" || icon === "ferry" || icon === "school bus"
}

/** Artwork for every non-vehicle marker kind. */
export function staticMarkerHtml(icon: MarkerIcon): string {
    switch (icon) {
        case "dot": return dotHtml("#ffffff", FOREGROUND, 14)
        case "dot gray": return dotHtml("#d4d4d8", "#a1a1aa", 12)
        case "start marker": return dotHtml("#22c55e", "#ffffff", 16)
        case "current stop marker": return dotHtml("#f59e0b", "#ffffff", 16)
        case "user": return dotHtml("#3b82f6", "#ffffff", 18)
        case "next stop marker": return pinHtml(ArrowDown, "#3b82f6", 26)
        case "marked stop marker": return pinHtml(MapPin, FOREGROUND, 26)
        case "stop marker": return pinHtml(MapPin, "#64748b", 26)
        case "pin": return pinHtml(MapPin, "#ef4444", 26)
        case "end marker": return pinHtml(Flag, "#ef4444", 26)
        case "train stop marker": return stopPinHtml("train", 26)
        case "bus stop marker": return stopPinHtml("bus", 26)
        case "ferry stop marker": return stopPinHtml("ferry", 26)
        default: return ""
    }
}

/** The user's own position: a blue dot with a white ring. */
export const USER_LOCATION_HTML = staticMarkerHtml("user")
