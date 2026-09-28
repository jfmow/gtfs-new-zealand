/**
 * The native iPhone app (ios/). It registers the `transit://` scheme and its
 * DeepLink parser mirrors the web's routes + query params, so any web path
 * maps straight across: `/journey?id=…` -> `transit://journey?id=…`.
 */

/** App Store listing. Unset = the "get the app" banner stays hidden. */
export const IOS_APP_STORE_URL = process.env.NEXT_PUBLIC_IOS_APP_STORE_URL ?? ""

/** iPhone / iPad Safari (iPadOS reports itself as a Mac, but with touch). */
export function isIOS(): boolean {
    if (typeof navigator === "undefined") return false
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

/** `/journey?id=abc&region=at` (or a full URL) -> `transit://journey?id=abc&region=at`. */
export function appDeepLink(webPathOrUrl: string): string {
    const url = new URL(webPathOrUrl, "https://placeholder.invalid")
    return `transit://${url.pathname.replace(/^\/+/, "")}${url.search}`
}

/**
 * Opens the app at `webPathOrUrl`. A custom scheme gives no success signal, so
 * if the page is still in the foreground shortly after, the app probably isn't
 * installed - send them to the App Store instead (when we have a listing).
 */
export function openInApp(webPathOrUrl: string) {
    const fallback = IOS_APP_STORE_URL
        ? window.setTimeout(() => {
            if (document.visibilityState === "visible") window.location.href = IOS_APP_STORE_URL
        }, 1500)
        : undefined
    const cancel = () => {
        if (document.visibilityState === "hidden") window.clearTimeout(fallback)
    }
    document.addEventListener("visibilitychange", cancel, { once: true })
    window.location.href = appDeepLink(webPathOrUrl)
}
