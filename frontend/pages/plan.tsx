"use client"

import { useState, Suspense, useRef, useEffect, useCallback } from "react"
import dynamic from "next/dynamic"
import { SaveTripDialog } from "@/components/trips/save-trip-dialog"
import { ManageTripsSheet, type SavedTrip } from "@/components/trips/manage-trips-sheet"
import { GlobalTripSettingsDialog } from "@/components/trips/global-trip-settings-dialog"
import { Button } from "@/components/ui/button"
import { LocationSearchInput } from "@/components/map/search"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
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
import { Bookmark, BookmarkCheck, List, Settings2, Search, ArrowUpDown, AlertTriangle, ArrowRight, Clock, Footprints, Accessibility, ChevronDownIcon } from "lucide-react"
import { ApiFetch, useUrl } from "@/lib/url-context"
import { useIsMobile } from "@/lib/utils"
import type { GeoJSON } from "@/components/map/geojson-types"
import type { MapItem } from "@/components/map/markers/create"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { format } from "date-fns"

const LeafletMap = dynamic(() => import("@/components/map/map"), {
    ssr: false,
})

// ── Types ──────────────────────────────────────────────────────────────────────

interface Location {
    lat: number
    lon: number
    label: string
}

export interface Stop {
    location_type: number
    parent_station: string
    stop_code: string
    stop_id: string
    stop_lat: number
    stop_lon: number
    stop_name: string
    stop_headsign: string
    wheelchair_boarding: number
    platform_number: string
    stop_type: string
    stop_sequence: number
    is_child_stop: boolean
}

export enum RealtimeStatus {
    Delayed = "delayed",
    Early = "early",
    Scheduled = "scheduled",
    OnTime = "on_time",
}

export interface Route {
    route_id: string
    route_short_name: string
    route_long_name: string
    route_color: string
    route_text_color: string
    vehicle_type: string
}

export interface Leg {
    Mode: string
    FromStop: Stop | null
    ToStop: Stop | null
    TripID: string
    RouteID: string
    Route: Route | null
    DepartureTime: Date
    ArrivalTime: Date
    Duration: number
    DistanceKm: number
    StopSequenceID: number
    scheduled_departure_time: Date
    scheduled_arrival_time: Date
    trip_usable: boolean
    realtime_status?: RealtimeStatus
    delay_seconds?: number
}

export interface JourneyType {
    StartLat: number
    StartLon: number
    EndLat: number
    EndLon: number
    DepartureTime: Date
    ArrivalTime: Date
    TotalDuration: number
    Transfers: number
    TransferStops: Stop[] | null
    Legs: Leg[]
    RouteGeoJSON: GeoJSON
    ID: string
}

// ── Persistence ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "savedJourneyTrips"

