import { useWindowDimensions, type ViewStyle } from "react-native"

/**
 * Tablet layouts (iPad, Android tablets) - the SwiftUI app's
 * `horizontalSizeClass == .regular`. They switch on the window's width,
 * never the device, so an iPad app in a narrow Split View or Slide Over
 * window keeps the phone layout, and a landscape phone never gets the
 * tablet one (phones are portrait-only).
 *
 * 700 pt sits between the narrowest regular-width iPad window (iPad mini
 * portrait, 744) and the widest compact one (half of a 13" iPad, ~680).
 */
export const WIDE_MIN_WIDTH = 700

/** Pages (lists, forms, settings) stop growing past this - iOS `readableContentWidth()`. */
export const READABLE_WIDTH = 680

export type Layout = {
    /** Tablet layout: side panels instead of drawers, split views, two columns. */
    wide: boolean
    width: number
    height: number
    /** Width of a side panel over a map (trackers, the Map tab's stop board) - iOS `MapSidePanel`. */
    panelWidth: number
    /** The list column of a split view (Planner, Updates). */
    listWidth: number
}

export function useLayout(): Layout {
    const { width, height } = useWindowDimensions()
    const wide = width >= WIDE_MIN_WIDTH
    return {
        wide,
        width,
        height,
        panelWidth: Math.round(Math.min(420, Math.max(340, width * 0.38))),
        listWidth: Math.round(Math.min(440, Math.max(340, width * 0.4))),
    }
}

/** A scroll view's content style that centres it at the readable width on wide windows. */
export function readable(wide: boolean, maxWidth = READABLE_WIDTH): ViewStyle {
    return wide ? { width: "100%", maxWidth, alignSelf: "center" } : {}
}
