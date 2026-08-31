"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { LocationSearchInput } from "@/components/map/search"
import { Spinner } from "@/components/ui/spinner"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Bookmark, BookmarkCheck, Settings2, Search, ArrowUpDown, ChevronDownIcon } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { format } from "date-fns"
import type { Location } from "./types"

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

            {/* Options */}
            <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5">
                    <Settings2 className="h-3.5 w-3.5" />
                    Options
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="flex flex-wrap gap-2 pt-2">
                        <Select value={timeType} onValueChange={(value) => onTimeTypeChange(value as "now" | "leaveat" | "arriveat")}>
                            <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="now">Leave now</SelectItem>
                                <SelectItem value="leaveat">Leave at</SelectItem>
                                <SelectItem value="arriveat">Arrive by</SelectItem>
                            </SelectContent>
                        </Select>
                        {timeType !== "now" && (
                            <DatePicker date={selectedDate} onDateChange={onDateChange} />
                        )}

                        <Select value={maxWalkKm} onValueChange={onMaxWalkKmChange}>
                            <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs">
                                <span className="text-muted-foreground mr-1">Max walk:</span>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="0.5">0.5 km</SelectItem>
                                <SelectItem value="1">1 km</SelectItem>
                                <SelectItem value="2">2 km</SelectItem>
                                <SelectItem value="5">5 km</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={walkSpeed} onValueChange={onWalkSpeedChange}>
                            <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
                                <span className="text-muted-foreground mr-1">Speed:</span>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="3">Slow</SelectItem>
                                <SelectItem value="4.8">Normal</SelectItem>
                                <SelectItem value="5.5">Brisk</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={maxTransfers} onValueChange={onMaxTransfersChange}>
                            <SelectTrigger className="h-8 w-auto min-w-[140px] text-xs">
                                <span className="text-muted-foreground mr-1">Transfers:</span>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="0">Direct only</SelectItem>
                                <SelectItem value="1">Up to 1</SelectItem>
                                <SelectItem value="2">Up to 2</SelectItem>
                                <SelectItem value="3">Up to 3</SelectItem>
                                <SelectItem value="4">Up to 4</SelectItem>
                                <SelectItem value="5">Up to 5</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CollapsibleContent>
            </Collapsible>

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

function DatePicker({
    date,
    onDateChange,
    disabled,
}: {
    date: Date
    onDateChange: (date: Date) => void
    disabled?: boolean
}) {
    const [open, setOpen] = useState(false)

    const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (disabled) return
        const [hours, minutes] = e.target.value.split(":").map(Number)
        const updatedDate = new Date(date)
        updatedDate.setHours(hours, minutes, 0)
        onDateChange(updatedDate)
    }

    return (
        <div className="flex items-center gap-1.5">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        className="h-9 text-sm font-normal px-3"
                        disabled={disabled}
                    >
                        {date ? format(date, "d MMM") : "Date"}
                        <ChevronDownIcon className="h-3.5 w-3.5 ml-1" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                    <Calendar
                        mode="single"
                        selected={date}
                        captionLayout="dropdown"
                        defaultMonth={date}
                        onSelect={(selectedDate) => {
                            if (!selectedDate) return
                            const updatedDate = new Date(selectedDate)
                            updatedDate.setHours(date.getHours(), date.getMinutes(), date.getSeconds())
                            onDateChange(updatedDate)
                            setOpen(false)
                        }}
                    />
                </PopoverContent>
            </Popover>
            <Input
                type="time"
                step="60"
                value={date ? format(date, "HH:mm") : "00:00"}
                onChange={handleTimeChange}
                disabled={disabled}
                className="h-9 w-[100px] text-sm bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            />
        </div>
    )
}
