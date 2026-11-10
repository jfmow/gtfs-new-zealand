import { describe, expect, it } from "vitest"
import { docFromList, emptyDoc, listFromDoc, mergeDocs, parseDoc, TOMBSTONE_TTL_MS, type SyncDoc } from "../src/sync-merge"

interface Stop {
    id: string
    name: string
}
const key = (s: Stop) => s.id
const s = (id: string, name = id): Stop => ({ id, name })

/** One device: its list, and the doc as of its last sync. */
function device(list: Stop[] = []) {
    return { list, base: null as SyncDoc<Stop> | null }
}

/** What cloud-sync.ts does: local changes -> doc, merge with the cloud, adopt the result. */
function sync(d: ReturnType<typeof device>, cloud: { doc: SyncDoc<Stop> | null }, now: number) {
    const mine = docFromList(d.list, key, d.base, now)
    const merged = cloud.doc ? mergeDocs(mine, cloud.doc, now) : mine
    d.list = listFromDoc(merged)
    d.base = merged
    cloud.doc = merged
}

describe("sync merge", () => {
    it("a stop saved on each device ends up on both", () => {
        const cloud = { doc: null }
        const a = device([s("1")])
        const b = device([s("2")])
        sync(a, cloud, 1000)
        sync(b, cloud, 2000)
        sync(a, cloud, 3000)
        expect(a.list.map(key).sort()).toEqual(["1", "2"])
        expect(b.list.map(key).sort()).toEqual(["1", "2"])
    })

    it("a delete on one device removes it from the other", () => {
        const cloud = { doc: null }
        const a = device([s("1"), s("2")])
        const b = device()
        sync(a, cloud, 1000)
        sync(b, cloud, 1100)
        expect(b.list.map(key)).toEqual(["1", "2"])
        a.list = [s("2")]
        sync(a, cloud, 2000)
        sync(b, cloud, 2100)
        expect(b.list.map(key)).toEqual(["2"])
    })

    it("the later of a rename and a delete wins", () => {
        const cloud = { doc: null }
        const a = device([s("1")])
        const b = device()
        sync(a, cloud, 1000)
        sync(b, cloud, 1100)
        // Offline: b deletes, then a renames later.
        b.list = []
        const bDoc = docFromList(b.list, key, b.base, 2000)
        a.list = [s("1", "Renamed")]
        const aDoc = docFromList(a.list, key, a.base, 3000)
        const merged = mergeDocs(aDoc, bDoc, 3000)
        expect(listFromDoc(merged)).toEqual([s("1", "Renamed")])
        // And the other way round.
        const later = mergeDocs(docFromList([], key, a.base, 4000), aDoc, 4000)
        expect(listFromDoc(later)).toEqual([])
    })

    it("a device that never synced doesn't bring back something deleted elsewhere", () => {
        const cloud = { doc: null }
        const a = device([s("1")])
        sync(a, cloud, 1000)
        a.list = []
        sync(a, cloud, 2000)
        const b = device([s("1")]) // e.g. migrated from the old app; first seen at 0
        sync(b, cloud, 3000)
        expect(b.list).toEqual([])
    })

    it("keeps the newest order and appends items it didn't know about", () => {
        const cloud = { doc: null }
        const a = device([s("1"), s("2"), s("3")])
        const b = device()
        sync(a, cloud, 1000)
        sync(b, cloud, 1100)
        a.list = [s("3"), s("2"), s("1")]
        const aDoc = docFromList(a.list, key, a.base, 3000)
        b.list = [...b.list, s("4")]
        const bDoc = docFromList(b.list, key, b.base, 2000)
        expect(listFromDoc(mergeDocs(aDoc, bDoc, 3000)).map(key)).toEqual(["3", "2", "1", "4"])
    })

    it("is symmetric, and settles - no change means no new write", () => {
        const a = docFromList([s("1"), s("2", "Two")], key, emptyDoc(), 1000)
        const b = docFromList([s("2", "Deux"), s("3")], key, emptyDoc(), 1000)
        const ab = mergeDocs(a, b, 1000)
        expect(ab).toEqual(mergeDocs(b, a, 1000))
        const again = docFromList(listFromDoc(ab), key, ab, 5000)
        expect(again).toEqual(ab)
        expect(mergeDocs(again, ab, 5000)).toEqual(ab)
    })

    it("drops old tombstones", () => {
        const doc = docFromList([], key, docFromList([s("1")], key, emptyDoc(), 0), 1000)
        expect(doc.gone).toEqual({ 1: 1000 })
        expect(mergeDocs(doc, emptyDoc(), 1000 + TOMBSTONE_TTL_MS).gone).toEqual({})
    })

    it("parses only real docs", () => {
        expect(parseDoc(null)).toBeNull()
        expect(parseDoc("nope")).toBeNull()
        expect(parseDoc(JSON.stringify({ v: 2 }))).toBeNull()
        const doc = docFromList([s("1")], key, null, 0)
        expect(parseDoc(JSON.stringify(doc))).toEqual(doc)
    })
})