function useSavedTrips() {
    const [trips, setTrips] = useState<SavedTrip[]>(() => {
        if (typeof window === "undefined") return []
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
        } catch {
            return []
        }
    })

    const persist = (next: SavedTrip[]) => {
        setTrips(next)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    }

    const saveTrip = (trip: Omit<SavedTrip, "id" | "savedAt">): SavedTrip => {
        const newTrip: SavedTrip = {
            ...trip,
            id: crypto.randomUUID(),
            savedAt: new Date().toISOString(),
        }
        persist([newTrip, ...trips])
        return newTrip
    }

    const updateTrip = (updated: SavedTrip) => {
        persist(trips.map((t) => (t.id === updated.id ? updated : t)))
    }

    const deleteTrip = (id: string) => {
        persist(trips.filter((t) => t.id !== id))
    }

    const updateAllTrips = (settings: {
        maxWalkKm?: string
        walkSpeed?: string
        maxTransfers?: string
    }) => {
        persist(
            trips.map((t) => ({
                ...t,
                ...(settings.maxWalkKm !== undefined && { maxWalkKm: settings.maxWalkKm }),
                ...(settings.walkSpeed !== undefined && { walkSpeed: settings.walkSpeed }),
                ...(settings.maxTransfers !== undefined && { maxTransfers: settings.maxTransfers }),
            }))
        )
    }

    return { trips, saveTrip, updateTrip, deleteTrip, updateAllTrips }
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Page() {
    const { trips, saveTrip, updateTrip, deleteTrip, updateAllTrips } = useSavedTrips()
    const isMobile = useIsMobile()
    const { currentUrl } = useUrl()

    // Journey form state
    const [startLocation, setStartLocation] = useState<Location | null>(null)
    const [endLocation, setEndLocation] = useState<Location | null>(null)
    const [isLocating, setIsLocating] = useState<'start' | 'end' | null>(null)
    const [maxWalkKm, setMaxWalkKm] = useState("1")
    const [walkSpeed, setWalkSpeed] = useState("4.8")
    const [maxTransfers, setMaxTransfers] = useState("5")
    const [selectedDate, setSelectedDate] = useState<Date>(new Date())
    const [timeType, setTimeType] = useState<"now" | "leaveat" | "arriveat">("now")

    // Journey results state
    const [apiResponse, setApiResponse] = useState<JourneyType[]>([])
    const [selectedRoute, setSelectedRoute] = useState<JourneyType | undefined>()
    const [isSearching, setIsSearching] = useState(false)

    // UI state
    const [saveTripOpen, setSaveTripOpen] = useState(false)
    const [manageOpen, setManageOpen] = useState(false)
    const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
    const [justSaved, setJustSaved] = useState(false)
    const [isSelectingOnMap, setIsSelectingOnMap] = useState(false)
    const [isRouteMapOpen, setIsRouteMapOpen] = useState(false)
    const [locationMode, setLocationMode] = useState<'start' | 'end'>('start')
    const [locationError, setLocationError] = useState<string | null>(null)

    const canSave = startLocation && endLocation
    const locationModeRef = useRef<'start' | 'end'>('start')

    useEffect(() => {
        locationModeRef.current = locationMode
    }, [locationMode])

    useEffect(() => {
        if (timeType === "now") {
            setSelectedDate(new Date())
        }
    }, [timeType])

    const handleSave = (name: string) => {
        if (!startLocation || !endLocation) return
        saveTrip({
            name,
            startLocation,
            endLocation,
            maxWalkKm,
            walkSpeed,
            maxTransfers,
        })
        setJustSaved(true)
        setTimeout(() => setJustSaved(false), 2500)
    }

    const handleLoadTrip = (trip: SavedTrip) => {
        setStartLocation(trip.startLocation)
        setEndLocation(trip.endLocation)
        setTimeType("now")
        setSelectedDate(new Date())
        setMaxWalkKm(trip.maxWalkKm)
        setWalkSpeed(trip.walkSpeed)
        setMaxTransfers(trip.maxTransfers)
        setManageOpen(false)
    }

    const swapLocations = useCallback(() => {
        const temp = startLocation
        setStartLocation(endLocation)
        setEndLocation(temp)
    }, [startLocation, endLocation])

    const handleSelectFromMap = (mode: 'start' | 'end') => {
        setLocationMode(mode)
        setIsSelectingOnMap(true)
    }

    const handleUseCurrentLocation = (mode: 'start' | 'end') => {
        setLocationError(null)
        if (!navigator?.geolocation) {
            setLocationError("Current location is unavailable in this browser.")
            return
        }
        setIsLocating(mode)
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords
                try {
                    // Call backend reverse geocoding endpoint
                    const response = await ApiFetch<{ name: string }>(
                        `/map/reverse?lat=${latitude}&lon=${longitude}`
                    )
                    const locationName = response.ok ? response.data.name : "Current location"

                    const location: Location = {
                        lat: latitude,
                        lon: longitude,
                        label: locationName,
                    }
                    if (mode === 'start') {
                        setStartLocation(location)
                    } else {
                        setEndLocation(location)
                    }
                } catch (error) {
                    console.error("Error reverse geocoding location:", error)
                    // Fallback to generic label if reverse geocoding fails
                    const location: Location = {
                        lat: latitude,
                        lon: longitude,
                        label: "Current location",
                    }
                    if (mode === 'start') {
                        setStartLocation(location)
                    } else {
                        setEndLocation(location)
                    }
                } finally {
                    setIsLocating(null)
                }
            },
            () => {
                setLocationError("Unable to access your current location.")
                setIsLocating(null)
            },
            { enableHighAccuracy: true, timeout: 10000 }
        )
    }

    const handleMapClick = (lat: number, lon: number) => {
        if (locationModeRef.current === 'start') {
            setStartLocation({ lat, lon, label: "Start Point" })
        } else {
            setEndLocation({ lat, lon, label: "End Point" })
        }
        setIsSelectingOnMap(false)
    }

    const planJourney = async () => {
        if (!startLocation || !endLocation) return

        const searchDate = timeType === "now" ? new Date() : selectedDate
        setSelectedDate(searchDate)

        setIsSearching(true)
        setApiResponse([])
        try {
            const response = await ApiFetch<JourneyType[]>(
                `/services/plan?startLat=${startLocation.lat}&startLon=${startLocation.lon}&endLat=${endLocation.lat}&endLon=${endLocation.lon}&date=${searchDate.toISOString()}&timeType=${timeType}&maxWalkKm=${maxWalkKm}&walkSpeed=${walkSpeed}&maxTransfers=${maxTransfers}`
            )

            if (response.ok) {
                setApiResponse(response.data)
            }
        } catch (error) {
            console.error("Error planning journey:", error)
        } finally {
            setIsSearching(false)
        }
    }

    // Build map markers
    const mapMarkers: MapItem[] = []

    if (startLocation) {
        mapMarkers.push({
            lat: startLocation.lat,
            lon: startLocation.lon,
            icon: "start marker",
            id: "start",
            routeID: "",
            zIndex: 200,
            onClick: () => { },
            description: {
                text: `<strong>Start</strong>`,
                alwaysShow: true
            },
            type: "stop" as const
        })
    }

    if (endLocation) {
        mapMarkers.push({
            lat: endLocation.lat,
            lon: endLocation.lon,
            icon: "end marker",
            id: "end",
            routeID: "",
            zIndex: 200,
            onClick: () => { },
            description: {
                text: `<strong>End</strong>`,
                alwaysShow: true
            },
            type: "stop" as const
        })
    }

    if (selectedRoute) {
        selectedRoute.Legs.forEach((leg, index) => {
            if (leg.FromStop) {
                mapMarkers.push({
                    lat: leg.FromStop.stop_lat,
                    lon: leg.FromStop.stop_lon,
                    icon: "next stop marker",
                    id: leg.FromStop.stop_id + "-" + index,
                    routeID: '',
                    zIndex: 100,
                    onClick: () => { },
                    description: {
                        text: `<strong>${leg.FromStop?.stop_name}</strong><br/>${leg.Mode === 'transit' ? `Catch ${leg.Route?.route_short_name} - ${formatTime(leg.DepartureTime)}` : 'Start Walking'}`,
                        alwaysShow: false
                    },
                    type: "stop" as const
                })
            }
            if (leg.ToStop) {
                mapMarkers.push({
                    lat: leg.ToStop.stop_lat,
                    lon: leg.ToStop.stop_lon,
                    icon: "next stop marker",
                    id: leg.ToStop.stop_id + "-" + index,
                    routeID: '',
                    zIndex: 100,
                    onClick: () => { },
                    description: {
                        text: `<strong>${leg.ToStop?.stop_name}</strong><br/>${leg.Mode === 'transit' ? `Get off ${leg.Route?.route_short_name} - ${formatTime(leg.ArrivalTime)}` : 'Stop Walking'}`,
                        alwaysShow: false
                    },
                    type: "stop" as const
                })
            }
        })
    }

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="mx-auto flex h-12 max-w-lg items-center justify-between px-4">
                    <span className="text-sm font-semibold">Journey Planner</span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5 px-2.5 text-xs"
                            onClick={() => setManageOpen(true)}
                        >
                            <List className="h-3.5 w-3.5" />
                            Saved
                            {trips.length > 0 && (
                                <span className="ml-0.5 tabular-nums text-muted-foreground">
                                    ({trips.length})
                                </span>
                            )}
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setGlobalSettingsOpen(true)}
                            disabled={trips.length === 0}
                            aria-label="Update all trips"
                        >
                            <Settings2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-lg px-4 py-5 space-y-4">
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
                            onSelect={setStartLocation}
                            storageKey="recentStartLocations"
                            onSelectFromMap={() => handleSelectFromMap('start')}
                            onUseCurrentLocation={() => handleUseCurrentLocation('start')}
                            isLocating={isLocating === 'start'}
                            searchParamKey='start'
                        />
                        <LocationSearchInput
                            placeholder="To"
                            value={endLocation}
                            onSelect={setEndLocation}
                            storageKey="recentEndLocations"
                            onSelectFromMap={() => handleSelectFromMap('end')}
                            onUseCurrentLocation={() => handleUseCurrentLocation('end')}
                            isLocating={isLocating === 'end'}
                            searchParamKey='end'
                        />
                    </div>
                    <div className="flex flex-col justify-center shrink-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            onClick={swapLocations}
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
                            <Select value={timeType} onValueChange={(value) => setTimeType(value as "now" | "leaveat" | "arriveat")}>
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
                                <DatePicker
                                    date={selectedDate}
                                    onDateChange={setSelectedDate}
                                />
                            )}

                            <Select value={maxWalkKm} onValueChange={setMaxWalkKm}>
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

                            <Select value={walkSpeed} onValueChange={setWalkSpeed}>
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

                            <Select value={maxTransfers} onValueChange={setMaxTransfers}>
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
                    <Button className="flex-1 h-9 gap-1.5 text-sm" disabled={!canSave || isSearching} onClick={planJourney}>
                        {isSearching ? (
                            <>
                                <Spinner />
                                Planning
                            </>
                        ) : (
                            <>
                                <Search className="h-4 w-4" />
                                Plan
                            </>
                        )}
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        onClick={() => setSaveTripOpen(true)}
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

                {/* Quick-load saved trips */}
                {trips.length > 0 && (
                    <div className="rounded-md border divide-y overflow-hidden">
                        {trips.map((trip) => (
                            <button
                                key={trip.id}
                                type="button"
                                onClick={() => handleLoadTrip(trip)}
                                className="w-full text-left px-3 py-2 hover:bg-accent/50 transition-colors"
                            >
                                <p className="text-sm font-medium truncate">{trip.name}</p>
                                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                    {trip.startLocation.label} &rarr; {trip.endLocation.label}
                                </p>
                            </button>
                        ))}
                    </div>
                )}

                {/* Route Results */}
                {apiResponse.length > 0 && (
                    <div className="mt-6 space-y-2">
                        <h2 className="text-sm font-medium text-muted-foreground">
                            {apiResponse.length} route{apiResponse.length !== 1 ? 's' : ''} found
                        </h2>
                        <div className="space-y-2">
                            {apiResponse.map((route, index) => {
                                const hasDisruption = route.Legs.some(l => l.Mode === 'transit' && l.trip_usable === false)
                                return (
                                    <button
                                        key={index}
                                        type="button"
                                        className="w-full text-left rounded-lg border hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring overflow-hidden"
                                        onClick={() => {
                                            setSelectedRoute(route)
                                            setIsRouteMapOpen(true)
                                        }}
                                    >
                                        {hasDisruption && (
                                            <div className="flex items-center gap-2 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
                                                <AlertTriangle className="h-3 w-3" />
                                                Service disruption on this route
                                            </div>
                                        )}
                                        <div className="flex w-full flex-col gap-2 px-3 py-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-semibold">{formatDuration(route.TotalDuration)}</span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {formatTimeWithRealtime(route.DepartureTime, getFirstTransitLeg(route)?.scheduled_departure_time, getFirstTransitLeg(route)?.realtime_status)}
                                                        <ArrowRight className="inline mx-1 h-3 w-3" />
                                                        {formatTimeWithRealtime(route.ArrivalTime, getLastTransitLeg(route)?.scheduled_arrival_time, getLastTransitLeg(route)?.realtime_status)}
                                                    </span>
                                                </div>
                                                <Badge variant={route.Transfers === 0 ? 'default' : 'secondary'} className="text-[10px] shrink-0">
                                                    {route.Transfers === 0 ? 'Direct' : `${route.Transfers} transfer${route.Transfers !== 1 ? 's' : ''}`}
                                                </Badge>
                                            </div>
                                            <div className="flex items-center flex-wrap gap-y-1 gap-x-0.5">
                                                {getRouteStepsJSX(route)}
                                            </div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}
            </main>

            {/* Route detail modal/sheet */}
            <Sheet open={isRouteMapOpen} onOpenChange={setIsRouteMapOpen}>
                <SheetContent side={"bottom"} className={`max-h-[85vh] overflow-hidden`}>
                    <SheetHeader className="max-w-5xl mx-auto">
                        <SheetTitle>Route Details</SheetTitle>
                        <SheetDescription>Review the selected journey.</SheetDescription>
                    </SheetHeader>
                    {isMobile ? (
                        <Tabs defaultValue="details" className="mt-4 max-w-5xl mx-auto">
                            <TabsList className="w-full">
                                <TabsTrigger value="map" className="flex-1">Map</TabsTrigger>
                                <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
                            </TabsList>
                            <TabsContent value="map">
                                {selectedRoute && (
                                    <div className={`h-[60vh] overflow-hidden rounded-md border`}>
                                        <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                                            <LeafletMap
                                                defaultZoom={[[selectedRoute.StartLat, selectedRoute.StartLon], [selectedRoute.EndLat, selectedRoute.EndLon]]}
                                                mapItems={mapMarkers}
                                                map_id="journey-planner-route-map"
                                                height="100%"
                                                line={selectedRoute ? { GeoJson: selectedRoute.RouteGeoJSON, color: "" } : undefined}
                                            />
                                        </Suspense>
                                    </div>
                                )}
                            </TabsContent>
                            <TabsContent value="details">
                                {selectedRoute && (
                                    <div className="max-h-[60vh] overflow-y-auto p-2">
                                        <RouteDetailsContent route={selectedRoute} />
                                    </div>
                                )}
                            </TabsContent>
                        </Tabs>
                    ) : (
                        <div className="flex gap-2 flex-grow mt-4 max-w-5xl mx-auto">
                            {selectedRoute && (
                                <div className={`h-[60vh] overflow-hidden rounded-md border w-full`}>
                                    <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                                        <LeafletMap
                                            defaultZoom={[[selectedRoute.StartLat, selectedRoute.StartLon], [selectedRoute.EndLat, selectedRoute.EndLon]]}
                                            mapItems={mapMarkers}
                                            map_id="journey-planner-route-map"
                                            height="100%"
                                            line={selectedRoute ? { GeoJson: selectedRoute.RouteGeoJSON, color: "" } : undefined}
                                        />
                                    </Suspense>
                                </div>
                            )}
                            {selectedRoute && (
                                <div className="max-h-[60vh] overflow-y-auto p-2 flex-grow">
                                    <RouteDetailsContent route={selectedRoute} />
                                </div>
                            )}
                        </div>
                    )}
                </SheetContent>
            </Sheet>

            {/* Map location picker */}
            {isMobile ? (
                <Sheet open={isSelectingOnMap} onOpenChange={setIsSelectingOnMap}>
                    <SheetContent side="bottom" className="h-[85vh] overflow-hidden">
                        <SheetHeader>
                            <SheetTitle>Select {locationMode === 'start' ? 'start' : 'end'} location</SheetTitle>
                            <SheetDescription>Tap the map to set your {locationMode} point.</SheetDescription>
                        </SheetHeader>
                        <div className="mt-4 h-[65vh] overflow-hidden rounded-md border">
                            <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                                <LeafletMap
                                    defaultZoom={["user", currentUrl.defaultMapCenter]}
                                    mapItems={mapMarkers}
                                    map_id="journey-planner-select-map"
                                    height="100%"
                                    onMapClick={handleMapClick}
                                />
                            </Suspense>
                        </div>
                    </SheetContent>
                </Sheet>
            ) : (
                <Dialog open={isSelectingOnMap} onOpenChange={setIsSelectingOnMap}>
                    <DialogContent className="max-w-5xl">
                        <DialogHeader>
                            <DialogTitle>Select {locationMode === 'start' ? 'start' : 'end'} location</DialogTitle>
                            <DialogDescription>Click the map to set your {locationMode} point.</DialogDescription>
                        </DialogHeader>
                        <div className="mt-4 h-[65vh] overflow-hidden rounded-md border">
                            <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                                <LeafletMap
                                    defaultZoom={["user", currentUrl.defaultMapCenter]}
                                    mapItems={mapMarkers}
                                    map_id="journey-planner-select-map"
                                    height="100%"
                                    onMapClick={handleMapClick}
                                />
                            </Suspense>
                        </div>
                    </DialogContent>
                </Dialog>
            )}

            {/* Dialogs */}
            <SaveTripDialog
                open={saveTripOpen}
                onOpenChange={setSaveTripOpen}
                startLocation={startLocation}
                endLocation={endLocation}
                onSave={handleSave}
            />

            <ManageTripsSheet
                open={manageOpen}
                onOpenChange={setManageOpen}
                savedTrips={trips}
                onLoadTrip={handleLoadTrip}
                onDeleteTrip={deleteTrip}
                onUpdateTrip={updateTrip}
            />

            <GlobalTripSettingsDialog
                open={globalSettingsOpen}
                onOpenChange={setGlobalSettingsOpen}
                tripCount={trips.length}
                onApply={updateAllTrips}
            />
        </div>
    )
}

// ── Helper Functions ──────────────────────────────────────────────────────────

function getFirstTransitLeg(route: JourneyType): Leg | null {
    return route.Legs.find(l => l.Mode === 'transit') ?? null
}

function getLastTransitLeg(route: JourneyType): Leg | null {
    const legs = route.Legs.filter(l => l.Mode === 'transit')
    return legs[legs.length - 1] ?? null
}

function formatTime(dateString: string | Date) {
    return new Date(dateString).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    })
}

function formatDuration(nanoseconds: number) {
    const minutes = Math.round(nanoseconds / 60000000000)
    if (minutes < 60) return `${minutes} min`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
}

function formatTimeWithRealtime(actual: Date, scheduled?: Date, status?: RealtimeStatus): React.ReactNode {
    const actualStr = formatTime(actual)
    const isDelayed = status === RealtimeStatus.Delayed
    const isEarly = status === RealtimeStatus.Early
    if ((isDelayed || isEarly) && scheduled) {
        const scheduledStr = formatTime(scheduled)
        if (scheduledStr !== actualStr) {
            return (
                <span className="inline-flex items-baseline gap-1">
                    <span>{actualStr}</span>
                    <span className="line-through text-muted-foreground/60 text-xs hidden">{scheduledStr}</span>
                </span>
            )
        }
    }
    return actualStr
}

function getWaitingTimeNs(prev: Leg, next: Leg) {
    const arrival = new Date(prev.ArrivalTime).getTime()
    const departure = new Date(next.DepartureTime).getTime()

    const diffMs = departure - arrival
    if (diffMs <= 0) return null

    return diffMs * 1_000_000
}

function getRouteStepsJSX(route: JourneyType) {
    return route.Legs.map((leg, index) => {
        const isLast = index === route.Legs.length - 1
        const nextLeg = !isLast ? route.Legs[index + 1] : null
        const waitingNs = nextLeg ? getWaitingTimeNs(leg, nextLeg) : null
        const isDelayed = leg.realtime_status === RealtimeStatus.Delayed
        const isEarly = leg.realtime_status === RealtimeStatus.Early
        const isOnTime = leg.realtime_status === RealtimeStatus.OnTime
        const hasRealtime = isDelayed || isEarly || isOnTime

        return (
            <span key={index} className="inline-flex items-center gap-1">
                {leg.Mode === "walk" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Footprints className="h-3 w-3" />
                        {Math.round(leg.Duration / 60000000000)} min
                    </span>
                ) : (
                    <span className="relative inline-flex items-center">
                        <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium"
                            style={{
                                background:
                                    "#" +
                                    (leg.Route?.route_color && leg.Route.route_color !== ""
                                        ? leg.Route.route_color
                                        : "424242"),
                                color: leg.Route?.route_text_color && leg.Route.route_text_color !== ""
                                    ? `#${leg.Route.route_text_color}`
                                    : "#ffffff",
                                filter: "brightness(0.9) contrast(1.1)",
                                opacity: leg.trip_usable === false ? 0.5 : 1,
                            }}
                        >
                            {leg.Route?.route_short_name || leg.RouteID}
                        </span>
                        {hasRealtime && (
                            <span className={`absolute -top-1 -right-1 h-2 w-2 rounded-full ${isDelayed ? 'bg-amber-500' : 'bg-green-500'}`}>
                                <span className={`absolute inset-0 rounded-full animate-ping opacity-75 ${isDelayed ? 'bg-amber-500' : 'bg-green-500'}`} />
                            </span>
                        )}
                    </span>
                )}

                {!isLast && <ArrowRight className="h-2.5 w-2.5 text-muted-foreground mx-0.5" />}

                {!isLast && waitingNs && waitingNs >= 60000000000 && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground mx-1 text-xs">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDuration(waitingNs)}
                        <ArrowRight className="h-2.5 w-2.5" />
                    </span>
                )}
            </span>
        )
    })
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

