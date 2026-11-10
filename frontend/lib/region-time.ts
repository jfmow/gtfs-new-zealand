import * as shared from "@transit/shared/region-time"
import { regionTimeZone } from "./url-store"

/**
 * The shared region-time helpers (packages/shared/src/region-time.ts) with
 * the selected region's timezone as the default.
 */

export type { WallClock } from "@transit/shared/region-time"

/** What a clock in `tz` (default: the region's) reads at `date`. */
export function wallClock(date: Date, tz: string = regionTimeZone()): shared.WallClock {
    return shared.wallClock(date, tz)
}

/** The instant a clock in `tz` (default: the region's) reads `w`. */
export function fromWallClock(w: shared.WallClock, tz: string = regionTimeZone()): Date {
    return shared.fromWallClock(w, tz)
}

/**
 * The region's calendar day of `date` as a browser-local midnight - for
 * date-only widgets (Calendar, <input type="date">) that read local fields.
 */
export function regionDayAsLocal(date: Date): Date {
    return shared.regionDayAsLocal(date, regionTimeZone())
}

/** Midnight in the region on the browser-local calendar day of `localDay` (a Calendar pick). */
export function regionMidnightOf(localDay: Date): Date {
    return shared.regionMidnightOf(localDay, regionTimeZone())
}

/** Same instant as `date`, with the region clock moved to `hour:minute` (same region day). */
export function withRegionTime(date: Date, hour: number, minute: number): Date {
    return shared.withRegionTime(date, hour, minute, regionTimeZone())
}

/** `day`'s browser-local calendar date with `date`'s region clock time. */
export function withRegionDay(date: Date, localDay: Date): Date {
    return shared.withRegionDay(date, localDay, regionTimeZone())
}

/** Intl options with the region's timezone filled in. */
export function inRegion(opts: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions {
    return shared.inZone(regionTimeZone(), opts)
}
