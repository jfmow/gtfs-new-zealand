"use client"

import { useEffect, useState } from "react"
import { LocationSearchInput } from "@/components/map/search"
import { Spinner } from "@/components/ui/spinner"
import { Circle, Navigation } from "lucide-react"
import type { Location } from "./types"
import type { RouteOption } from "./route-filter"
import { PlannerOptionsChips, type TravelMode } from "./planner-options"

interface SearchFormProps {
    startLocation: Location | null
    endLocation: Location | null
    onSelectStart: (location: Location | null) => void
    onSelectEnd: (location: Location | null) => void
    onSelectFromMap: (mode: 'start' | 'end') => void
    onUseCurrentLocation: (mode: 'start' | 'end') => void
    isLocating: 'start' | 'end' | null
    locationError: string | null

    timeType: "now" | "leaveat" | "arriveat"
    onTimeTypeChange: (v: "now" | "leaveat" | "arriveat") => void
    selectedDate: Date
    onDateChange: (d: Date) => void
    maxWalkKm: string
    onMaxWalkKmChange: (v: string) => void
    walkSpeed: string
    onWalkSpeedChange: (v: string) => void
    maxTransfers: string
    onMaxTransfersChange: (v: string) => void
    minResults: string
    onMinResultsChange: (v: string) => void
    onlyRoutes: RouteOption[]
    onOnlyRoutesChange: (routes: RouteOption[]) => void
    modes: TravelMode[]
    onModesChange: (modes: TravelMode[]) => void

    isSearching: boolean
}

/**
 * "Where to?" first - most trips start from where you are, so From is "My
 * location" and tucked into a line under it you can change. Planning
 * starts as soon as both ends are set (the page does that - no Plan
 * button); time and options are chips. The iOS planner (2026-11-03),
 * replacing From/To boxes + "Plan journey".
 */
export function SearchForm({
    startLocation,
    endLocation,
    onSelectStart,
    onSelectEnd,
    onSelectFromMap,
    onUseCurrentLocation,
    isLocating,
    locationError,
    isSearching,
    ...options
}: SearchFormProps) {
    const [editingFrom, setEditingFrom] = useState(false)
    // A start picked (or found) puts the line back.
    useEffect(() => {
        if (startLocation) setEditingFrom(false)
    }, [startLocation])

    const fromIsHere = startLocation?.label === "My location"

    return (
        <div className="space-y-2.5">
            {editingFrom && (
                <LocationSearchInput
                    placeholder="From"
                    value={startLocation}
                    onSelect={onSelectStart}
                    storageKey="recentStartLocations"
                    onSelectFromMap={() => onSelectFromMap('start')}
                    onUseCurrentLocation={() => onUseCurrentLocation('start')}
                    isLocating={isLocating === 'start'}
                    searchParamKey='start'
                    autoFocus
                />
            )}

            {/* The input draws its own search icon. */}
            <div className="rounded-2xl border bg-card px-1.5 shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <LocationSearchInput
                    placeholder="Where to?"
                    value={endLocation}
                    onSelect={onSelectEnd}
                    storageKey="recentEndLocations"
                    onSelectFromMap={() => onSelectFromMap('end')}
                    onUseCurrentLocation={() => onUseCurrentLocation('end')}
                    isLocating={isLocating === 'end'}
                    searchParamKey='end'
                    bare
                />
            </div>

            {!editingFrom && (
                <button
                    type="button"
                    onClick={() => setEditingFrom(true)}
                    className="flex items-center gap-1.5 pl-1 text-[13px] text-muted-foreground"
                    aria-label={`From ${startLocation?.label ?? "not set"}. Change`}
                >
                    {fromIsHere ? <Navigation className="h-3 w-3 fill-current" /> : <Circle className="h-2 w-2 fill-current" />}
                    <span className="truncate">
                        From {isLocating === 'start' ? "your location…" : startLocation?.label ?? "…choose a start"}
                    </span>
                    <span className="text-foreground underline underline-offset-2">Change</span>
                </button>
            )}

            {locationError && (
                <p className="text-sm text-destructive" role="alert">
                    {locationError}
                </p>
            )}

            <PlannerOptionsChips
                {...options}
                trailing={isSearching && <Spinner className="ml-auto" />}
            />
        </div>
    )
}