function RouteDetailsContent({ route }: { route: JourneyType }) {
    return (
        <div className="space-y-1">
            {route.Legs.map((leg, legIndex) => {
                const isWalk = leg.Mode === 'walk'
                const isDelayed = leg.realtime_status === RealtimeStatus.Delayed
                const isEarly = leg.realtime_status === RealtimeStatus.Early
                const isOnTime = leg.realtime_status === RealtimeStatus.OnTime
                const hasRealtime = isDelayed || isEarly || isOnTime
                const routeColor = leg.Route?.route_color && leg.Route.route_color !== "" ? `#${leg.Route.route_color}` : "#424242"

                return (
                    <div key={legIndex} className="relative">
                        {!isWalk && leg.trip_usable === false && (
                            <div className="mb-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                <span>This service is not running. Check alternative routes.</span>
                            </div>
                        )}

                        <div className="flex items-center gap-2 py-1">
                            {isWalk ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium text-pink-500">
                                    <Footprints className="h-3 w-3" />
                                    Walk · {Math.round(leg.Duration / 60000000000)} min
                                    {leg.DistanceKm > 0 && <span className="text-muted-foreground/70">· {leg.DistanceKm.toFixed(2)} km</span>}
                                </span>
                            ) : (
                                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                    <span
                                        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold"
                                        style={{
                                            backgroundColor: routeColor,
                                            color: leg.Route?.route_text_color && leg.Route.route_text_color !== ""
                                                ? `#${leg.Route.route_text_color}`
                                                : "#ffffff",
                                            filter: "brightness(0.9) contrast(1.1)",
                                            opacity: leg.trip_usable === false ? 0.5 : 1,
                                        }}
                                    >
                                        {leg.Route?.vehicle_type && <span className="opacity-80">{leg.Route.vehicle_type}</span>}
                                        {leg.Route?.route_short_name || leg.RouteID}
                                    </span>
                                    {hasRealtime && (
                                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${isDelayed ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                                            <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${isDelayed ? 'bg-amber-500' : 'bg-green-500'}`} />
                                            {isDelayed ? 'Late' : 'Early'}
                                        </span>
                                    )}
                                    {leg.realtime_status === RealtimeStatus.OnTime && (
                                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                                            On time
                                        </span>
                                    )}
                                    {leg.realtime_status === RealtimeStatus.Scheduled && (
                                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                                            Scheduled
                                        </span>
                                    )}
                                    <span className="text-xs text-muted-foreground ">· {formatDuration(leg.Duration)}</span>
                                </div>
                            )}
                        </div>

                        <div className="ml-2 space-y-0 border-l-2 border-border pl-4">
                            <div className="relative py-2">
                                <span className="absolute -left-[21px] top-3 h-3 w-3 rounded-full border-2 border-background bg-green-500 ring-1 ring-green-500" />
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                    <span className="font-medium text-sm">{formatTime(leg.DepartureTime)}</span>
                                    {hasRealtime && leg.scheduled_departure_time && formatTime(leg.scheduled_departure_time) !== formatTime(leg.DepartureTime) && (
                                        <span className="text-xs text-muted-foreground line-through">{formatTime(leg.scheduled_departure_time)}</span>
                                    )}
                                    <span className="text-sm text-muted-foreground">{leg.FromStop?.stop_name || 'Start'}</span>
                                    <div className="flex items-center gap-1">
                                        {leg.FromStop?.platform_number && leg.FromStop.platform_number !== "" && (
                                            <Badge variant="outline" className="text-xs py-0 h-5">Plat. {leg.FromStop.platform_number}</Badge>
                                        )}
                                        {leg.FromStop?.stop_headsign && leg.FromStop.stop_headsign !== "" && (
                                            <span className="text-xs text-muted-foreground">towards {leg.FromStop.stop_headsign}</span>
                                        )}
                                        {leg.FromStop?.wheelchair_boarding === 1 && (
                                            <Accessibility className="h-3 w-3 text-muted-foreground" />
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="relative py-2">
                                <span className="absolute -left-[21px] top-3 h-3 w-3 rounded-full border-2 border-background bg-destructive ring-1 ring-destructive" />
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                    <span className="font-medium text-sm">{formatTime(leg.ArrivalTime)}</span>
                                    {hasRealtime && leg.scheduled_arrival_time && formatTime(leg.scheduled_arrival_time) !== formatTime(leg.ArrivalTime) && (
                                        <span className="text-xs text-muted-foreground line-through">{formatTime(leg.scheduled_arrival_time)}</span>
                                    )}
                                    <span className="text-sm text-muted-foreground">{leg.ToStop?.stop_name || 'Destination'}</span>
                                    <div className="flex items-center gap-1">
                                        {leg.ToStop?.platform_number && leg.ToStop.platform_number !== "" && (
                                            <Badge variant="outline" className="text-xs py-0 h-5">Plat. {leg.ToStop.platform_number}</Badge>
                                        )}
                                        {leg.ToStop?.stop_headsign && leg.ToStop.stop_headsign !== "" && (
                                            <span className="text-xs text-muted-foreground">towards {leg.ToStop.stop_headsign}</span>
                                        )}
                                        {leg.ToStop?.wheelchair_boarding === 1 && (
                                            <Accessibility className="h-3 w-3 text-muted-foreground" />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {legIndex < route.Legs.length - 1 && (() => {
                            const nextLeg = route.Legs[legIndex + 1]
                            const waitNs = getWaitingTimeNs(leg, nextLeg)
                            if (!waitNs || waitNs < 60000000000) return null
                            return (
                                <div className="ml-2 flex items-center gap-2 py-1.5 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    <span>{formatDuration(waitNs)} wait</span>
                                </div>
                            )
                        })()}
                    </div>
                )
            })}
        </div>
    )
}
