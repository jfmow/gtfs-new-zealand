"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { SaveTripDialog } from "@/components/trips/save-trip-dialog"
import { ManageTripsSheet } from "@/components/trips/manage-trips-sheet"
import { GlobalTripSettingsDialog } from "@/components/trips/global-trip-settings-dialog"
import { Button } from "@/components/ui/button"
import { AlarmClock, List, Route as RouteIcon, Settings2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import type { TravelMode } from "@/components/journey/planner-options"
import { ApiFetch, useUrl } from "@/lib/url-context"
import { getRegionSlug } from "@/lib/url-store"
import { useQueryParams } from "@/lib/url-params"
import type { Location, JourneyType } from "@/components/journey/types"
import { resolveRouteIds, type RouteOption } from "@/components/journey/route-filter"
import { useSavedTrips } from "@/components/journey/use-saved-trips"
import { formatTime, getTransitTripIds, latestDeparture, pruneDominatedPlans } from "@/components/journey/helpers"
import { SearchForm } from "@/components/journey/search-form"
import { QuickTripsRail } from "@/components/journey/quick-trips-rail"
import { ResultsList } from "@/components/journey/results-list"
import { RouteDetailSheet } from "@/components/journey/route-detail-sheet"
import { JourneyErrorBoundary } from "@/components/journey/journey-error-boundary"
import { MapPicker } from "@/components/journey/map-picker"
import { LeaveReminderDialog } from "@/components/journey/leave-reminder-dialog"
import { useActiveJourney } from "@/components/journey/use-active-journey"
import { EasyPlanner } from "@/components/journey/easy/easy-planner"
import { Header } from "@/components/nav"
import { usePlannerStyle } from "@/lib/planner-style"
import { useRouter } from "next/router"

function useMediaQuery(query: string) {
    const [matches, setMatches] = useState(false)
    useEffect(() => {
        const mql = window.matchMedia(query)
        const update = () => setMatches(mql.matches)
        update()
        mql.addEventListener("change", update)
        return () => mql.removeEventListener("change", update)
    }, [query])
    return matches
}

/** Query keys a saved place's "plan a trip there" link carries - the step-by-step planner takes these as question 1's answer. */
const PLACE_LINK_KEYS = new Set(["endLat", "endLon", "endLabel", "fromHere"])

/**
 * The Planner tab: the step-by-step planner when Settings -> Planner says so
 * (a saved place's link answers its first question), otherwise the full
 * planner. Links for a specific search or journey (shared journeys, reminder
 * taps, saved trips, resume) always open the full planner, as on iOS.
 */
export default function Page() {
    const router = useRouter()
    const [style, setStyle] = usePlannerStyle()
    if (!router.isReady || style === null) return null

    const keys = Object.keys(router.query)
    const isPlaceLink = keys.length > 0 && keys.every((k) => PLACE_LINK_KEYS.has(k)) && !!router.query.endLat
    if (style === "stepByStep" && (keys.length === 0 || isPlaceLink)) {
        const q = router.query
        const destination = isPlaceLink
            ? { lat: Number(q.endLat), lon: Number(q.endLon), label: typeof q.endLabel === "string" && q.endLabel ? q.endLabel : "Destination" }
            : null
        return (
            <>
                <Header title="Journey Planner" />
                <EasyPlanner
                    key={destination ? `${destination.lat},${destination.lon}` : "fresh"}
                    initialDestination={destination}
                    onUseFullPlanner={() => setStyle("standard")}
                />
            </>
        )
    }
    return <StandardPlanner />
}

function StandardPlanner() {
    const { trips, saveTrip, updateTrip, deleteTrip, reorderTrips, updateAllTrips } = useSavedTrips()
    const { currentUrl } = useUrl()

    // Journey form state
    const [startLocation, setStartLocation] = useState<Location | null>(null)
    const [endLocation, setEndLocation] = useState<Location | null>(null)
    const [isLocating, setIsLocating] = useState<'start' | 'end' | null>(null)
    const [maxWalkKm, setMaxWalkKm] = useState("1")
    const [walkSpeed, setWalkSpeed] = useState("4.8")
    const [maxTransfers, setMaxTransfers] = useState("5")
    const [minResults, setMinResults] = useState("3")
    const [onlyRoutes, setOnlyRoutes] = useState<RouteOption[]>([])
    const [modes, setModes] = useState<TravelMode[]>([])
    const [selectedDate, setSelectedDate] = useState<Date>(new Date())
    const [timeType, setTimeType] = useState<"now" | "leaveat" | "arriveat">("now")

    // Journey results state
    const [apiResponse, setApiResponse] = useState<JourneyType[]>([])
    const [selectedRoute, setSelectedRoute] = useState<JourneyType | undefined>()
    const [isSearching, setIsSearching] = useState(false)
    /** The search behind `apiResponse` and when it ran - "Later departures" pages on from it, and a "Leave now" one goes stale. */
    const [lastSearch, setLastSearch] = useState<null | { from: Location; to: Location; date: Date; timeType: "now" | "leaveat" | "arriveat"; at: Date }>(null)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    /** Wide screens show the selected journey beside the results (the iPad layout), not in a dialog. */
    const isWide = useMediaQuery("(min-width: 1024px)")
    // Snapshot taken when the rider re-plans mid-journey, so they can bail back
    // to the route they were on without re-searching.
    const [replanSnapshot, setReplanSnapshot] = useState<null | {
        route: JourneyType | undefined
        results: JourneyType[]
        start: Location | null
        timeType: "now" | "leaveat" | "arriveat"
        date: Date
    }>(null)

    // UI state
    const [saveTripOpen, setSaveTripOpen] = useState(false)
    const [leaveReminderRoute, setLeaveReminderRoute] = useState<JourneyType | null>(null)
    const [leaveReminderOpen, setLeaveReminderOpen] = useState(false)
    const [manageOpen, setManageOpen] = useState(false)
    const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
    const [justSaved, setJustSaved] = useState(false)
    const [isSelectingOnMap, setIsSelectingOnMap] = useState(false)
    const [isRouteMapOpen, setIsRouteMapOpen] = useState(false)
    const [locationMode, setLocationMode] = useState<'start' | 'end'>('start')
    const [locationError, setLocationError] = useState<string | null>(null)
    // Set only after a completed search comes back empty/failed - cleared the
    // instant a new search starts.
    const [planError, setPlanError] = useState<string | null>(null)

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
        sharedMinResults: { type: "string", default: "", keys: ["minResults"] },
        sharedOnlyRoutes: { type: "string", default: "", keys: ["onlyRoutes"] },
        sharedModes: { type: "string", default: "", keys: ["modes"] },
        sharedId: { type: "string", default: "", keys: ["id"] },
        sharedDate: { type: "string", default: "", keys: ["date"] },
        sharedTrips: { type: "string", default: "", keys: ["trips"] },
        sharedTrack: { type: "boolean", default: false, keys: ["track"] },
        resume: { type: "boolean", default: false, keys: ["resume"] },
        // A saved place's chip on the home page: plan from the rider's
        // location to endLat/endLon straight away.
        fromHere: { type: "boolean", default: false, keys: ["fromHere"] },
        // A saved trip's card on the Schedule tab: plan it straight away.
        savedTripId: { type: "string", default: "", keys: ["trip"] },
    })
    const idLookupAttemptedRef = useRef(false)
    const resumeAttemptedRef = useRef(false)

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
        if (shared.sharedMinResults.found) setMinResults(shared.sharedMinResults.value)
        if (shared.sharedOnlyRoutes.found) {
            resolveRouteIds(shared.sharedOnlyRoutes.value.split(",").filter(Boolean)).then(setOnlyRoutes)
        }
        if (shared.sharedModes.found) {
            setModes(shared.sharedModes.value.split(",").filter((m): m is TravelMode => m === "bus" || m === "train" || m === "ferry"))
        }
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
            onlyRoutes,
            modes,
        })
        setJustSaved(true)
        setTimeout(() => setJustSaved(false), 2500)
    }

    const handleLoadTrip = useCallback((trip: { startLocation: Location; endLocation: Location; maxWalkKm: string; walkSpeed: string; maxTransfers: string; onlyRoutes?: RouteOption[]; modes?: TravelMode[] }) => {
        setStartLocation(trip.startLocation)
        setEndLocation(trip.endLocation)
        setTimeType("now")
        setSelectedDate(new Date())
        setMaxWalkKm(trip.maxWalkKm)
        setWalkSpeed(trip.walkSpeed)
        setMaxTransfers(trip.maxTransfers)
        setOnlyRoutes(trip.onlyRoutes ?? [])
        setModes(trip.modes ?? [])
        setManageOpen(false)
    }, [])

    const swapLocations = useCallback(() => {
        setStartLocation(endLocation)
        setEndLocation(startLocation)
    }, [startLocation, endLocation])

    const openLeaveReminder = useCallback((route: JourneyType) => {
        setLeaveReminderRoute(route)
        setLeaveReminderOpen(true)
    }, [])

    const { activeJourney } = useActiveJourney()

    const resumeJourney = useCallback(async () => {
        if (!activeJourney) return
        setStartLocation(activeJourney.startLocation)
        setEndLocation(activeJourney.endLocation)
        let route = activeJourney.route
        // Prefer the server's copy when the durable plan store still has it
        // (keeps the route id + geometry canonical); fall back to the local copy.
        if (activeJourney.planId) {
            try {
                const res = await ApiFetch<JourneyType[]>(`/services/plan/${encodeURIComponent(activeJourney.planId)}`)
                if (res.ok && res.data.length > 0) route = res.data[0]
            } catch { /* offline / gone - use the local copy */ }
        }
        setApiResponse([route])
        setSelectedRoute(route)
        setAutoTrack(true)
        setIsRouteMapOpen(true)
    }, [activeJourney])

    // Landed here from the app-wide resume popup (?resume=1).
    useEffect(() => {
        if (!shared.resume.found || resumeAttemptedRef.current || !activeJourney) return
        resumeAttemptedRef.current = true
        resumeJourney()
        window.history.replaceState(null, "", "/plan")
    }, [shared.resume.found, activeJourney, resumeJourney])

    // ?fromHere=1 - locate the rider for From, then plan once both ends are in.
    const [planFromHere, setPlanFromHere] = useState(false)
    const fromHereAttemptedRef = useRef(false)
    useEffect(() => {
        if (!shared.fromHere.found || fromHereAttemptedRef.current) return
        fromHereAttemptedRef.current = true
        setPlanFromHere(true)
        handleUseCurrentLocation('start')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shared.fromHere.found])
    useEffect(() => {
        if (!planFromHere) return
        if (locationError) return setPlanFromHere(false)
        if (!startLocation || !endLocation) return
        setPlanFromHere(false)
        planJourney()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [planFromHere, startLocation, endLocation, locationError])

    // ?trip=<id> - load that saved trip and plan it now (reuses the
    // plan-once-both-ends-are-in effect above).
    const savedTripAttemptedRef = useRef(false)
    useEffect(() => {
        if (!shared.savedTripId.found || savedTripAttemptedRef.current || trips.length === 0) return
        savedTripAttemptedRef.current = true
        const trip = trips.find((t) => t.id === shared.savedTripId.value)
        window.history.replaceState(null, "", "/plan")
        if (!trip) return
        handleLoadTrip(trip)
        setPlanFromHere(true)
    }, [shared.savedTripId.found, shared.savedTripId.value, trips, handleLoadTrip])

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

    const fetchPlans = useCallback(async (
        from: { lat: number; lon: number },
        to: { lat: number; lon: number },
        date: Date,
        tType: "now" | "leaveat" | "arriveat",
    ): Promise<{ plans: JourneyType[] | null; error: string | null }> => {
        try {
            let url = `/services/plan?startLat=${from.lat}&startLon=${from.lon}&endLat=${to.lat}&endLon=${to.lon}&date=${date.toISOString()}&timeType=${tType}&maxWalkKm=${maxWalkKm}&walkSpeed=${walkSpeed}&maxTransfers=${maxTransfers}&minResults=${minResults}`
            if (onlyRoutes.length > 0) {
                url += `&onlyRoutes=${encodeURIComponent(onlyRoutes.map((r) => r.route_id).join(","))}`
            }
            if (modes.length > 0) url += `&modes=${modes.join(",")}`
            const response = await ApiFetch<JourneyType[]>(url)
            if (response.ok) return { plans: pruneDominatedPlans(response.data), error: null }
            return { plans: null, error: response.error || "Couldn't plan that journey." }
        } catch (error) {
            console.error("Error planning journey:", error)
            return { plans: null, error: "Something went wrong reaching the planner. Check your connection and try again." }
        }
    }, [maxWalkKm, walkSpeed, maxTransfers, minResults, onlyRoutes, modes])

    const planJourney = async () => {
        if (!startLocation || !endLocation) return

        const searchDate = timeType === "now" ? new Date() : selectedDate
        setSelectedDate(searchDate)

        setIsSearching(true)
        setApiResponse([])
        setPlanError(null)
        setReplanSnapshot(null)
        const { plans, error } = await fetchPlans(startLocation, endLocation, searchDate, timeType)
        if (plans) {
            setApiResponse(plans)
            setLastSearch({ from: startLocation, to: endLocation, date: searchDate, timeType, at: new Date() })
        } else setPlanError(error)
        setIsSearching(false)
    }

    // "Later departures" - the next page after the latest departure (or,
    // arriving by, before the earliest arrival), appended so the rider can
    // compare. The same journey can come back from two searches with a
    // different id, so it's de-duplicated by times + trips.
    const journeyKey = (j: JourneyType) =>
        `${new Date(j.DepartureTime).getTime()}|${new Date(j.ArrivalTime).getTime()}|${getTransitTripIds(j).join(",")}`
    const loadMore = async () => {
        if (!lastSearch || apiResponse.length === 0) return
        const arriveBy = lastSearch.timeType === "arriveat"
        const date = arriveBy
            ? new Date(Math.min(...apiResponse.map((j) => new Date(j.ArrivalTime).getTime())) - 60_000)
            : new Date(Math.max(...apiResponse.map((j) => new Date(j.DepartureTime).getTime())) + 60_000)
        setIsLoadingMore(true)
        const { plans } = await fetchPlans(lastSearch.from, lastSearch.to, date, arriveBy ? "arriveat" : "leaveat")
        setIsLoadingMore(false)
        if (!plans) {
            toast.error("Couldn't load more journeys")
            return
        }
        const seen = new Set(apiResponse.map(journeyKey))
        const fresh = plans.filter((j) => !seen.has(journeyKey(j)))
        if (fresh.length === 0) {
            toast.info(arriveBy ? "No earlier journeys found" : "No later journeys found")
            return
        }
        const merged = [...apiResponse, ...fresh]
        setApiResponse(arriveBy
            ? merged.sort((a, b) => new Date(b.ArrivalTime).getTime() - new Date(a.ArrivalTime).getTime())
            : merged.sort((a, b) => new Date(a.DepartureTime).getTime() - new Date(b.DepartureTime).getTime()))
    }

    // A "Leave now" search goes stale as its first option leaves: run it
    // again on coming back to the tab after a couple of minutes (unless a
    // journey is open - that would pull it out from under the rider).
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState !== "visible" || !lastSearch || lastSearch.timeType !== "now") return
            if (Date.now() - lastSearch.at.getTime() < 2 * 60_000 || isRouteMapOpen || isSearching) return
            if (isWide && selectedRoute) return
            planJourney()
        }
        document.addEventListener("visibilitychange", onVisible)
        return () => document.removeEventListener("visibilitychange", onVisible)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastSearch, isRouteMapOpen, isSearching, isWide, selectedRoute])

    // Wide screens: keep a journey selected for the detail column - the first
    // one when the results change and the selection isn't among them.
    useEffect(() => {
        if (!isWide || apiResponse.length === 0) return
        if (selectedRoute && apiResponse.some((j) => j.ID === selectedRoute.ID)) return
        setSelectedRoute(apiResponse[0])
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isWide, apiResponse])

    // Re-plan from a stop the rider is at / heading to, mid-journey, when the
    // live times have made the original route unworkable. Points the form at
    // that stop/time and reveals the fresh options in the results list.
    const replanFromHere = useCallback(async (origin: { lat: number; lon: number; label: string }, departAt: Date) => {
        if (!endLocation) return
        setReplanSnapshot({ route: selectedRoute, results: apiResponse, start: startLocation, timeType, date: selectedDate })
        setStartLocation({ lat: origin.lat, lon: origin.lon, label: origin.label })
        setTimeType("leaveat")
        setSelectedDate(departAt)
        setIsSearching(true)
        setApiResponse([])
        setPlanError(null)
        setSelectedRoute(undefined)
        setIsRouteMapOpen(false)
        const { plans, error } = await fetchPlans(origin, endLocation, departAt, "leaveat")
        if (plans) {
            setApiResponse(plans)
            setLastSearch({ from: { lat: origin.lat, lon: origin.lon, label: origin.label }, to: endLocation, date: departAt, timeType: "leaveat", at: new Date() })
        } else setPlanError(error)
        setIsSearching(false)
        setTimeout(() => document.getElementById("journey-results")?.scrollIntoView({ behavior: "smooth" }), 100)
    }, [endLocation, fetchPlans, selectedRoute, apiResponse, startLocation, timeType, selectedDate])

    // Bail out of a mid-journey re-plan: restore the route (and form) they were on.
    const restoreReplan = useCallback(() => {
        if (!replanSnapshot) return
        setSelectedRoute(replanSnapshot.route)
        setApiResponse(replanSnapshot.results)
        setStartLocation(replanSnapshot.start)
        setTimeType(replanSnapshot.timeType)
        setSelectedDate(replanSnapshot.date)
        setIsRouteMapOpen(!!replanSnapshot.route)
        setReplanSnapshot(null)
        setPlanError(null)
    }, [replanSnapshot])

    // Builds a link that reopens (and starts tracking) this exact journey, so
    // whoever it's shared with can follow the live vehicle too - `id` reopens
    // the exact cached plan (see planCache on the backend), which keeps
    // working up to 30 min after it arrives even once its departure time is
    // in the past. date/timeType/trips are kept as a fallback (re-plan and
    // match by transit-leg signature) for when that cache entry is gone, and
    // `track=1` starts live tracking immediately rather than requiring the
    // recipient to tap GO themselves.
    // Short same-origin path that opens this exact journey on its own page - the
    // plan is fetched by id from the durable plan store, so no start/end/date
    // blob is needed. Used for share links and notification deeplinks alike.
    const buildSharePath = useCallback((route: JourneyType) => {
        const slug = getRegionSlug(currentUrl)
        return `/journey?id=${encodeURIComponent(route.ID)}${slug ? `&region=${slug}` : ""}`
    }, [currentUrl])

    const buildShareUrl = useCallback((route: JourneyType) => {
        if (typeof window === "undefined") return ""
        return `${window.location.origin}${buildSharePath(route)}`
    }, [buildSharePath])

    return (
        <div className="min-h-screen bg-background">
            {/* The persistent site nav already shows "Planner" as the active
                tab and spans the full page width, so a second, narrower,
                title-duplicating header directly beneath it just looked like
                a layout glitch. Saved-trip actions now sit inline with the
                page content instead, in the same width column as everything
                else on the page. */}
            <div className={isWide ? "mx-auto flex max-w-6xl gap-8 px-4" : undefined}>
            <main className={isWide ? "w-[440px] shrink-0 space-y-5 py-6" : "mx-auto max-w-2xl px-4 py-6 space-y-5"}>
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
                    minResults={minResults}
                    onMinResultsChange={setMinResults}
                    onlyRoutes={onlyRoutes}
                    onOnlyRoutesChange={setOnlyRoutes}
                    modes={modes}
                    onModesChange={setModes}
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

                {replanSnapshot && (
                    <button
                        type="button"
                        onClick={restoreReplan}
                        className="mt-4 flex w-full items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                    >
                        <span className="inline-flex items-center gap-2 font-medium">
                            <Undo2 className="h-4 w-4" />
                            Keep the route I was on
                        </span>
                        {replanSnapshot.route && (
                            <span className="text-xs text-muted-foreground">
                                arrives {formatTime(replanSnapshot.route.ArrivalTime)}
                            </span>
                        )}
                    </button>
                )}

                {timeType === "arriveat" && apiResponse.length > 0 && (() => {
                    const latest = latestDeparture(apiResponse)
                    if (!latest || new Date(latest.DepartureTime).getTime() <= Date.now() + 60_000) return null
                    return (
                        <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-sm">
                            <span className="min-w-0">
                                <span className="text-muted-foreground">Latest you can leave: </span>
                                <span className="font-semibold">{formatTime(latest.DepartureTime)}</span>
                            </span>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                                onClick={() => openLeaveReminder(latest)}
                            >
                                <AlarmClock className="h-3.5 w-3.5" />
                                Remind me
                            </Button>
                        </div>
                    )
                })()}

                {planError && !isSearching && (
                    <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
                        {planError}
                    </p>
                )}

                <ResultsList
                    routes={apiResponse}
                    onSelect={(route) => {
                        setSelectedRoute(route)
                        if (!isWide) setIsRouteMapOpen(true)
                    }}
                    onRemindToLeave={openLeaveReminder}
                    plannedAt={lastSearch?.at}
                    canGoStale={lastSearch?.timeType === "now"}
                    onRefresh={planJourney}
                    onLoadMore={lastSearch ? loadMore : undefined}
                    loadMoreLabel={lastSearch?.timeType === "arriveat" ? "Earlier journeys" : "Later departures"}
                    isLoadingMore={isLoadingMore}
                    selectedId={isWide ? selectedRoute?.ID : undefined}
                />
            </main>

            {isWide && (
                <aside className="sticky top-16 max-h-[calc(100svh-5rem-var(--tabbar-h))] min-w-0 flex-1 self-start overflow-y-auto py-6">
                    {selectedRoute ? (
                        <JourneyErrorBoundary resetKey={selectedRoute.ID}>
                            <RouteDetailSheet
                                embedded
                                open
                                onOpenChange={() => { }}
                                route={selectedRoute}
                                startLocation={startLocation}
                                endLocation={endLocation}
                                buildShareUrl={buildShareUrl}
                                onShowAlternates={() => document.getElementById("journey-results")?.scrollIntoView({ behavior: "smooth" })}
                                onReplanFromHere={replanFromHere}
                                autoTrack={autoTrack}
                                onRemindToLeave={openLeaveReminder}
                            />
                        </JourneyErrorBoundary>
                    ) : (
                        <div className="flex h-[340px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground">
                            <RouteIcon className="h-6 w-6" />
                            Plan a journey to see it on the map here.
                        </div>
                    )}
                </aside>
            )}
            </div>

            {!isWide && <JourneyErrorBoundary resetKey={selectedRoute?.ID}>
                <RouteDetailSheet
                    open={isRouteMapOpen}
                    onOpenChange={setIsRouteMapOpen}
                    route={selectedRoute ?? null}
                    startLocation={startLocation}
                    endLocation={endLocation}
                    buildShareUrl={buildShareUrl}
                    onShowAlternates={() => setIsRouteMapOpen(false)}
                    onReplanFromHere={replanFromHere}
                    autoTrack={autoTrack}
                    onRemindToLeave={openLeaveReminder}
                />
            </JourneyErrorBoundary>}

            <LeaveReminderDialog
                open={leaveReminderOpen}
                onOpenChange={setLeaveReminderOpen}
                route={leaveReminderRoute}
                deeplink={leaveReminderRoute ? buildSharePath(leaveReminderRoute) : undefined}
                requestContext={{
                    startLocation,
                    endLocation,
                    maxWalkKm,
                    walkSpeed,
                    maxTransfers,
                    onlyRoutes,
                    modes,
                    timeType,
                    selectedDate,
                }}
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
