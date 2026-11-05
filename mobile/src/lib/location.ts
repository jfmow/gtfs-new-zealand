import * as Location from "expo-location"
import { useEffect, useState } from "react"
import { Platform } from "react-native"
import type { Coordinate } from "@transit/shared/models"

export type LocationState =
    | { status: "unknown" }
    | { status: "denied" }
    | { status: "ok"; coordinate: Coordinate; accuracy: number | null }

let last: LocationState = { status: "unknown" }

/**
 * The rider's position while a screen is open (balanced accuracy, every
 * 25 m). Journey tracking uses its own GPS policy instead (phase 4).
 * `ask` requests permission if it hasn't been decided.
 */
export function useUserLocation(ask = true): LocationState {
    const [state, setState] = useState<LocationState>(last)

    useEffect(() => {
        let sub: Location.LocationSubscription | null = null
        let cancelled = false
        ;(async () => {
            const current = await Location.getForegroundPermissionsAsync()
            let granted = current.granted
            if (!granted && ask && current.canAskAgain) granted = (await Location.requestForegroundPermissionsAsync()).granted
            if (cancelled) return
            if (!granted) {
                last = { status: "denied" }
                setState(last)
                return
            }
            // A recent fix straight away, so "near you" doesn't wait for the first update.
            const known = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null)
            if (known && !cancelled) {
                last = { status: "ok", coordinate: { lat: known.coords.latitude, lon: known.coords.longitude }, accuracy: known.coords.accuracy }
                setState(last)
            }
            // Android's "balanced" needs Google's network location, which a rider may have declined - use GPS there.
            const accuracy = Platform.OS === "android" ? Location.Accuracy.High : Location.Accuracy.Balanced
            sub = await Location.watchPositionAsync({ accuracy, distanceInterval: 25 }, (pos) => {
                last = { status: "ok", coordinate: { lat: pos.coords.latitude, lon: pos.coords.longitude }, accuracy: pos.coords.accuracy }
                setState(last)
            })
            if (cancelled) sub.remove()
        })().catch(() => {
            if (!cancelled) setState({ status: "denied" })
        })
        return () => {
            cancelled = true
            sub?.remove()
        }
    }, [ask])

    return state
}

export function coordinateOf(state: LocationState): Coordinate | null {
    return state.status === "ok" ? state.coordinate : null
}
