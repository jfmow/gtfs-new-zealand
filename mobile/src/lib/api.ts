import AsyncStorage from "@react-native-async-storage/async-storage"
import * as Crypto from "expo-crypto"
import * as SecureStore from "expo-secure-store"
import { createApiClient } from "@transit/shared/api"
import { createEndpoints, type DeviceIdentity } from "@transit/shared/endpoints"
import { currentRegion } from "./region"

const TRACE_ID_KEY = "trace-id"
const DEVICE_KEY = "device-identity"

/** A per-install id for `X-Trace-ID`, made on first use and kept in storage. */
let traceId: string = Crypto.randomUUID()
AsyncStorage.getItem(TRACE_ID_KEY)
    .then((saved) => {
        if (saved) traceId = saved
        else AsyncStorage.setItem(TRACE_ID_KEY, traceId).catch(() => {})
    })
    .catch(() => {})

/**
 * This install's device id and secret (iOS: the Keychain; Android: the
 * Keystore, via expo-secure-store). The backend stores only the secret's
 * hash; every notification call sends both as X-Device-Id / X-Device-Secret.
 */
let identity: DeviceIdentity | null = null
export const deviceIdentity: Promise<DeviceIdentity> = (async () => {
    try {
        const raw = await SecureStore.getItemAsync(DEVICE_KEY)
        if (raw) {
            identity = JSON.parse(raw) as DeviceIdentity
            return identity
        }
    } catch {
        /* first launch or unreadable - make a new one */
    }
    const bytes = await Crypto.getRandomBytesAsync(32)
    const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
    identity = { id: Crypto.randomUUID(), secret }
    await SecureStore.setItemAsync(DEVICE_KEY, JSON.stringify(identity)).catch(() => {})
    return identity
})()

/**
 * The shared API client (packages/shared/src/api.ts) for the selected region.
 * Never throws: failures come back as `{ ok: false }`.
 */
export const apiFetch = createApiClient({
    region: currentRegion,
    traceId: () => traceId,
    headers: (): Record<string, string> => (identity ? { "X-Device-Id": identity.id, "X-Device-Secret": identity.secret } : {}),
})

/** Every endpoint, typed (packages/shared/src/endpoints.ts). */
export const api = createEndpoints(apiFetch)
