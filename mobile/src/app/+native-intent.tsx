import { parseDeepLink } from "@transit/shared/logic/deeplink"

/**
 * Rewrites inbound URLs (universal / App Links, the custom scheme, push
 * payload paths) to app routes before Expo Router matches them - the web's
 * `/journey?id=`, `/?s=`, `/vehicles?tripId=` don't share the app's paths.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
    try {
        const link = parseDeepLink(path)
        if (!link) return path
        const q = (params: Record<string, string>) => "?" + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
        switch (link.kind) {
            case "journey": return `/journey/${encodeURIComponent(link.id)}`
            case "trackJourney": return `/journey/track/${encodeURIComponent(link.id)}`
            case "trip": return `/trip/${encodeURIComponent(link.tripId)}${link.stop ? q({ stop: link.stop }) : ""}`
            case "stop": return `/stop/${encodeURIComponent(link.query)}`
            case "stopAlerts": return `/alerts/stop${q({ stop: link.query })}`
            case "routeAlerts": return `/alerts/route${q({ routeId: link.routeId })}`
            case "notifications": return "/updates"
            case "plan": {
                const p = link.prefill
                return `/planner${q({ fromLat: String(p.startLat), fromLon: String(p.startLon), fromLabel: p.startLabel, toLat: String(p.endLat), toLon: String(p.endLon), toLabel: p.endLabel, arriveBy: p.timeType === "arriveat" ? "1" : "" })}`
            }
        }
    } catch {
        return "/"
    }
    return path
}
