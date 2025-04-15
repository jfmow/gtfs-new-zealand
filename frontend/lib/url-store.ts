export type UrlOption = {
    url: string
    displayName: string
    logoUrl: string
    textColor: string
    devOnly?: boolean
}

export const urlOptions: UrlOption[] = [
    { url: "https://trainapi.suddsy.dev/at", displayName: "Auckland Transport", logoUrl: "/provider logos/at.png", textColor: "#0073bd" },
    { url: "https://trainapi.suddsy.dev/wel", displayName: "Wellington - Metlink", logoUrl: "/provider logos/metlink.png", textColor: "#ced940" },
    { url: "https://trainapi.suddsy.dev/christ", displayName: "Christchurch - Metro", logoUrl: "/provider logos/metro.png", textColor: "#2a286b" },
]

class UrlStore {
    private static instance: UrlStore
    private _currentUrl: UrlOption
    private listeners: Set<(url: UrlOption) => void> = new Set()

    private constructor() {


        const defaultUrl = urlOptions[0]

        // Initialize with saved URL or default
        const savedUrl = typeof window !== "undefined" ? localStorage.getItem("selectedUrl") : null
        this._currentUrl = savedUrl ? JSON.parse(savedUrl) : defaultUrl
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

