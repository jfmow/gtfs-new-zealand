import { useEffect } from "react"
import { useRouter, type NextRouter } from "next/router"

/** The in-app URL the router was on before the current one (null on a fresh load). */
let previousUrl: string | null = null

/** Once, from _app: remembers where each in-app navigation came from. */
export function useTrackPreviousUrl() {
    const router = useRouter()
    useEffect(() => {
        const onStart = () => { previousUrl = router.asPath }
        router.events.on("routeChangeStart", onStart)
        return () => router.events.off("routeChangeStart", onStart)
    }, [router])
}

function withoutKey(query: NextRouter["query"], key: string) {
    const next = { ...query }
    delete next[key]
    return next
}

function sameUrl(a: string, pathname: string, query: Record<string, string | string[] | undefined>) {
    const url = new URL(a, "http://x")
    if (url.pathname !== pathname) return false
    const params = [...url.searchParams.entries()]
    const wanted = Object.entries(query).filter(([, v]) => v !== undefined)
    return params.length === wanted.length && wanted.every(([k, v]) => url.searchParams.get(k) === String(v))
}

/**
 * Something shown over a page and recorded in its URL - a stop's board
 * (`?s=`), a tracked vehicle (`?tripId=`). Opening pushes, so the browser's
 * back button closes it. Closing goes back when the page underneath is
 * where we came from, and otherwise (a shared link or a push notification
 * straight to it) replaces the URL, so the in-page back button never
 * leaves the site - like popping to the tab's root on iOS.
 */
export function useUrlOverlay(key: string) {
    const router = useRouter()
    const raw = router.query[key]
    const value = typeof raw === "string" ? raw : ""

    const open = (next: string) => {
        router.push({ pathname: router.pathname, query: { ...router.query, [key]: next } }, undefined, { shallow: true })
    }
    const close = () => {
        const underneath = withoutKey(router.query, key)
        if (previousUrl && sameUrl(previousUrl, router.pathname, underneath)) {
            router.back()
        } else {
            router.replace({ pathname: router.pathname, query: underneath }, undefined, { shallow: true })
        }
    }
    return { value, open, close }
}
