import { TransitNative } from "../../modules/transit-native/src"

/**
 * A tiny key-value store in the app's hidden Google Drive folder
 * (appDataFolder): one JSON file per key. What iCloud's key-value store is
 * on iOS, for Android's sync (src/lib/cloud-sync.ts). Only this app can see
 * the folder; it counts towards the user's Drive storage.
 */

const FILES = "https://www.googleapis.com/drive/v3/files"
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"

let token: string | null = null
/** Drive file ids by name, from the last listing. */
let ids: Map<string, string> | null = null

class DriveAuthError extends Error {}

/** A token, asking Google for one silently if needed (null = not connected). */
async function accessToken(): Promise<string | null> {
    if (token) return token
    token = await TransitNative.driveAuthorize(false)
    return token
}

/** Fetch with the token; a 401 gets a fresh token and one retry. */
async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const t = await accessToken()
        if (!t) throw new DriveAuthError("Not connected to Google Drive")
        const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${t}` } })
        if (res.status !== 401) return res
        token = null
    }
    throw new DriveAuthError("Google Drive access was withdrawn")
}

async function fileIds(): Promise<Map<string, string>> {
    if (ids) return ids
    const res = await driveFetch(`${FILES}?spaces=appDataFolder&fields=files(id,name)&pageSize=100`)
    if (!res.ok) throw new Error(`Drive list failed (${res.status})`)
    const body = (await res.json()) as { files?: { id: string; name: string }[] }
    ids = new Map((body.files ?? []).map((f) => [f.name, f.id]))
    return ids
}

const fileName = (key: string) => `${key}.json`

export const driveStore = {
    /** Asks the rider to connect Google Drive (shows Google's screens). True once connected. */
    async connect(): Promise<boolean> {
        token = await TransitNative.driveAuthorize(true)
        ids = null
        return !!token
    },
    /** Connected already (a token comes back without asking). */
    async connected(): Promise<boolean> {
        try {
            return !!(await accessToken())
        } catch {
            return false
        }
    },
    async get(key: string): Promise<string | null> {
        const id = (await fileIds()).get(fileName(key))
        if (!id) return null
        const res = await driveFetch(`${FILES}/${id}?alt=media`)
        if (res.status === 404) {
            ids = null
            return null
        }
        if (!res.ok) throw new Error(`Drive read failed (${res.status})`)
        return res.text()
    },
    async set(key: string, json: string): Promise<void> {
        const map = await fileIds()
        const id = map.get(fileName(key))
        if (id) {
            const res = await driveFetch(`${UPLOAD}/${id}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: json })
            if (res.ok) return
            if (res.status !== 404) throw new Error(`Drive write failed (${res.status})`)
            map.delete(fileName(key))
        }
        const boundary = `transit${Date.now()}`
        const body =
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
            JSON.stringify({ name: fileName(key), parents: ["appDataFolder"] }) +
            `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`
        const res = await driveFetch(`${UPLOAD}?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body })
        if (!res.ok) throw new Error(`Drive create failed (${res.status})`)
        const created = (await res.json()) as { id: string }
        map.set(fileName(key), created.id)
    },
    isAuthError: (e: unknown) => e instanceof DriveAuthError,
}
