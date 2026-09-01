"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
    Drawer,
    DrawerContent,
    DrawerTitle,
} from "@/components/ui/drawer"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
    AlertTriangle,
    Accessibility,
    Bus,
    Clock,
    Footprints,
    Navigation,
    RefreshCw,
    Share2,
} from "lucide-react"
import { haversineDistance, useIsMobile } from "@/lib/utils"
import type { LatLng } from "@/components/map/map"
import { useRouteLine } from "@/components/services/tracker/use-service-tracker"
import { LiveMap } from "./live-map"
import { useJourneyVehicles } from "./use-journey-vehicles"
import { useJourneyStopTimes } from "./use-journey-stop-times"
import { useTrackedTripStops } from "./use-tracked-trip"
import { buildLiveJourney, connectionRisk, findStopSequence, getTransitTripIds, getWaitingTimeNs, formatDuration, formatTime, replanChoices, type ConnectionRisk, type ReplanChoice } from "./helpers"
import { RealtimeStatus, type JourneyType, type Leg, type Location } from "./types"

interface RouteDetailSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    route: JourneyType | null
    startLocation: Location | null
    endLocation: Location | null
    /** Builds a link that reopens this specific journey (best-effort - the underlying trips may no longer run if opened on a later day). */
    buildShareUrl: (route: JourneyType) => string
    /** Collapses the sheet so the results list underneath is reachable again. */
    onShowAlternates: () => void
    /** Re-run the planner from a stop the rider is at / heading to, mid-journey. Reveals the fresh options in the results list. */
    onReplanFromHere?: (origin: { lat: number; lon: number; label: string }, departAt: Date) => void
    /** Set once, right when a shared link auto-opens this exact route, to start tracking immediately instead of requiring a manual GO tap. Read once via a ref, not as a live dependency, so plan.tsx clearing it back to false afterward doesn't undo tracking once it's started. */
    autoTrack?: boolean
}

// How far past its delay-adjusted departure the earliest pending transit leg
// must be - while still showing no live vehicle - before tracking is allowed to
// skip ahead to a later leg that does have one.
const OVERDUE_SKIP_MS = 5 * 60 * 1000

// Hysteresis for "the rider is standing at the boarding stop, waiting" - enter
// within ENTER metres, only drop back out past EXIT metres so a jittery GPS fix
// at the boundary doesn't flip the camera between the vehicle and the rider.
const AT_STOP_ENTER_M = 40
const AT_STOP_EXIT_M = 120

// How close to a transit leg's departure counts as "boarding" rather than "waiting".
const BOARDING_WINDOW_MS = 90 * 1000

type JourneyPhase = "walking" | "waiting" | "boarding" | "onboard"
const PHASE_LABEL: Record<JourneyPhase, string> = {
    walking: "Walking",
    waiting: "Waiting",
    boarding: "Boarding",
    onboard: "On board",
}

function journeyStopCount(route: JourneyType): number {
    return route.Legs.reduce((sum, leg) => {
        if (leg.Mode !== 'transit' || !leg.FromStop || !leg.ToStop) return sum
        return sum + Math.max(1, Math.abs(leg.ToStop.stop_sequence - leg.FromStop.stop_sequence))
    }, 0)
}

function journeyHeadsign(route: JourneyType): string | null {
    const transitLegs = route.Legs.filter(l => l.Mode === 'transit')
    const lastLeg = transitLegs[transitLegs.length - 1]
    return lastLeg?.ToStop?.stop_headsign || null
}

/** Last transit leg's realtime delay (seconds, negative if early) - a plan-time snapshot, not itself live, but the best delay signal already on hand without a new fetch. */
function journeyDelaySeconds(route: JourneyType): number {
    const transitLegs = route.Legs.filter(l => l.Mode === 'transit')
    return transitLegs[transitLegs.length - 1]?.delay_seconds ?? 0
}

/** Ticks every `intervalMs` so callers can derive "time remaining" style displays that count down live. */
function useNow(intervalMs: number): Date {
    const [now, setNow] = useState(() => new Date())
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), intervalMs)
        return () => clearInterval(id)
    }, [intervalMs])
    return now
}

