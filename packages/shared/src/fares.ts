/** Settings -> Fare type: which fare estimates show (`fares.Concession` on the backend, the iOS `FareType`). */
export type FareType = "adult" | "child" | "youth" | "tertiary" | "community" | "supergold" | "accessible"

/** A fare type the current region offers, in its own words - `GET /fares/types`. */
export interface FareTypeOption {
    value: FareType
    label: string
    detail?: string
}

/** What a region offers until `/fares/types` loads, or if it can't. */
export const ADULT_ONLY: FareTypeOption[] = [{ value: "adult", label: "Adult" }]

/** A journey's fare - `fares.Estimate` on the backend. */
export interface FareEstimate {
    cents: number
    currency: "NZD" | "AUD"
    /** "$4.90" - "$4.90+" when some rides couldn't be priced. */
    label: string
    /** "AT HOP or contactless · 2 zones". */
    detail: string
    /** Caps, off-peak. */
    note?: string
    partial: boolean
    parts: { legs: number[]; cents: number; label: string; detail: string }[]
    /** The fare type priced - "adult" when the region has no fare for the one chosen. */
    concession: FareType
}
