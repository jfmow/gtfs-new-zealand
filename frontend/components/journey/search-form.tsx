"use client"

import { Button } from "@/components/ui/button"
import { LocationSearchInput } from "@/components/map/search"
import { Spinner } from "@/components/ui/spinner"
import { Bookmark, BookmarkCheck, Search, ArrowUpDown } from "lucide-react"
import type { Location } from "./types"
import type { RouteOption } from "./route-filter"
import { PlannerOptionsRow, type TravelMode } from "./planner-options"

interface SearchFormProps {
    startLocation: Location | null
    endLocation: Location | null
    onSelectStart: (location: Location | null) => void
    onSelectEnd: (location: Location | null) => void
    onSelectFromMap: (mode: 'start' | 'end') => void
    onUseCurrentLocation: (mode: 'start' | 'end') => void
    isLocating: 'start' | 'end' | null
    onSwap: () => void
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
    canSave: boolean
    justSaved: boolean
    onPlan: () => void
    onSaveClick: () => void
}

export function SearchForm({
    startLocation,
    endLocation,
    onSelectStart,
    onSelectEnd,
    onSelectFromMap,
    onUseCurrentLocation,
    isLocating,
    onSwap,
    locationError,
    timeType,
    onTimeTypeChange,
    selectedDate,
    onDateChange,
    maxWalkKm,
    onMaxWalkKmChange,
    walkSpeed,
    onWalkSpeedChange,
    maxTransfers,
    onMaxTransfersChange,
    minResults,
    onMinResultsChange,
    onlyRoutes,
    onOnlyRoutesChange,
    modes,
    onModesChange,
    isSearching,
    canSave,
    justSaved,
    onPlan,
    onSaveClick,
}: SearchFormProps) {
    return (
        <div className="space-y-4">
            {/* Location inputs */}
            <div className="flex items-stretch gap-2">
                <div className="flex flex-col justify-center shrink-0">
                    <div className="flex flex-col items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        <span className="h-6 w-px bg-border" />
                        <span className="h-2 w-2 rounded-full bg-destructive" />
                    </div>
                </div>
                <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                    <LocationSearchInput
                        placeholder="From"
                        value={startLocation}
                        onSelect={onSelectStart}
                        storageKey="recentStartLocations"
                        onSelectFromMap={() => onSelectFromMap('start')}
                        onUseCurrentLocation={() => onUseCurrentLocation('start')}
                        isLocating={isLocating === 'start'}
                        searchParamKey='start'
                    />
                    <LocationSearchInput
                        placeholder="To"
                        value={endLocation}
                        onSelect={onSelectEnd}
                        storageKey="recentEndLocations"
                        onSelectFromMap={() => onSelectFromMap('end')}
                        onUseCurrentLocation={() => onUseCurrentLocation('end')}
                        isLocating={isLocating === 'end'}
                        searchParamKey='end'
                    />
                </div>
                <div className="flex flex-col justify-center shrink-0">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={onSwap}
                        disabled={!startLocation && !endLocation}
                        aria-label="Swap locations"
                    >
                        <ArrowUpDown className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {locationError && (
                <p className="text-sm text-destructive" role="alert">
                    {locationError}
                </p>
            )}

            <PlannerOptionsRow
                timeType={timeType}
                selectedDate={selectedDate}
                maxWalkKm={maxWalkKm}
                walkSpeed={walkSpeed}
                maxTransfers={maxTransfers}
                minResults={minResults}
                onlyRoutes={onlyRoutes}
                modes={modes}
                onTimeTypeChange={onTimeTypeChange}
                onDateChange={onDateChange}
                onMaxWalkKmChange={onMaxWalkKmChange}
                onWalkSpeedChange={onWalkSpeedChange}
                onMaxTransfersChange={onMaxTransfersChange}
                onMinResultsChange={onMinResultsChange}
                onOnlyRoutesChange={onOnlyRoutesChange}
                onModesChange={onModesChange}
            />

            {/* Actions */}
            <div className="flex items-center gap-2">
                <Button className="flex-1 h-11 gap-1.5 text-sm rounded-full" disabled={!canSave || isSearching} onClick={onPlan}>
                    {isSearching ? (
                        <>
                            <Spinner />
                            Planning
                        </>
                    ) : (
                        <>
                            <Search className="h-4 w-4" />
                            Plan journey
                        </>
                    )}
                </Button>
                <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0 rounded-full"
                    onClick={onSaveClick}
                    disabled={!canSave}
                    aria-label="Save trip"
                >
                    {justSaved ? (
                        <BookmarkCheck className="h-4 w-4 text-green-500" />
                    ) : (
                        <Bookmark className="h-4 w-4" />
                    )}
                </Button>
            </div>
        </div>
    )
}