export function RouteDetailSheet({
    open,
    onOpenChange,
    route,
    startLocation,
    endLocation,
    buildShareUrl,
    onShowAlternates,
    onReplanFromHere,
    autoTrack,
}: RouteDetailSheetProps) {
    // immediate: true - resolve mobile vs desktop synchronously on the first
    // client render. This component renders no DOM until `open` (always false at
    // hydration), so there's no mismatch; and it prevents a one-frame render of
    // the modal Radix <Dialog> branch that, when swapped out for the <Drawer> as
    // the mount effect corrects isMobile, would strand body{pointer-events:none}
    // and kill the whole page.
    const isMobile = useIsMobile({ immediate: true })
    const [activeSnapPoint, setActiveSnapPoint] = useState<number | string | null>(0.4)
    const [journeyStarted, setJourneyStarted] = useState(false)
    // Highest journey-leg index the rider has been carried past - i.e. a tracked
    // vehicle was seen beyond that leg's alight stop, so the rider has gotten
    // off. A latch (reset per journey): a later dropped poll shouldn't put them
    // back "on board" and resume chasing that vehicle.
    const [alightedThroughLeg, setAlightedThroughLeg] = useState(-1)
    // The rider's live position, and whether they're currently standing at the
    // boarding stop of the leg being tracked (with hysteresis).
    const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null)
    const [atBoardStop, setAtBoardStop] = useState(false)
    const now = useNow(20000)

    // Captured via ref (not a dependency) so autoTrack flipping back to false
    // right after being consumed doesn't re-run this effect and undo tracking.
    const autoTrackRef = useRef(autoTrack)
    autoTrackRef.current = autoTrack

    // Reset per-journey UI state whenever a different (or no) route is selected.
    useEffect(() => {
        setJourneyStarted(!!autoTrackRef.current)
        setActiveSnapPoint(0.4)
        setAlightedThroughLeg(-1)
        setAtBoardStop(false)
    }, [route?.ID])

    // The drawer runs non-modal (modal={false}, so the map stays interactive
    // behind it) which means vaul doesn't lock background scroll the way it
    // would in modal mode. Without this, a touch-drag over the itinerary can
    // fall through and scroll the results list behind instead of the drawer's
    // own content.
    useEffect(() => {
        if (!isMobile || !open || !route) return
        document.body.style.overflow = "hidden"
        // Restore to "" (not the captured previous value) - if this effect ever
        // re-runs with "hidden" already set, capturing it would strand the lock.
        return () => {
            document.body.style.overflow = ""
        }
    }, [isMobile, open, route])

    // vaul renders a *modal* Radix Dialog underneath even with modal={false}, so
    // its dismissable-layer sets `pointer-events: none` on <body>. vaul's own
    // workaround that re-enables it only fires on internal state changes - never
    // for our prop-controlled, dismissible={false} drawer - and opening a new
    // sheet while the previous one's exit animation is still running makes
    // Radix's shared layer miss its restore entirely, stranding the lock and
    // killing the whole page (drawer included). On mobile the map behind is
    // meant to stay interactive anyway, so just keep <body> unlocked the whole
    // time the sheet is open, re-forcing it past the animation race.
    useEffect(() => {
        if (!isMobile || !open) return
        const unlock = () => { document.body.style.pointerEvents = "" }
        unlock()
        const raf = requestAnimationFrame(unlock)
        const timer = setTimeout(unlock, 400)
        return () => {
            cancelAnimationFrame(raf)
            clearTimeout(timer)
        }
    }, [isMobile, open])

    // Belt-and-braces: clear both locks whenever the sheet is closed (covers the
    // desktop modal Dialog too) and on unmount, in case a branch swap or a
    // toggle-during-animation left one stranded.
    useEffect(() => {
        if (open) return
        document.body.style.pointerEvents = ""
        document.body.style.overflow = ""
    }, [open])
    useEffect(() => () => {
        document.body.style.pointerEvents = ""
        document.body.style.overflow = ""
    }, [])

    const tripIds = useMemo(() => (route ? getTransitTripIds(route) : []), [route])
    const { vehiclesByTripId } = useJourneyVehicles(tripIds, open && journeyStarted)
    const stopTimesByTripId = useJourneyStopTimes(tripIds, open && journeyStarted)

    // The journey with its leg times shifted to live realtime predictions (while
    // tracking) - used for everything the rider reads: the itinerary rows, the
    // waits, the summary header, and which leg they're on.
    const displayRoute = useMemo(
        () => (route ? buildLiveJourney(route, stopTimesByTripId) : route),
        [route, stopTimesByTripId]
    )

    // Which leg the rider is on right now: the first leg whose (live) arrival is
    // still in the future. Before departure that's leg 0; once every leg's
    // arrival has passed, the last leg.
    const currentLegIndex = useMemo(() => {
        if (!displayRoute) return -1
        const nowMs = now.getTime()
        const idx = displayRoute.Legs.findIndex(
            (l) => nowMs < new Date(l.ArrivalTime).getTime()
        )
        return idx === -1 ? displayRoute.Legs.length - 1 : idx
    }, [displayRoute, now])
    const currentLeg = currentLegIndex >= 0 ? displayRoute?.Legs[currentLegIndex] : undefined

    // The transit leg to track: the current leg if it's transit, otherwise the
    // next transit leg coming up - always in journey order, so a later bus that
    // happens to have realtime can't be jumped ahead of an earlier one that
    // doesn't. Exception: if the earliest pending transit leg is well past its
    // adjusted departure and still shows no live vehicle, allow skipping to a
    // later leg that does (bad schedule data / a cancelled-but-not-flagged run).
    const activeTransitLeg = useMemo(() => {
        if (!route || currentLegIndex < 0) return undefined
        // Never re-select a leg the rider has already been carried past, even if
        // the schedule clock still thinks they're on it (vehicle ran early).
        const floor = Math.max(currentLegIndex, alightedThroughLeg + 1)
        const upcoming = route.Legs
            .map((l, i) => ({ l, i }))
            .filter(({ l, i }) => i >= floor && l.Mode === "transit")
        if (upcoming.length === 0) return undefined
        const first = upcoming[0].l
        // DepartureTime is already realtime-adjusted by the backend.
        const firstOverdueMs = now.getTime() - new Date(first.DepartureTime).getTime()
        if (!vehiclesByTripId[first.TripID] && firstOverdueMs > OVERDUE_SKIP_MS) {
            const live = upcoming.find(({ l }) => vehiclesByTripId[l.TripID])
            if (live) return live.l
        }
        return first
    }, [route, currentLegIndex, alightedThroughLeg, vehiclesByTripId, now])

    const trackedTripId =
        journeyStarted && activeTransitLeg && vehiclesByTripId[activeTransitLeg.TripID]
            ? activeTransitLeg.TripID
            : undefined
    const trackedVehicle = trackedTripId ? vehiclesByTripId[trackedTripId] : undefined
    const trackedStops = useTrackedTripStops(trackedTripId ?? null)
    const trackedRouteLine = useRouteLine(trackedTripId ?? "", trackedVehicle?.route.id)

    // The leg whose board/alight stops the map should show: the tracked
    // vehicle's leg, or - before any vehicle is live - the current/next transit
    // leg.
    const trackedLeg =
        (trackedTripId && route?.Legs.find((l) => l.TripID === trackedTripId)) ||
        (journeyStarted ? activeTransitLeg : undefined)
    const trackedBoardStop = trackedLeg?.FromStop ?? undefined
    const trackedAlightStop = trackedLeg?.ToStop ?? undefined
    const trackedLegIndex = trackedLeg && route ? route.Legs.indexOf(trackedLeg) : -1
    const trackedCurrentSeq = trackedVehicle?.trip?.current_stop?.sequence

    // Has the tracked vehicle already left the rider's boarding stop? If so the
    // rider is on board (or has missed it) - either way the camera should just
    // follow the vehicle, not frame it against a stop that's now behind them.
    const trackedBoardSeq = findStopSequence(trackedStops, trackedBoardStop)
    const boarded = !!trackedVehicle && trackedCurrentSeq !== undefined && trackedBoardSeq !== undefined
        && trackedCurrentSeq > trackedBoardSeq
    // Physically standing at the boarding stop, vehicle not yet departed it.
    const waitingAtStop = atBoardStop && !boarded

    // Camera: follow the rider while they're still walking to a stop (and not
    // already waiting at it / on board); otherwise follow the tracked vehicle.
    const riderWalking = journeyStarted && currentLeg?.Mode === "walk" && !waitingAtStop && !boarded
    const followMarkerId = trackedVehicle && !riderWalking ? `vehicle-${trackedVehicle.trip_id}` : undefined

    // While waiting at the stop for the tracked vehicle, frame the vehicle and
    // the stop together (watch it approach) rather than panning to the vehicle
    // alone. Once boarded this drops and it reverts to a plain follow.
    const followFitWith: [number, number] | undefined =
        followMarkerId && waitingAtStop && trackedBoardStop
            ? [trackedBoardStop.stop_lat, trackedBoardStop.stop_lon]
            : undefined

    // Track whether the rider is standing at the boarding stop (hysteresis so a
    // jittery fix at the edge doesn't oscillate the camera). Cleared when there's
    // no boarding stop to be at (e.g. the leg's been alighted).
    const boardLat = trackedBoardStop?.stop_lat
    const boardLon = trackedBoardStop?.stop_lon
    useEffect(() => {
        if (!journeyStarted || boardLat === undefined || boardLon === undefined || !userLoc) {
            setAtBoardStop(false)
            return
        }
        const d = haversineDistance(userLoc.lat, userLoc.lon, boardLat, boardLon)
        setAtBoardStop((was) => (was ? d < AT_STOP_EXIT_M : d <= AT_STOP_ENTER_M))
    }, [journeyStarted, boardLat, boardLon, userLoc])

    // Release the tracked leg the moment the vehicle carries the rider past
    // their alight stop - from then on the map follows the next leg's vehicle if
    // it's live, otherwise the rider (see followUser below), instead of chasing
    // the vehicle they just got off as it continues its trip.
    useEffect(() => {
        if (!journeyStarted || trackedLegIndex < 0 || trackedCurrentSeq === undefined) return
        const alightSeq = findStopSequence(trackedStops, trackedAlightStop)
        if (alightSeq === undefined) return
        if (trackedCurrentSeq > alightSeq) {
            setAlightedThroughLeg((prev) => Math.max(prev, trackedLegIndex))
        }
    }, [journeyStarted, trackedLegIndex, trackedCurrentSeq, trackedStops, trackedAlightStop])

    const defaultZoom = useMemo<[LatLng, LatLng]>(() => [
        [route?.StartLat ?? 0, route?.StartLon ?? 0],
        [route?.EndLat ?? 0, route?.EndLon ?? 0],
    ], [route?.StartLat, route?.StartLon, route?.EndLat, route?.EndLon])

    if (!route) return null
    const shownRoute = displayRoute ?? route

    // Vehicles to show on the map: drop the ones for legs the rider has already
    // ridden and alighted - once you're off a train you don't want to keep
    // watching it drive away while you wait for the next.
    const alightedTripIds = new Set(
        route.Legs.filter((l, i) => l.Mode === "transit" && !!l.TripID && i <= alightedThroughLeg).map((l) => l.TripID)
    )
    const visibleVehicles = alightedTripIds.size === 0
        ? vehiclesByTripId
        : Object.fromEntries(Object.entries(vehiclesByTripId).filter(([id]) => !alightedTripIds.has(id)))

    // The leg index to mark as "current" in the itinerary/header while tracking.
    // Once the final leg's arrival has passed the whole journey reads as done.
    const lastLeg = shownRoute.Legs[shownRoute.Legs.length - 1]
    const journeyArrived =
        journeyStarted && currentLegIndex === shownRoute.Legs.length - 1 &&
        !!lastLeg && now.getTime() >= new Date(lastLeg.ArrivalTime).getTime()
    const progressLegIndex = !journeyStarted ? -1 : journeyArrived ? shownRoute.Legs.length : currentLegIndex

    // What the rider is doing on the current leg right now.
    const activeLeg = progressLegIndex >= 0 ? shownRoute.Legs[progressLegIndex] : undefined
    const currentPhase = ((): JourneyPhase | undefined => {
        if (!journeyStarted || !activeLeg) return undefined
        if (activeLeg.Mode === "walk") return waitingAtStop ? "waiting" : "walking"
        if (boarded) return "onboard"
        // Transit leg, not yet on board: "boarding" once the vehicle is at/one
        // stop from the rider's boarding stop, or departure is imminent;
        // "waiting" during the gap before that.
        const untilDepartMs = new Date(activeLeg.DepartureTime).getTime() - now.getTime()
        const vehicleAtBoard =
            trackedBoardSeq !== undefined && trackedCurrentSeq !== undefined &&
            trackedCurrentSeq >= trackedBoardSeq - 1 && trackedCurrentSeq <= trackedBoardSeq &&
            (trackedVehicle?.state === "AtStop" || trackedVehicle?.state === "Approaching")
        return untilDepartMs <= BOARDING_WINDOW_MS || vehicleAtBoard ? "boarding" : "waiting"
    })()

    // How good the data behind the times is right now: a live vehicle position,
    // just trip-update predictions, or bare schedule.
    const activeTransitTripId = activeTransitLeg?.TripID
    const trackingLevel: "live" | "predicted" | "scheduled" =
        trackedVehicle ? "live"
            : activeTransitTripId && (stopTimesByTripId[activeTransitTripId]?.length ?? 0) > 0 ? "predicted"
                : "scheduled"

    // "Re-plan from here": the choices the rider can pick from (usually "get off
    // at the next stop" vs "stay on / take this one and re-route after"), and
    // whether a downstream connection is now unmakeable (makes the button urgent).
    const vehicleNext = trackedVehicle?.trip?.next_stop
    const vehicleNextEtaMs =
        vehicleNext && activeTransitTripId
            ? stopTimesByTripId[activeTransitTripId]?.find(
                (s) => s.child_stop_id === vehicleNext.child_stop_id || s.parent_stop_id === vehicleNext.parent_stop_id
            )?.arrival_time
            : undefined
    const vehicleNextEta = vehicleNextEtaMs ? new Date(vehicleNextEtaMs) : undefined

    const replanOptions = journeyStarted
        ? replanChoices(
            shownRoute, progressLegIndex, currentPhase,
            vehicleNext ? { lat: vehicleNext.lat, lon: vehicleNext.lon, name: vehicleNext.name } : undefined,
            vehicleNextEta,
            userLoc,
        )
        : []
    const replanUrgent = replanOptions.length > 0 && shownRoute.Legs.some(
        (_, i) => i > progressLegIndex && connectionRisk(shownRoute.Legs, i)?.level === "missed"
    )
    const handleReplan = onReplanFromHere
        ? (c: ReplanChoice) => onReplanFromHere(c.origin, c.departAt)
        : undefined

    const handleShare = async () => {
        const title = `${startLocation?.label ?? "Start"} → ${endLocation?.label ?? "Destination"}`
        const shareUrl = buildShareUrl(route)
        if (navigator.share) {
            try {
                await navigator.share({ title, url: shareUrl })
            } catch {
                // user cancelled the share sheet - not an error
            }
            return
        }
        try {
            await navigator.clipboard.writeText(shareUrl)
            toast.success("Link copied to clipboard")
        } catch {
            toast.error("Couldn't copy link")
        }
    }

    const map = (
        <LiveMap
            mapId="journey-planner-route-map"
            height="100%"
            defaultZoom={defaultZoom}
            startLocation={startLocation}
            endLocation={endLocation}
            selectedRoute={route}
            vehiclesByTripId={visibleVehicles}
            followMarkerId={followMarkerId}
            followFitWith={followFitWith}
            trackedVehicle={trackedVehicle}
            trackedStops={trackedStops}
            trackedRouteLine={trackedRouteLine}
            trackedBoardStop={trackedBoardStop}
            trackedAlightStop={trackedAlightStop}
            followUser={journeyStarted && !followMarkerId}
            onUserLocation={(lat, lon) => setUserLoc({ lat, lon })}
            showOverlayButtons
            onToggleAlternates={onShowAlternates}
        />
    )

    const itinerary = (
        <RouteItinerary
            route={shownRoute}
            currentLegIndex={progressLegIndex}
            currentPhase={currentPhase}
        />
    )

    const summary = (
        <JourneySummary
            route={shownRoute}
            onShare={handleShare}
            journeyStarted={journeyStarted}
            onGo={() => setJourneyStarted(true)}
            currentLegIndex={progressLegIndex}
            currentPhase={currentPhase}
            trackingLevel={trackingLevel}
            replanOptions={replanOptions}
            onReplan={handleReplan}
            replanUrgent={replanUrgent}
        />
    )

    if (!isMobile) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0">
                    <DialogTitle className="sr-only">Route details</DialogTitle>
                    <div className="flex flex-1 min-h-0 gap-0">
                        <div className="w-1/2 relative">{map}</div>
                        <div className="w-1/2 overflow-y-auto p-4 space-y-4">
                            {summary}
                            {itinerary}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        )
    }

    return (
        <>
            {isMobile && open && (
                <div className="fixed inset-0 z-40">
                    {map}
                </div>
            )}
            <Drawer
                open={open}
                onOpenChange={onOpenChange}
                modal={false}
                // Non-modal already means the map behind stays interactive -
                // vaul's background-scale wrapper is meant for the modal
                // case and, combined with modal={false}, was fighting the
                // drag gesture (choppy swipes, and eating pointer events on
                // the map/buttons behind it even at rest).
                shouldScaleBackground={false}
                // Without this, dragging down past the lowest snap point
                // (0.4 - the "peek" height showing the map) is read by vaul
                // as a dismiss gesture and closes the whole sheet instead of
                // just resting at the peek height. There's no swipe-to-
                // dismiss affordance shown to the user, so closing should
                // only happen via onShowAlternates/onOpenChange, not a drag.
                dismissible={false}
                // The top snap point must be 1, not 0.85: at any snap point
                // below 1 the sheet still carries a positive translateY, and
                // vaul's shouldDrag() treats "sheet is translated down at all"
                // as "consume this gesture as a drag" - so a touch-drag over
                // the itinerary always moved the sheet instead of scrolling its
                // content, at every snap point. With 1 as the top snap the
                // sheet sits at translateY 0 there and vertical drags fall
                // through to the scroll container. h-[85vh] still leaves 15vh
                // of map visible above it.
                snapPoints={[0.4, 1]}
                activeSnapPoint={activeSnapPoint}
                setActiveSnapPoint={setActiveSnapPoint}
            >
                {/* h-[85vh] (a fixed height, not max-h): vaul computes snap-point
                    offsets as a fraction of the viewport, so at snap 0.4 it
                    translates the sheet down by 60vh. With h-auto content shorter
                    than the viewport that pushes the whole sheet off-screen; a
                    fixed 85vh sheet leaves a ~25vh "peek" visible at snap 0.4. */}
                <DrawerContent overlayClassName="hidden" className="z-50 h-[85vh]">
                    <DrawerTitle className="sr-only">Route details</DrawerTitle>
                    {/* flex-1 + min-h-0 (not just overflow-y-auto) - gives the
                        scroll container a bounded height to overflow against. */}
                    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-4">
                        {summary}
                        {itinerary}
                    </div>
                </DrawerContent>
            </Drawer>
        </>
    )
}

