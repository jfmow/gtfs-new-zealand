import { regionOptions, regionBySlug, type UrlOption } from "@transit/shared/regions"

// The region table lives in the shared package (packages/shared/src/regions.ts).
// Which region is selected is browser state, so it stays here.
export { groupByCountry, hasRealtime, getRegionSlug, type Country, type UrlOption } from "@transit/shared/regions"

/** The current region's timezone - transit times are shown in it, not the browser's. */
export function regionTimeZone(): string {
    return urlStore.currentUrl.timeZone
}

export const urlOptions: UrlOption[] = regionOptions(process.env.NODE_ENV === "development")

export function getUrlOptionBySlug(slug: string): UrlOption | undefined {
    return regionBySlug(urlOptions, slug)
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
