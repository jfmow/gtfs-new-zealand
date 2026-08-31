"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { SaveTripDialog } from "@/components/trips/save-trip-dialog"
import { ManageTripsSheet } from "@/components/trips/manage-trips-sheet"
import { GlobalTripSettingsDialog } from "@/components/trips/global-trip-settings-dialog"
import { Button } from "@/components/ui/button"
import { List, Settings2 } from "lucide-react"
import { ApiFetch, useUrl } from "@/lib/url-context"
import { useQueryParams } from "@/lib/url-params"
import type { Location, JourneyType } from "@/components/journey/types"
import { useSavedTrips } from "@/components/journey/use-saved-trips"
import { getTransitTripIds } from "@/components/journey/helpers"
import { SearchForm } from "@/components/journey/search-form"
import { QuickTripsRail } from "@/components/journey/quick-trips-rail"
import { ResultsList } from "@/components/journey/results-list"
import { RouteDetailSheet } from "@/components/journey/route-detail-sheet"
import { MapPicker } from "@/components/journey/map-picker"

export default function Page() {
    const { trips, saveTrip, updateTrip, deleteTrip, reorderTrips, updateAllTrips } = useSavedTrips()
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

    const canSave = !!(startLocation && endLocation)

    // Trip-ID signature of the shared journey to auto-select once results come
    // back in - null once there's nothing left to try to match.
    const [autoOpenSignature, setAutoOpenSignature] = useState<string | null>(null)
    // Whether the auto-selected route should also start live tracking immediately
    // (a "share this journey" link is meant to let the recipient track it too).
    const [autoTrack, setAutoTrack] = useState(false)
    const autoPlannedRef = useRef(false)

    // Prefill from a shared journey link. A plain link carries just the
    // start/end/options; a "share this journey" link (see buildShareUrl below)
    // additionally carries an `id` (see planCache on the backend - the exact
    // plan, reopenable up to 30 min after it arrives even if a fresh search
    // wouldn't find it any more) plus date/timeType/trips/track as a fallback
    // for links saved before the id-based cache existed, or if that entry has
    // since expired.
    const shared = useQueryParams({
        startLat: { type: "number", default: 0 },
        startLon: { type: "number", default: 0 },
        startLabel: { type: "string", default: "" },
        endLat: { type: "number", default: 0 },
        endLon: { type: "number", default: 0 },
        endLabel: { type: "string", default: "" },
        sharedMaxWalkKm: { type: "string", default: "", keys: ["maxWalkKm"] },
        sharedWalkSpeed: { type: "string", default: "", keys: ["walkSpeed"] },
        sharedMaxTransfers: { type: "string", default: "", keys: ["maxTransfers"] },
        sharedId: { type: "string", default: "", keys: ["id"] },
        sharedDate: { type: "string", default: "", keys: ["date"] },
        sharedTrips: { type: "string", default: "", keys: ["trips"] },
        sharedTrack: { type: "boolean", default: false, keys: ["track"] },
    })
    const idLookupAttemptedRef = useRef(false)

    useEffect(() => {
        if (shared.startLat.found && shared.startLon.found) {
            setStartLocation({ lat: shared.startLat.value, lon: shared.startLon.value, label: shared.startLabel.value || "Start" })
        }
        if (shared.endLat.found && shared.endLon.found) {
            setEndLocation({ lat: shared.endLat.value, lon: shared.endLon.value, label: shared.endLabel.value || "Destination" })
        }
        if (shared.sharedMaxWalkKm.found) setMaxWalkKm(shared.sharedMaxWalkKm.value)
        if (shared.sharedWalkSpeed.found) setWalkSpeed(shared.sharedWalkSpeed.value)
        if (shared.sharedMaxTransfers.found) setMaxTransfers(shared.sharedMaxTransfers.value)
        if (shared.sharedDate.found) {
            setTimeType("leaveat")
            setSelectedDate(new Date(shared.sharedDate.value))
        }

        if (shared.sharedId.found && !idLookupAttemptedRef.current) {
            idLookupAttemptedRef.current = true
            setAutoTrack(shared.sharedTrack.value)
            ApiFetch<JourneyType[]>(`/services/plan/${encodeURIComponent(shared.sharedId.value)}`).then((res) => {
                if (res.ok && res.data.length > 0) {
                    setApiResponse(res.data)
                    setSelectedRoute(res.data[0])
                    setIsRouteMapOpen(true)
                } else if (shared.sharedTrips.found) {
                    // Cache entry gone (expired, or the backend restarted) -
                    // fall back to re-planning and matching by trip signature.
                    setAutoOpenSignature(shared.sharedTrips.value)
                }
            })
        } else if (!shared.sharedId.found && shared.sharedTrips.found) {
            // Links created before the id-based cache existed.
            setAutoOpenSignature(shared.sharedTrips.value)
            setAutoTrack(shared.sharedTrack.value)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shared.startLat.found, shared.endLat.found])

    // Once the shared start/end/date have landed, auto-run the search exactly once.
    useEffect(() => {
        if (!autoOpenSignature || autoPlannedRef.current || !startLocation || !endLocation) return
        autoPlannedRef.current = true
        planJourney()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoOpenSignature, startLocation, endLocation])

    // Once results are back, try to auto-select the journey that was shared.
    // If its trips no longer match (schedule/day changed), just leave the
    // results list showing rather than force a wrong selection.
    useEffect(() => {
        if (!autoOpenSignature || apiResponse.length === 0) return
        const match = apiResponse.find((r) => getTransitTripIds(r).join(",") === autoOpenSignature)
        if (match) {
            setSelectedRoute(match)
            setIsRouteMapOpen(true)
            // autoTrack is left as-is here on purpose - cleared below, one render
            // after RouteDetailSheet has had a chance to consume it via ref.
        } else {
            setAutoTrack(false)
        }
        setAutoOpenSignature(null)
    }, [apiResponse, autoOpenSignature])

    // Clears autoTrack the render after the auto-opened route has consumed it,
    // so a later manually-selected route doesn't also start in tracking mode.
    // Deliberately keyed on selectedRoute only - including autoTrack itself
    // would re-run this the instant it's cleared, which is harmless here but
    // not the intent.
    useEffect(() => {
        if (autoTrack && selectedRoute) setAutoTrack(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRoute])

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

    const handleLoadTrip = useCallback((trip: { startLocation: Location; endLocation: Location; maxWalkKm: string; walkSpeed: string; maxTransfers: string }) => {
        setStartLocation(trip.startLocation)
        setEndLocation(trip.endLocation)
        setTimeType("now")
        setSelectedDate(new Date())
        setMaxWalkKm(trip.maxWalkKm)
        setWalkSpeed(trip.walkSpeed)
        setMaxTransfers(trip.maxTransfers)
        setManageOpen(false)
    }, [])

    const swapLocations = useCallback(() => {
        setStartLocation(endLocation)
        setEndLocation(startLocation)
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
                    const response = await ApiFetch<{ name: string }>(
                        `/map/reverse?lat=${latitude}&lon=${longitude}`
                    )
                    const locationName = response.ok ? response.data.name : "Current location"
                    const location: Location = { lat: latitude, lon: longitude, label: locationName }
                    if (mode === 'start') setStartLocation(location)
                    else setEndLocation(location)
                } catch (error) {
                    console.error("Error reverse geocoding location:", error)
                    const location: Location = { lat: latitude, lon: longitude, label: "Current location" }
                    if (mode === 'start') setStartLocation(location)
                    else setEndLocation(location)
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
        if (locationMode === 'start') {
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

    // Builds a link that reopens (and starts tracking) this exact journey, so
    // whoever it's shared with can follow the live vehicle too - `id` reopens
    // the exact cached plan (see planCache on the backend), which keeps
    // working up to 30 min after it arrives even once its departure time is
    // in the past. date/timeType/trips are kept as a fallback (re-plan and
    // match by transit-leg signature) for when that cache entry is gone, and
    // `track=1` starts live tracking immediately rather than requiring the
    // recipient to tap GO themselves.
    const buildShareUrl = useCallback((route: JourneyType) => {
        if (typeof window === "undefined" || !startLocation || !endLocation) return ""
        const params = new URLSearchParams({
            startLat: String(startLocation.lat),
            startLon: String(startLocation.lon),
            startLabel: startLocation.label,
            endLat: String(endLocation.lat),
            endLon: String(endLocation.lon),
            endLabel: endLocation.label,
            maxWalkKm,
            walkSpeed,
            maxTransfers,
            id: route.ID,
            date: new Date(route.DepartureTime).toISOString(),
            timeType: "leaveat",
            trips: getTransitTripIds(route).join(","),
            track: "1",
        })
        return `${window.location.origin}/plan?${params.toString()}`
    }, [startLocation, endLocation, maxWalkKm, walkSpeed, maxTransfers])

    return (
        <div className="min-h-screen bg-background">
            {/* The persistent site nav already shows "Planner" as the active
                tab and spans the full page width, so a second, narrower,
                title-duplicating header directly beneath it just looked like
                a layout glitch. Saved-trip actions now sit inline with the
                page content instead, in the same width column as everything
                else on the page. */}
            <main className="mx-auto max-w-2xl px-4 py-6 space-y-5">
                <div className="flex items-center justify-between gap-2">
                    <h1 className="text-lg font-semibold">Journey Planner</h1>
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

                <SearchForm
                    startLocation={startLocation}
                    endLocation={endLocation}
                    onSelectStart={setStartLocation}
                    onSelectEnd={setEndLocation}
                    onSelectFromMap={handleSelectFromMap}
                    onUseCurrentLocation={handleUseCurrentLocation}
                    isLocating={isLocating}
                    onSwap={swapLocations}
                    locationError={locationError}
                    timeType={timeType}
                    onTimeTypeChange={setTimeType}
                    selectedDate={selectedDate}
                    onDateChange={setSelectedDate}
                    maxWalkKm={maxWalkKm}
                    onMaxWalkKmChange={setMaxWalkKm}
                    walkSpeed={walkSpeed}
                    onWalkSpeedChange={setWalkSpeed}
                    maxTransfers={maxTransfers}
                    onMaxTransfersChange={setMaxTransfers}
                    isSearching={isSearching}
                    canSave={canSave}
                    justSaved={justSaved}
                    onPlan={planJourney}
                    onSaveClick={() => setSaveTripOpen(true)}
                />

                <QuickTripsRail
                    trips={trips}
                    onLoadTrip={handleLoadTrip}
                    onUpdateTrip={updateTrip}
                    onDeleteTrip={deleteTrip}
                    onReorderTrips={reorderTrips}
                />

                <ResultsList
                    routes={apiResponse}
                    onSelect={(route) => {
                        setSelectedRoute(route)
                        setIsRouteMapOpen(true)
                    }}
                />
            </main>

            <RouteDetailSheet
                open={isRouteMapOpen}
                onOpenChange={setIsRouteMapOpen}
                route={selectedRoute ?? null}
                startLocation={startLocation}
                endLocation={endLocation}
                buildShareUrl={buildShareUrl}
                onShowAlternates={() => setIsRouteMapOpen(false)}
                autoTrack={autoTrack}
            />

            <MapPicker
                open={isSelectingOnMap}
                onOpenChange={setIsSelectingOnMap}
                locationMode={locationMode}
                onMapClick={handleMapClick}
                startLocation={startLocation}
                endLocation={endLocation}
                defaultMapCenter={currentUrl.defaultMapCenter}
            />

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
                onReorderTrips={reorderTrips}
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
