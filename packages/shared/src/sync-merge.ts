/**
 * Merging a synced list (saved stops, places, trips) between devices.
 *
 * Each device keeps the list as a plain array. To sync, it's turned into a
 * `SyncDoc`: every item with the time it last changed, a tombstone for each
 * item deleted, and the list order with the time it last changed. Two docs
 * merge item by item (newest wins, a later delete beats an earlier edit),
 * so changes made on two devices before they sync both survive - the same
 * rule SwiftData + CloudKit gave the SwiftUI app.
 *
 * The result is the same whichever device merges, so devices settle on one
 * doc and stop writing.
 */

export interface SyncDoc<T> {
    v: 1
    /** By item key: the item and when it last changed (ms). */
    items: Record<string, { at: number; value: T }>
    /** By item key: when it was deleted (ms). */
    gone: Record<string, number>
    order: string[]
    orderAt: number
}

/** Tombstones older than this are dropped - every device has seen them by then. */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

export function emptyDoc<T>(): SyncDoc<T> {
    return { v: 1, items: {}, gone: {}, order: [], orderAt: 0 }
}

/**
 * The doc for this device's list now, given the doc as of its last sync
 * (`base`): items that differ from the base are stamped `now`, items missing
 * from the list become tombstones. With no base (never synced), items are
 * stamped with `firstSeen(item)` so a delete made elsewhere still wins.
 */
export function docFromList<T>(list: T[], key: (item: T) => string, base: SyncDoc<T> | null, now: number, firstSeen: (item: T) => number = () => 0): SyncDoc<T> {
    const items: SyncDoc<T>["items"] = {}
    const gone: SyncDoc<T>["gone"] = { ...(base?.gone ?? {}) }
    const order: string[] = []
    for (const item of list) {
        const k = key(item)
        if (items[k]) continue // a duplicate in the list - keep the first
        order.push(k)
        const prev = base?.items[k]
        items[k] = prev && same(prev.value, item) ? prev : { at: base ? now : firstSeen(item), value: item }
        delete gone[k]
    }
    for (const k of Object.keys(base?.items ?? {})) {
        if (!items[k]) gone[k] = now
    }
    const orderAt = base && sameOrder(base.order, order) ? base.orderAt : base ? now : 0
    return { v: 1, items, gone, order, orderAt }
}

/** Merges two docs. Symmetric: merge(a, b) and merge(b, a) are equal. */
export function mergeDocs<T>(a: SyncDoc<T>, b: SyncDoc<T>, now: number): SyncDoc<T> {
    const items: SyncDoc<T>["items"] = {}
    const gone: SyncDoc<T>["gone"] = {}
    const keys = new Set([...Object.keys(a.items), ...Object.keys(b.items), ...Object.keys(a.gone), ...Object.keys(b.gone)])
    for (const k of keys) {
        const item = newer(a.items[k], b.items[k])
        const goneAt = Math.max(a.gone[k] ?? -1, b.gone[k] ?? -1)
        if (item && item.at > goneAt) items[k] = item
        else if (goneAt >= 0 && now - goneAt < TOMBSTONE_TTL_MS) gone[k] = goneAt
    }
    // The newer order wins; items it doesn't know about go at the end, oldest first.
    const winner = a.orderAt !== b.orderAt ? (a.orderAt > b.orderAt ? a : b) : a.order.join("\n") >= b.order.join("\n") ? a : b
    const order = [...new Set(winner.order)].filter((k) => items[k])
    const placed = new Set(order)
    const rest = Object.keys(items)
        .filter((k) => !placed.has(k))
        .sort((x, y) => items[x].at - items[y].at || (x < y ? -1 : x > y ? 1 : 0))
    return { v: 1, items, gone, order: [...order, ...rest], orderAt: Math.max(a.orderAt, b.orderAt) }
}

export function listFromDoc<T>(doc: SyncDoc<T>): T[] {
    return doc.order.map((k) => doc.items[k].value)
}

/** A doc read back from storage, or null if it isn't one. */
export function parseDoc<T>(json: string | null | undefined): SyncDoc<T> | null {
    if (!json) return null
    try {
        const doc = JSON.parse(json) as Partial<SyncDoc<T>>
        if (doc?.v !== 1 || typeof doc.items !== "object" || !Array.isArray(doc.order)) return null
        const items = doc.items ?? {}
        return { v: 1, items, gone: doc.gone ?? {}, order: doc.order.filter((k) => typeof k === "string" && items[k]), orderAt: doc.orderAt ?? 0 }
    } catch {
        return null
    }
}

function newer<T>(x: { at: number; value: T } | undefined, y: { at: number; value: T } | undefined) {
    if (!x || !y) return x ?? y
    if (x.at !== y.at) return x.at > y.at ? x : y
    // Same time: pick by content, so every device picks the same one.
    return JSON.stringify(x.value) >= JSON.stringify(y.value) ? x : y
}

function same(x: unknown, y: unknown) {
    return JSON.stringify(x) === JSON.stringify(y)
}

function sameOrder(x: string[], y: string[]) {
    return x.length === y.length && x.every((k, i) => k === y[i])
}
