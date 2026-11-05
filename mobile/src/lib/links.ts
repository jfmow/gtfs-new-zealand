import { router } from "expo-router"
import { parseDeepLink, type DeepLink } from "@transit/shared/logic/deeplink"
import { regionBySlug } from "@transit/shared/regions"
import { currentRegion, regions } from "./region"

let switchRegion: ((slug: string) => void) | null = null
/** The region provider registers how to switch region for a link that names one. */
export function setRegionSwitcher(fn: (slug: string) => void) {
    switchRegion = fn
}

/** Routes an inbound link - iOS `DeepLinkRouter`. Returns false for links the app doesn't know. */
export function openDeepLink(raw: string): boolean {
    const link = parseDeepLink(raw)
    if (!link) return false
    routeTo(link)
    return true
}

export function routeTo(link: DeepLink) {
    const region = "region" in link ? link.region : link.kind === "plan" ? link.prefill.region : undefined
    if (region && regionBySlug(regions, region) && !currentRegion().url.endsWith(`/${region}`)) switchRegion?.(region)
    switch (link.kind) {
        case "journey":
            router.push({ pathname: "/journey/[id]", params: { id: link.id } })
            break
        case "trackJourney":
            router.push({ pathname: "/journey/track/[id]", params: { id: link.id } })
            break
        case "trip":
            router.push({ pathname: "/trip/[tripId]", params: { tripId: link.tripId } })
            break
        case "stop":
            router.push({ pathname: "/stop/[query]", params: { query: link.query } })
            break
        case "stopAlerts":
            router.push({ pathname: "/alerts/stop", params: { stop: link.query } })
            break
        case "routeAlerts":
            router.push({ pathname: "/alerts/route", params: { routeId: link.routeId } })
            break
        case "plan":
            router.push({
                pathname: "/(tabs)/planner",
                params: {
                    fromLat: String(link.prefill.startLat), fromLon: String(link.prefill.startLon), fromLabel: link.prefill.startLabel,
                    toLat: String(link.prefill.endLat), toLon: String(link.prefill.endLon), toLabel: link.prefill.endLabel,
                    arriveBy: link.prefill.timeType === "arriveat" ? "1" : "",
                },
            })
            break
        case "notifications":
            router.push("/(tabs)/updates")
            break
    }
}
