import { useEffect, useState } from "react"
import { ApiFetch } from "@/lib/url-context"
import { useFareType, useShowFares } from "@/lib/fare-type"

import type { FareEstimate, FareType } from "@transit/shared/fares"
export type { FareEstimate } from "@transit/shared/fares"

/** Plan id -> fare for the chosen fare type (null where it can't be estimated). Plans the backend hasn't seen come back null. Empty with fares turned off in Settings. */
export function useFares(planIds: string[]): Record<string, FareEstimate | null> {
    const [fareType] = useFareType()
    const [showFares] = useShowFares()
    const query = showFares ? planIds.filter(Boolean).join(",") : ""
    const [fares, setFares] = useState<{ type: FareType; byId: Record<string, FareEstimate | null> }>({ type: fareType, byId: {} })
    useEffect(() => {
        if (!query) return
        let cancelled = false
        ApiFetch<{ fares: Record<string, FareEstimate | null> }>(`fares?plans=${encodeURIComponent(query)}&concession=${fareType}`)
            .then((res) => {
                if (cancelled || !res.ok) return
                setFares((cur) => ({ type: fareType, byId: cur.type === fareType ? { ...cur.byId, ...res.data.fares } : res.data.fares }))
            })
            .catch(() => {})
        return () => { cancelled = true }
    }, [query, fareType])
    // A change of fare type hides the old prices until the new ones arrive.
    return showFares && fares.type === fareType ? fares.byId : {}
}
