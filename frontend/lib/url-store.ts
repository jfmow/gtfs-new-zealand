type LatLng = [number, number]
export type UrlOption = {
    url: string
    displayName: string
    logoUrl: string
    textColor: string
    defaultMapCenter: LatLng
}

export const urlOptions: UrlOption[] = [
    { url: "https://trainapi.suddsy.dev/at", displayName: "Auckland Transport", logoUrl: "/provider logos/at.png", textColor: "#0073bd", defaultMapCenter: [-36.85405453502828, 174.76303318519342] },
    { url: "https://trainapi.suddsy.dev/wel", displayName: "Wellington - Metlink", logoUrl: "/provider logos/metlink.png", textColor: "#ced940", defaultMapCenter: [-41.292395707702504, 174.77880205575084] },
    { url: "https://trainapi.suddsy.dev/christ", displayName: "Christchurch - Metro", logoUrl: "/provider logos/metro.png", textColor: "#2a286b", defaultMapCenter: [-43.530792707375035, 172.6366263226067] },
]

class UrlStore {
    private static instance: UrlStore
    private _currentUrl: UrlOption
    private listeners: Set<(url: UrlOption) => void> = new Set()

    private constructor() {

        let url: UrlOption
        url = urlOptions[0]

        // Initialize with saved URL or default
        const savedUrl = typeof window !== "undefined" ? localStorage.getItem("selectedUrl") : null
        if (savedUrl && Object.keys(JSON.parse(savedUrl)).length === Object.keys(url).length) {
            url = JSON.parse(savedUrl)
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

