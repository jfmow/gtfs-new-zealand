import { useEffect, useState } from "react"
import { AppState } from "react-native"

/** Whether the app is in the foreground - for polling that should pause in the background. */
export function useAppActive(): boolean {
    const [active, setActive] = useState(AppState.currentState === "active")
    useEffect(() => {
        const sub = AppState.addEventListener("change", (s) => setActive(s === "active"))
        return () => sub.remove()
    }, [])
    return active
}
