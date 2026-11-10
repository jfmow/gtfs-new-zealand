/**
 * The regions the apps can show. Keep in sync with `backend/main.go` and the
 * widget's copy in `mobile/targets/widgets/WidgetSupport.swift`.
 *
 * Which region is *selected* is platform state (localStorage on web, device
 * storage in the Expo app), so it lives in each app, not here.
 */

type LatLng = [number, number]
export type Country = "NZ" | "AU"

export type UrlOption = {
    url: string
    displayName: string
    logoUrl: string
    textColor: string
    defaultMapCenter: LatLng
    /** Groups the region picker. */
    country: Country
    /** IANA zone the feed's timetable is written in - times are shown in it. */
    timeZone: string
    /** False for a region that publishes no GTFS-RT (live vehicles, alerts) - timetable only. Defaults to true. */
    realtime?: boolean
}

/** Same thing, named for new code. */
export type Region = UrlOption

const COUNTRY_NAMES: Record<Country, string> = { NZ: "New Zealand", AU: "Australia" }

/** Options split by country, NZ first, for the region pickers. */
export function groupByCountry(options: UrlOption[]): { country: Country; name: string; options: UrlOption[] }[] {
    return (Object.keys(COUNTRY_NAMES) as Country[])
        .map((country) => ({ country, name: COUNTRY_NAMES[country], options: options.filter((o) => o.country === country) }))
        .filter((group) => group.options.length > 0)
}

export function hasRealtime(option: UrlOption): boolean {
    return option.realtime !== false
}

export const PRODUCTION_REGIONS: UrlOption[] = [
    { url: "https://trainapi.suddsy.dev/at", displayName: "Auckland Transport", logoUrl: "/provider logos/at.png", textColor: "#0073bd", defaultMapCenter: [-36.85405453502828, 174.76303318519342], country: "NZ", timeZone: "Pacific/Auckland" },
    { url: "https://trainapi.suddsy.dev/wel", displayName: "Wellington – Metlink", logoUrl: "/provider logos/metlink.png", textColor: "#ced940", defaultMapCenter: [-41.292395707702504, 174.77880205575084], country: "NZ", timeZone: "Pacific/Auckland" },
    { url: "https://trainapi.suddsy.dev/christ", displayName: "Christchurch – Metro", logoUrl: "/provider logos/metro.png", textColor: "#2a286b", defaultMapCenter: [-43.530792707375035, 172.6366263226067], country: "NZ", timeZone: "Pacific/Auckland" },
    { url: "https://trainapi.suddsy.dev/otago", displayName: "Otago – ORC", logoUrl: "/provider logos/orc.png", textColor: "#00ff00", defaultMapCenter: [-45.8788, 170.5028], country: "NZ", timeZone: "Pacific/Auckland", realtime: false },
    { url: "https://trainapi.suddsy.dev/seq", displayName: "South East Queensland – Translink", logoUrl: "/provider logos/translink.png", textColor: "#ff0000", defaultMapCenter: [-27.4698, 153.0251], country: "AU", timeZone: "Australia/Brisbane" },
]

/** Same regions against a local backend. `localhost` only works from a simulator or browser on the dev machine. */
export function devRegions(host = "http://localhost:8090"): UrlOption[] {
    return [
        { url: `${host}/at`, displayName: "Dev – Auckland", logoUrl: "/provider logos/at.png", textColor: "#0073bd", defaultMapCenter: [-36.85405453502828, 174.76303318519342], country: "NZ", timeZone: "Pacific/Auckland" },
        { url: `${host}/wel`, displayName: "Dev – Wellington", logoUrl: "/provider logos/metlink.png", textColor: "#ced940", defaultMapCenter: [-41.292395707702504, 174.77880205575084], country: "NZ", timeZone: "Pacific/Auckland" },
        { url: `${host}/christ`, displayName: "Dev – Christchurch", logoUrl: "/provider logos/metro.png", textColor: "#2a286b", defaultMapCenter: [-43.530792707375035, 172.6366263226067], country: "NZ", timeZone: "Pacific/Auckland" },
        { url: `${host}/seq`, displayName: "Dev – SEQ", logoUrl: "/provider logos/translink.png", textColor: "#ff0000", defaultMapCenter: [-27.4698, 153.0251], country: "AU", timeZone: "Australia/Brisbane" },
        { url: `${host}/otago`, displayName: "Dev – Otago", logoUrl: "/provider logos/orc.png", textColor: "#00ff00", defaultMapCenter: [-45.8788, 170.5028], country: "NZ", timeZone: "Pacific/Auckland", realtime: false },
    ]
}

/** The regions to offer: production, plus the local ones in development. */
export function regionOptions(dev: boolean, devHost?: string): UrlOption[] {
    return dev ? [...PRODUCTION_REGIONS, ...devRegions(devHost)] : PRODUCTION_REGIONS
}

/**
 * A UrlOption's `url` already ends in its region path segment (…/at, …/wel, …/christ),
 * which is already unique per region - reuse it as a stable, shareable slug instead of
 * introducing a second identifier that could drift out of sync.
 */
export function getRegionSlug(option: UrlOption): string {
    const parts = option.url.split("/").filter(Boolean)
    return parts[parts.length - 1] || ""
}

export function regionBySlug(options: UrlOption[], slug: string): UrlOption | undefined {
    return options.find((o) => getRegionSlug(o) === slug)
}
