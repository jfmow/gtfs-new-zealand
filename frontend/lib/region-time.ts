import { regionTimeZone } from "./url-store"

/** A clock reading in some timezone. month is 1-12. */
export type WallClock = { year: number; month: number; day: number; hour: number; minute: number }

/** What a clock in `tz` (default: the region's) reads at `date`. */
export function wallClock(date: Date, tz: string = regionTimeZone()): WallClock {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
            timeZone: tz, hourCycle: "h23",
            year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
        }).formatToParts(date).map((p) => [p.type, Number(p.value)])
    )
    return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute }
}

/** The instant a clock in `tz` (default: the region's) reads `w`. */
export function fromWallClock(w: WallClock, tz: string = regionTimeZone()): Date {
    const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)
    // Offset of tz at a given instant, in ms. Applied twice so a reading near
    // a DST change settles on the offset in force at the result.
    const offsetAt = (ms: number) => {
        const c = wallClock(new Date(ms), tz)
        return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute) - Math.floor(ms / 60000) * 60000
    }
    let ms = asUtc - offsetAt(asUtc)
    ms = asUtc - offsetAt(ms)
    return new Date(ms)
}

/**
 * The region's calendar day of `date` as a browser-local midnight - for
 * date-only widgets (Calendar, <input type="date">) that read local fields.
 */
export function regionDayAsLocal(date: Date): Date {
    const w = wallClock(date)
    return new Date(w.year, w.month - 1, w.day)
}

/** Midnight in the region on the browser-local calendar day of `localDay` (a Calendar pick). */
export function regionMidnightOf(localDay: Date): Date {
    return fromWallClock({ year: localDay.getFullYear(), month: localDay.getMonth() + 1, day: localDay.getDate(), hour: 0, minute: 0 })
}

/** Same instant as `date`, with the region clock moved to `hour:minute` (same region day). */
export function withRegionTime(date: Date, hour: number, minute: number): Date {
    return fromWallClock({ ...wallClock(date), hour, minute })
}

/** `day`'s browser-local calendar date with `date`'s region clock time. */
export function withRegionDay(date: Date, localDay: Date): Date {
    const w = wallClock(date)
    return fromWallClock({ year: localDay.getFullYear(), month: localDay.getMonth() + 1, day: localDay.getDate(), hour: w.hour, minute: w.minute })
}

/** Intl options with the region's timezone filled in. */
export function inRegion(opts: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions {
    return { ...opts, timeZone: regionTimeZone() }
}
