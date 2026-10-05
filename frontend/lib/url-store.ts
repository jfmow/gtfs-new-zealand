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

const COUNTRY_NAMES: Record<Country, string> = { NZ: "New Zealand", AU: "Australia" }

/** Options split by country, NZ first, for the region pickers. */
export function groupByCountry(options: UrlOption[]): { country: Country; name: string; options: UrlOption[] }[] {
    return (Object.keys(COUNTRY_NAMES) as Country[])
        .map((country) => ({ country, name: COUNTRY_NAMES[country], options: options.filter((o) => o.country === country) }))
        .filter((group) => group.options.length > 0)
}

/** The current region's timezone - transit times are shown in it, not the browser's. */
export function regionTimeZone(): string {
    return urlStore.currentUrl.timeZone
}

export function hasRealtime(option: UrlOption): boolean {
    return option.realtime !== false
}

const productionOptions: UrlOption[] = [
    { url: "https://trainapi.suddsy.dev/at", displayName: "Auckland Transport", logoUrl: "/provider logos/at.png", textColor: "#0073bd", defaultMapCenter: [-36.85405453502828, 174.76303318519342], country: "NZ", timeZone: "Pacific/Auckland" },
    { url: "https://trainapi.suddsy.dev/wel", displayName: "Wellington – Metlink", logoUrl: "/provider logos/metlink.png", textColor: "#ced940", defaultMapCenter: [-41.292395707702504, 174.77880205575084], country: "NZ", timeZone: "Pacific/Auckland" },
    { url: "https://trainapi.suddsy.dev/christ", displayName: "Christchurch – Metro", logoUrl: "/provider logos/metro.png", textColor: "#2a286b", defaultMapCenter: [-43.530792707375035, 172.6366263226067], country: "NZ", timeZone: "Pacific/Auckland" },
    { url: "https://trainapi.suddsy.dev/otago", displayName: "Otago – ORC", logoUrl: "/provider logos/orc.png", textColor: "#00ff00", defaultMapCenter: [-45.8788, 170.5028], country: "NZ", timeZone: "Pacific/Auckland", realtime: false },
    { url: "https://trainapi.suddsy.dev/seq", displayName: "South East Queensland – Translink", logoUrl: "/provider logos/translink.png", textColor: "#ff0000", defaultMapCenter: [-27.4698, 153.0251], country: "AU", timeZone: "Australia/Brisbane" },
]

const devOptions: UrlOption[] = [
    { url: "http://localhost:8090/at", displayName: "Dev – Auckland", logoUrl: "/provider logos/at.png", textColor: "#0073bd", defaultMapCenter: [-36.85405453502828, 174.76303318519342], country: "NZ", timeZone: "Pacific/Auckland" },
    { url: "http://localhost:8090/wel", displayName: "Dev – Wellington", logoUrl: "/provider logos/metlink.png", textColor: "#ced940", defaultMapCenter: [-41.292395707702504, 174.77880205575084], country: "NZ", timeZone: "Pacific/Auckland" },
    { url: "http://localhost:8090/christ", displayName: "Dev – Christchurch", logoUrl: "/provider logos/metro.png", textColor: "#2a286b", defaultMapCenter: [-43.530792707375035, 172.6366263226067], country: "NZ", timeZone: "Pacific/Auckland" },
    { url: "http://localhost:8090/seq", displayName: "Dev – SEQ", logoUrl: "/provider logos/translink.png", textColor: "#ff0000", defaultMapCenter: [-27.4698, 153.0251], country: "AU", timeZone: "Australia/Brisbane" },
    { url: "http://localhost:8090/otago", displayName: "Dev – Otago", logoUrl: "/provider logos/orc.png", textColor: "#00ff00", defaultMapCenter: [-45.8788, 170.5028], country: "NZ", timeZone: "Pacific/Auckland", realtime: false },
]

export const urlOptions: UrlOption[] =
    process.env.NODE_ENV === "development"
        ? [...productionOptions, ...devOptions]
        : productionOptions

/**
 * A UrlOption's `url` already ends in its region path segment (…/at, …/wel, …/christ),
 * which is already unique per region - reuse it as a stable, shareable slug instead of
 * introducing a second identifier that could drift out of sync.
 */
export function getRegionSlug(option: UrlOption): string {
    const parts = option.url.split("/").filter(Boolean)
    return parts[parts.length - 1] || ""
}

export function getUrlOptionBySlug(slug: string): UrlOption | undefined {
    return urlOptions.find((o) => getRegionSlug(o) === slug)
}

class UrlStore {
    private static instance: UrlStore
    private _currentUrl: UrlOption
    private listeners: Set<(url: UrlOption) => void> = new Set()

    private constructor() {
        let url: UrlOption = urlOptions[0]

        if (typeof window !== "undefined") {
            const raw = localStorage.getItem("selectedUrl")
            if (raw) {
                try {
                    const parsed = JSON.parse(raw) as UrlOption
                    const match = urlOptions.find((o) => o.url === parsed.url)
                    if (match) url = match
                } catch {
                    // ignore malformed saved value
                }
            }
        }

        this._currentUrl = url
    }

    public static getInstance(): UrlStore {
        if (!UrlStore.instance) {
            UrlStore.instance = new UrlStore()
        }
        return UrlStore.instance
    }

    get currentUrl(): UrlOption {
        return this._currentUrl
    }

    set currentUrl(newUrl: UrlOption) {
        this._currentUrl = newUrl
        if (typeof window !== "undefined") {
            localStorage.setItem("selectedUrl", JSON.stringify(newUrl))
        }
        this.notifyListeners()
    }

    subscribe(listener: (url: UrlOption) => void) {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    private notifyListeners() {
        this.listeners.forEach((listener) => listener(this._currentUrl))
    }
}

export const urlStore = UrlStore.getInstance()
