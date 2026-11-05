/**
 * Inbound links - share links, resumed journeys, push deeplinks. A port of
 * iOS `TransitCore/API/DeepLink.swift`. Accepts:
 * - the custom scheme (`transit://journey?id=...&region=at`)
 * - a universal / App Link (`https://trains.suddsy.dev/trip?...`)
 * - a bare web path (`/?s=Britomart 11814`, `/vehicles?tripId=...`) - what
 *   the backend puts in every push payload's `url`.
 */

export interface PlanPrefill {
    startLat: number
    startLon: number
    startLabel: string
    endLat: number
    endLon: number
    endLabel: string
    maxWalkKm?: number
    walkSpeed?: number
    maxTransfers?: number
    minResults?: number
    /** "now" | "leaveat" | "arriveat" (web vocabulary). */
    timeType?: string
    onlyRoutes: string[]
    region?: string
    /** When to plan for; undefined = now. */
    date?: Date
}

export type DeepLink =
    | { kind: "journey"; id: string; region?: string }
    | { kind: "trackJourney"; id: string; region?: string }
    | { kind: "trip"; tripId: string; region?: string }
    | { kind: "stop"; query: string }
    | { kind: "stopAlerts"; query: string }
    | { kind: "routeAlerts"; routeId: string }
    | { kind: "plan"; prefill: PlanPrefill }
    | { kind: "notifications" }

/** Custom URL schemes the app answers to (the SwiftUI app's, and the Expo dev build's). */
const APP_SCHEMES = ["transit", "transit-expo"]

function num(v: string | undefined): number | undefined {
    if (v === undefined || v === "") return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
}

function parsePrefill(q: Record<string, string>): PlanPrefill | null {
    const startLat = num(q.startLat), startLon = num(q.startLon), endLat = num(q.endLat), endLon = num(q.endLon)
    if (startLat === undefined || startLon === undefined || endLat === undefined || endLon === undefined) return null
    const maxTransfers = num(q.maxTransfers)
    const minResults = num(q.minResults)
    const date = q.date ? new Date(q.date) : undefined
    return {
        startLat, startLon, startLabel: q.startLabel || "Start",
        endLat, endLon, endLabel: q.endLabel || "Destination",
        maxWalkKm: num(q.maxWalkKm),
        walkSpeed: num(q.walkSpeed),
        maxTransfers: maxTransfers !== undefined && Number.isInteger(maxTransfers) ? maxTransfers : undefined,
        minResults: minResults !== undefined && Number.isInteger(minResults) ? minResults : undefined,
        timeType: q.timeType,
        onlyRoutes: (q.onlyRoutes ?? "").split(",").filter(Boolean),
        region: q.region,
        date: date && !isNaN(date.getTime()) ? date : undefined,
    }
}

/** Splits a link into its lower-cased route and decoded query, tolerating raw spaces. */
function splitLink(raw: string): { route: string; originalPath: string; query: Record<string, string> } | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    let rest = trimmed
    let scheme = ""
    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(rest)
    if (schemeMatch) {
        scheme = schemeMatch[1].toLowerCase()
        rest = rest.slice(schemeMatch[0].length)
    }
    const hashAt = rest.indexOf("#")
    if (hashAt >= 0) rest = rest.slice(0, hashAt)
    const qAt = rest.indexOf("?")
    let path = qAt >= 0 ? rest.slice(0, qAt) : rest
    const search = qAt >= 0 ? rest.slice(qAt + 1) : ""

    if (scheme && !APP_SCHEMES.includes(scheme)) {
        // http(s): drop the host
        const slash = path.indexOf("/")
        path = slash >= 0 ? path.slice(slash) : ""
    }
    // For the app scheme the host is the route: transit://journey?... -> "journey"
    const originalPath = path.replace(/^\/+|\/+$/g, "")
    const query: Record<string, string> = {}
    for (const pair of search.split("&")) {
        if (!pair) continue
        const eq = pair.indexOf("=")
        const k = eq >= 0 ? pair.slice(0, eq) : pair
        const v = eq >= 0 ? pair.slice(eq + 1) : ""
        const decode = (s: string) => {
            try {
                return decodeURIComponent(s.replace(/\+/g, " "))
            } catch {
                return s
            }
        }
        query[decode(k)] = decode(v)
    }
    return { route: originalPath.toLowerCase(), originalPath, query }
}

export function parseDeepLink(raw: string): DeepLink | null {
    const parts = splitLink(raw)
    if (!parts) return null
    const { route, originalPath, query: q } = parts
    switch (route) {
        case "journey": {
            if (!q.id) return null
            const track = q.track === "1" || q.track === "true"
            return { kind: track ? "trackJourney" : "journey", id: q.id, region: q.region || undefined }
        }
        case "trip":
        case "vehicles":
            return q.tripId ? { kind: "trip", tripId: q.tripId, region: q.region || undefined } : null
        case "":
        case "stop":
            return q.s ? { kind: "stop", query: q.s } : null
        case "map":
            if (q.tripId) return { kind: "trip", tripId: q.tripId, region: q.region || undefined }
            if (q.s) return { kind: "stop", query: q.s }
            return null
        case "alerts":
            return q.s ? { kind: "stopAlerts", query: q.s } : null
        case "plan": {
            const prefill = parsePrefill(q)
            return prefill ? { kind: "plan", prefill } : null
        }
        case "notifications":
        case "settings":
            return { kind: "notifications" }
        default:
            if (route.startsWith("alerts/route/")) {
                // Route ids are case-sensitive - keep the original casing.
                const id = originalPath.split("/").pop() ?? ""
                return id ? { kind: "routeAlerts", routeId: id } : null
            }
            return null
    }
}

/** The plan id of a `/journey` link, tracked or not. */
export function deepLinkJourneyId(link: DeepLink | null): string | null {
    return link && (link.kind === "journey" || link.kind === "trackJourney") ? link.id : null
}

/** A `/journey?...&replace=1` link - a better route for the trip already being tracked (the reroute push). */
export function replacesTrackedJourney(raw: string): boolean {
    const link = parseDeepLink(raw)
    if (!deepLinkJourneyId(link)) return false
    const parts = splitLink(raw)
    return parts?.query.replace === "1" || parts?.query.replace === "true"
}
