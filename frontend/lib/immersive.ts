import { useEffect } from "react"

const counts: Record<string, number> = {}

/** While `active`, sets `attribute` on <html> - counted, so overlapping users don't clear it early. */
function useHtmlFlag(attribute: string, active: boolean) {
    useEffect(() => {
        if (!active) return
        counts[attribute] = (counts[attribute] ?? 0) + 1
        document.documentElement.setAttribute(attribute, "")
        return () => {
            counts[attribute] = Math.max(0, (counts[attribute] ?? 1) - 1)
            if (counts[attribute] === 0) document.documentElement.removeAttribute(attribute)
        }
    }, [attribute, active])
}

/**
 * While `active`, marks the page "immersive" - a full-screen map (a tracker)
 * is up, so the header, tab bar and resume card hide (see `data-immersive`
 * in globals.css), as the iOS app hides its bars there.
 */
export function useImmersive(active: boolean) {
    useHtmlFlag("data-immersive", active)
}

/**
 * While `active`, hides the "resume journey" card - a journey's own detail or
 * tracking is on screen, so the card would just point back at it (iOS hides
 * it the same way). Every layout, not just phones.
 */
export function useHideResumePrompt(active: boolean) {
    useHtmlFlag("data-journey-open", active)
}
