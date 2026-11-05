import AsyncStorage from "@react-native-async-storage/async-storage"
import { useSyncExternalStore } from "react"

/**
 * A tiny persisted store: a value in memory, mirrored to AsyncStorage, that
 * any component can subscribe to. Saved stops, places, trips and settings
 * live in these (on-device only - no sync, decision 2 in plans/expo-app.md).
 */
export interface Stored<T> {
    get(): T
    set(next: T | ((prev: T) => T)): void
    subscribe(listener: () => void): () => void
    /** Resolves once the saved value has been read. */
    ready: Promise<void>
}

export function stored<T>(key: string, initial: T, migrate?: (raw: unknown) => T): Stored<T> {
    let value = initial
    const listeners = new Set<() => void>()
    const emit = () => listeners.forEach((l) => l())
    const ready = AsyncStorage.getItem(key)
        .then((raw) => {
            if (raw === null) return
            try {
                const parsed = JSON.parse(raw) as unknown
                value = migrate ? migrate(parsed) : (parsed as T)
                emit()
            } catch {
                /* corrupt value - keep the default */
            }
        })
        .catch(() => {})
    return {
        get: () => value,
        set(next) {
            value = typeof next === "function" ? (next as (p: T) => T)(value) : next
            emit()
            AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {})
        },
        subscribe(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        ready,
    }
}

export function useStored<T>(s: Stored<T>): [T, Stored<T>["set"]] {
    const value = useSyncExternalStore(s.subscribe, s.get, s.get)
    return [value, s.set]
}
