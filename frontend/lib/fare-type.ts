import { useCallback, useEffect, useState } from "react"
import { ApiFetch } from "@/lib/url-context"
import { getRegionSlug, urlStore } from "@/lib/url-store"

/** Settings -> Fare type: which fare estimates show (`fares.Concession` on the backend, the iOS `FareType`). */
export type FareType = "adult" | "child" | "youth" | "tertiary" | "community" | "supergold" | "accessible"

/** A fare type the current region offers, in its own words - `GET /fares/types`. */
export interface FareTypeOption {
    value: FareType
    label: string
    detail?: string
}

const ADULT_ONLY: FareTypeOption[] = [{ value: "adult", label: "Adult" }]

const KEY = "fareType"
const EVENT = "fareTypeChanged"

/** Each region keeps its own choice - a SuperGold rider in Auckland is still one in Wellington, but a region may not offer it. */
function regionKey(): string {
    return `${KEY}:${getRegionSlug(urlStore.currentUrl)}`
}

function read(): FareType {
    try {
        return (localStorage.getItem(regionKey()) as FareType | null) ?? "adult"
    } catch {
        return "adult"
    }
}

const optionsCache = new Map<string, Promise<FareTypeOption[]>>()

/** The fare types the current region offers (just Adult until loaded, or if it can't be). */
export function useFareTypeOptions(): FareTypeOption[] {
    const [options, setOptions] = useState<FareTypeOption[]>(ADULT_ONLY)
    useEffect(() => {
        const slug = getRegionSlug(urlStore.currentUrl)
        let pending = optionsCache.get(slug)
        if (!pending) {
            pending = ApiFetch<{ types: FareTypeOption[] }>("fares/types")
                .then((res) => (res.ok && res.data.types?.length ? res.data.types : ADULT_ONLY))
                .catch(() => ADULT_ONLY)
            optionsCache.set(slug, pending)
        }
        let cancelled = false
        pending.then((o) => { if (!cancelled) setOptions(o) })
        return () => { cancelled = true }
    }, [])
    return options
}

/** The chosen fare type for the current region, and a setter that updates every page using it. "adult" until read on the client. */
export function useFareType(): [FareType, (type: FareType) => void] {
    const [type, setTypeState] = useState<FareType>("adult")

    useEffect(() => {
        setTypeState(read())
        const sync = () => setTypeState(read())
        window.addEventListener(EVENT, sync)
        window.addEventListener("storage", sync)
        return () => {
            window.removeEventListener(EVENT, sync)
            window.removeEventListener("storage", sync)
        }
    }, [])

    const setType = useCallback((next: FareType) => {
        try { localStorage.setItem(regionKey(), next) } catch { /* private mode - just this session */ }
        setTypeState(next)
        window.dispatchEvent(new Event(EVENT))
    }, [])

    return [type, setType]
}

const SHOW_KEY = "showFares"

function readShow(): boolean {
    try {
        return localStorage.getItem(SHOW_KEY) !== "false"
    } catch {
        return true
    }
}

/** Settings -> Show fares: on unless the rider turns it off. */
export function useShowFares(): [boolean, (show: boolean) => void] {
    const [show, setShowState] = useState(true)

    useEffect(() => {
        setShowState(readShow())
        const sync = () => setShowState(readShow())
        window.addEventListener(EVENT, sync)
        window.addEventListener("storage", sync)
        return () => {
            window.removeEventListener(EVENT, sync)
            window.removeEventListener("storage", sync)
        }
    }, [])

    const setShow = useCallback((next: boolean) => {
        try { localStorage.setItem(SHOW_KEY, String(next)) } catch { /* private mode - just this session */ }
        setShowState(next)
        window.dispatchEvent(new Event(EVENT))
    }, [])

    return [show, setShow]
}
