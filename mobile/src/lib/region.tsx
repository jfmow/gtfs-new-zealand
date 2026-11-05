import AsyncStorage from "@react-native-async-storage/async-storage"
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { Platform } from "react-native"
import { PRODUCTION_REGIONS, devRegions, type Region } from "@transit/shared/regions"

const STORAGE_KEY = "selectedRegion"

/**
 * Dev builds talk to the backend running on this Mac (`go run .`, port
 * 8090), not production - so testing never eats into the production rate
 * limit (10 req/s per IP, which every device on the home network shares).
 * The iOS simulator shares the Mac's network, so localhost works; the
 * Android emulator reaches the host at 10.0.2.2. A physical device needs
 * EXPO_PUBLIC_DEV_API_HOST=http://<mac-lan-ip>:8090.
 * EXPO_PUBLIC_USE_PROD_API=1 points a dev build at production instead.
 */
const DEV_HOST = process.env.EXPO_PUBLIC_DEV_API_HOST ?? (Platform.OS === "android" ? "http://10.0.2.2:8090" : "http://localhost:8090")
const USE_LOCAL_API = __DEV__ && process.env.EXPO_PUBLIC_USE_PROD_API !== "1"

export const regions: Region[] = USE_LOCAL_API ? devRegions(DEV_HOST) : PRODUCTION_REGIONS

/**
 * The selected region, readable outside React (the API client reads it on
 * every call). The provider keeps it and storage in step.
 */
let current: Region = regions[0]
export function currentRegion(): Region {
    return current
}

type RegionContextValue = {
    region: Region
    setRegion: (region: Region) => void
    /** False until the saved choice has been read, so screens don't fetch the default region first. */
    ready: boolean
}

const RegionContext = createContext<RegionContextValue | undefined>(undefined)

export function RegionProvider({ children }: { children: ReactNode }) {
    const [region, setRegionState] = useState<Region>(current)
    const [ready, setReady] = useState(false)

    useEffect(() => {
        AsyncStorage.getItem(STORAGE_KEY)
            .then((url) => {
                // By URL, else by slug - a region picked against production keeps its choice in a dev build.
                const slug = url?.split("/").filter(Boolean).pop()
                const saved = regions.find((r) => r.url === url) ?? regions.find((r) => r.url.split("/").filter(Boolean).pop() === slug)
                if (saved) {
                    current = saved
                    setRegionState(saved)
                }
            })
            .catch(() => { /* first launch or storage unavailable: keep the default */ })
            .finally(() => setReady(true))
    }, [])

    const setRegion = useCallback((next: Region) => {
        current = next
        setRegionState(next)
        AsyncStorage.setItem(STORAGE_KEY, next.url).catch(() => {})
    }, [])

    return <RegionContext.Provider value={{ region, setRegion, ready }}>{children}</RegionContext.Provider>
}

export function useRegion(): RegionContextValue {
    const value = useContext(RegionContext)
    if (!value) throw new Error("useRegion must be used within a RegionProvider")
    return value
}