function JourneySummary({
    route,
    onShare,
    journeyStarted,
    onGo,
    currentLegIndex,
    currentPhase,
    trackingLevel,
    replanOptions,
    onReplan,
    replanUrgent,
}: {
    route: JourneyType
    onShare: () => void
    journeyStarted: boolean
    onGo: () => void
    currentLegIndex: number
    currentPhase?: JourneyPhase
    trackingLevel: "live" | "predicted" | "scheduled"
    replanOptions: ReplanChoice[]
    onReplan?: (choice: ReplanChoice) => void
    replanUrgent?: boolean
}) {
    const headsign = journeyHeadsign(route)
    const stopCount = journeyStopCount(route)

    // The route shown in the header badge: the leg the rider is on now if it's
    // transit, else the next transit leg they'll board, else the first.
    const currentLeg = currentLegIndex >= 0 ? route.Legs[currentLegIndex] : undefined
    const badgeLeg =
        (currentLeg?.Mode === "transit" ? currentLeg : undefined) ??
        (currentLegIndex >= 0 ? route.Legs.slice(currentLegIndex).find((l) => l.Mode === "transit") : undefined) ??
        route.Legs.find((l) => l.Mode === "transit")

    // The next transit leg (for a "waiting for the X" status during a walk/gap).
    const nextTransit = currentLegIndex >= 0
        ? route.Legs.slice(currentLegIndex).find((l) => l.Mode === "transit")
        : undefined

    // A one-line "where are you in the journey" status, shown once tracking.
    let progress: string | null = null
    if (journeyStarted && currentLeg && currentPhase) {
        const routeName = (l?: Leg) => l?.Route?.route_short_name || l?.RouteID || "service"
        const isLastLeg = currentLegIndex === route.Legs.length - 1
        switch (currentPhase) {
            case "walking":
                progress = currentLeg.ToStop
                    ? `Walking to ${currentLeg.ToStop.stop_name}`
                    : isLastLeg ? "Almost there" : "Walking"
                break
            case "waiting":
                progress = currentLeg.Mode === "transit"
                    ? `Waiting for the ${routeName(currentLeg)}`
                    : `Waiting for the ${routeName(nextTransit)}`
                break
            case "boarding":
                progress = `Boarding the ${routeName(currentLeg.Mode === "transit" ? currentLeg : nextTransit)}`
                break
            case "onboard":
                progress = `On the ${routeName(currentLeg)}${currentLeg.ToStop?.stop_name ? ` → ${currentLeg.ToStop.stop_name}` : ""}`
                break
        }
    }

    // Delay-adjusted arrival, and a live "time remaining" countdown against it -
    // ticks down as real time passes, and runs longer than the planned duration
    // whenever the last transit leg is running late.
    const now = useNow(30000)
    const delaySeconds = journeyDelaySeconds(route)
    // route.ArrivalTime is already realtime-adjusted by the backend; delaySeconds
    // is kept only for the "(delayed)" hint below.
    const adjustedArrival = new Date(route.ArrivalTime)
    const remainingMs = adjustedArrival.getTime() - now.getTime()
    const remainingLabel = remainingMs <= 30000 ? "Arrived" : formatDuration(remainingMs * 1_000_000)

    return (
        <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    {badgeLeg?.Route && (
                        <span
                            className="shrink-0 px-2 py-1 rounded text-sm font-semibold"
                            style={{
                                background: "#" + (badgeLeg.Route.route_color || "424242"),
                                color: badgeLeg.Route.route_text_color ? `#${badgeLeg.Route.route_text_color}` : "#ffffff",
                            }}
                        >
                            {badgeLeg.Route.route_short_name || badgeLeg.RouteID}
                        </span>
                    )}
                    <div className="min-w-0">
                        <p className="text-base font-semibold truncate">{progress ?? headsign ?? "Your journey"}</p>
                        {journeyStarted && trackingLevel !== "live" ? (
                            <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                {trackingLevel === "predicted"
                                    ? "No live vehicle - times are predicted"
                                    : "No realtime - times are scheduled"}
                            </p>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                {stopCount > 0 ? `${stopCount} stop${stopCount !== 1 ? 's' : ''}` : `${route.Transfers} transfer${route.Transfers !== 1 ? 's' : ''}`}
                            </p>
                        )}
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-lg font-bold leading-none">{remainingLabel}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                        {formatTime(route.DepartureTime)} - {formatTime(adjustedArrival)}
                        {delaySeconds > 30 && <span className="text-amber-500"> (delayed)</span>}
                    </p>
                </div>
            </div>

            <button
                type="button"
                onClick={onShare}
                className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
            >
                <span>Share this journey</span>
                <span className="inline-flex items-center gap-1.5 text-primary font-medium">
                    <Share2 className="h-3.5 w-3.5" />
                    Share
                </span>
            </button>

            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
                <div className="flex items-center gap-1.5">
                    {route.Legs.map((leg, i) => (
                        <span key={i}>
                            {leg.Mode === 'walk'
                                ? <Footprints className="h-4 w-4 text-muted-foreground" />
                                : <Bus className="h-4 w-4 text-muted-foreground" />}
                        </span>
                    ))}
                    <span className="text-sm text-muted-foreground ml-1">{formatDuration(route.TotalDuration)} total</span>
                </div>
                <Button
                    size="sm"
                    className="rounded-full gap-1.5 px-4"
                    variant={journeyStarted ? "secondary" : "default"}
                    onClick={onGo}
                >
                    <Navigation className="h-3.5 w-3.5" />
                    {journeyStarted ? "Tracking" : "GO"}
                </Button>
            </div>

            {journeyStarted && onReplan && replanOptions.length > 0 && (() => {
                const label = replanUrgent ? "You'll miss a connection - find another route" : "Find a better route from here"
                if (replanOptions.length === 1) {
                    return (
                        <Button variant={replanUrgent ? "destructive" : "outline"} className="w-full gap-1.5" onClick={() => onReplan(replanOptions[0])}>
                            <RefreshCw className="h-3.5 w-3.5" />
                            {label}
                        </Button>
                    )
                }
                return (
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant={replanUrgent ? "destructive" : "outline"} className="w-full gap-1.5">
                                <RefreshCw className="h-3.5 w-3.5" />
                                {label}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="center" className="w-[var(--radix-popover-trigger-width)] p-1">
                            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Re-plan from…</p>
                            {replanOptions.map((c) => (
                                <button
                                    key={c.key}
                                    type="button"
                                    onClick={() => onReplan(c)}
                                    className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left text-sm hover:bg-accent transition-colors"
                                >
                                    <span className="font-medium">{c.label}</span>
                                    <span className="text-xs text-muted-foreground">{c.detail}</span>
                                </button>
                            ))}
                        </PopoverContent>
                    </Popover>
                )
            })()}
        </div>
    )
}

function RouteItinerary({
    route,
    currentLegIndex,
    currentPhase,
}: {
    route: JourneyType
    /** -1 when not tracking. */
    currentLegIndex: number
    currentPhase?: JourneyPhase
}) {
    return (
        <div className="space-y-1">
            {route.Legs.map((leg, legIndex) => {
                const status: LegStatus =
                    currentLegIndex < 0 ? "upcoming"
                        : legIndex < currentLegIndex ? "done"
                            : legIndex === currentLegIndex ? "current"
                                : "upcoming"
                const currentLabel = status === "current" && currentPhase ? PHASE_LABEL[currentPhase] : undefined
                // Don't warn about a connection the rider has already made.
                const risk = status === "done" ? null : connectionRisk(route.Legs, legIndex)
                return (
                    <LegRow
                        key={legIndex}
                        leg={leg}
                        isLast={legIndex === route.Legs.length - 1}
                        nextLeg={route.Legs[legIndex + 1]}
                        status={status}
                        currentLabel={currentLabel}
                        connectionRisk={risk}
                    />
                )
            })}
        </div>
    )
}

type LegStatus = "done" | "current" | "upcoming"

function LegRow({ leg, isLast, nextLeg, status = "upcoming", currentLabel, connectionRisk }: { leg: Leg; isLast: boolean; nextLeg?: Leg; status?: LegStatus; currentLabel?: string; connectionRisk?: ConnectionRisk | null }) {
    const isWalk = leg.Mode === 'walk'
    const isDelayed = leg.realtime_status === RealtimeStatus.Delayed
    const isEarly = leg.realtime_status === RealtimeStatus.Early
    const routeColor = leg.Route?.route_color ? `#${leg.Route.route_color}` : "#424242"
    const waitNs = nextLeg ? getWaitingTimeNs(leg, nextLeg) : null

    // Backend sanitises this now, but a plan cached before a realtime feed
    // corrected itself can still carry an adjusted arrival that lands before its
    // departure. Fall back to the schedule and drop the realtime badge rather
    // than render "arrives before it departs" / a negative duration.
    const inverted = !isWalk && new Date(leg.ArrivalTime).getTime() <= new Date(leg.DepartureTime).getTime()
    const displayDeparture = inverted && leg.scheduled_departure_time ? leg.scheduled_departure_time : leg.DepartureTime
    const displayArrival = inverted && leg.scheduled_arrival_time ? leg.scheduled_arrival_time : leg.ArrivalTime
    const displayDurationNs = inverted
        ? Math.max(0, new Date(displayArrival).getTime() - new Date(displayDeparture).getTime()) * 1_000_000
        : leg.Duration
    const showEarlyLateBadge = (isDelayed || isEarly) && !inverted
    const showOnTimeBadge = leg.realtime_status === RealtimeStatus.OnTime && !inverted

    return (
        <div
            className={
                status === "current"
                    ? "relative -mx-2 rounded-lg bg-primary/[0.06] px-2 py-1 ring-1 ring-primary/30"
                    : status === "done"
                        ? "relative opacity-45"
                        : "relative"
            }
        >
            {currentLabel && (
                <span className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground animate-pulse" />
                    {currentLabel}
                </span>
            )}
            {!isWalk && leg.trip_usable === false && (
                <div className="mb-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>This service is not running. Check alternative routes.</span>
                </div>
            )}
            {connectionRisk && (
                <div className={`mb-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${connectionRisk.level === "missed"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                        {connectionRisk.level === "missed"
                            ? `You'll likely miss this — it leaves ${Math.abs(connectionRisk.transferMin)} min before you get here`
                            : `Tight transfer — about ${Math.max(0, connectionRisk.transferMin)} min to change`}
                    </span>
                </div>
            )}

            <div className="flex items-center gap-2 py-1">
                {isWalk ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium text-pink-500">
                        <Footprints className="h-3 w-3" />
                        Walk · {Math.max(0, Math.round(leg.Duration / 60000000000))} min
                        {leg.DistanceKm > 0 && <span className="text-muted-foreground/70">· {leg.DistanceKm.toFixed(2)} km</span>}
                    </span>
                ) : (
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <span
                            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold"
                            style={{
                                backgroundColor: routeColor,
                                color: leg.Route?.route_text_color ? `#${leg.Route.route_text_color}` : "#ffffff",
                                filter: "brightness(0.9) contrast(1.1)",
                                opacity: leg.trip_usable === false ? 0.5 : 1,
                            }}
                        >
                            {leg.Route?.vehicle_type && <span className="opacity-80">{leg.Route.vehicle_type}</span>}
                            {leg.Route?.route_short_name || leg.RouteID}
                        </span>
                        {showEarlyLateBadge && (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${isDelayed ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                                <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${isDelayed ? 'bg-amber-500' : 'bg-green-500'}`} />
                                {isDelayed ? 'Late' : 'Early'}
                            </span>
                        )}
                        {showOnTimeBadge && (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                                On time
                            </span>
                        )}
                        {leg.realtime_status === RealtimeStatus.Scheduled && (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                                Scheduled
                            </span>
                        )}
                        <span className="text-xs text-muted-foreground">· {formatDuration(displayDurationNs)}</span>
                    </div>
                )}
            </div>

            <div className="ml-2 space-y-0 border-l-2 border-border pl-4">
                <div className="relative py-2">
                    <span className="absolute -left-[21px] top-3 h-3 w-3 rounded-full border-2 border-background bg-green-500 ring-1 ring-green-500" />
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-medium text-sm">{formatTime(displayDeparture)}</span>
                        <span className="text-sm text-muted-foreground">{leg.FromStop?.stop_name || 'Start'}</span>
                        <div className="flex items-center gap-1">
                            {leg.FromStop?.platform_number && (
                                <Badge variant="outline" className="text-xs py-0 h-5">Plat. {leg.FromStop.platform_number}</Badge>
                            )}
                            {leg.FromStop?.stop_headsign && (
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
                        <span className="font-medium text-sm">{formatTime(displayArrival)}</span>
                        <span className="text-sm text-muted-foreground">{leg.ToStop?.stop_name || 'Destination'}</span>
                        <div className="flex items-center gap-1">
                            {leg.ToStop?.platform_number && (
                                <Badge variant="outline" className="text-xs py-0 h-5">Plat. {leg.ToStop.platform_number}</Badge>
                            )}
                            {leg.ToStop?.wheelchair_boarding === 1 && (
                                <Accessibility className="h-3 w-3 text-muted-foreground" />
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {!isLast && waitNs && waitNs >= 60000000000 && (
                <div className="ml-2 flex items-center gap-2 py-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{formatDuration(waitNs)} wait</span>
                </div>
            )}
        </div>
    )
}
