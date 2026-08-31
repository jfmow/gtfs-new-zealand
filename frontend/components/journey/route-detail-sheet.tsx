"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
    Drawer,
    DrawerContent,
    DrawerTitle,
} from "@/components/ui/drawer"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
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
    Share2,
} from "lucide-react"
import { useIsMobile } from "@/lib/utils"
import type { LatLng } from "@/components/map/map"
import { useRouteLine } from "@/components/services/tracker/use-service-tracker"
import { LiveMap } from "./live-map"
import { useJourneyVehicles } from "./use-journey-vehicles"
import { useTrackedTripStops } from "./use-tracked-trip"
import { getTransitTripIds, getWaitingTimeNs, formatDuration, formatTime } from "./helpers"
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
    /** Set once, right when a shared link auto-opens this exact route, to start tracking immediately instead of requiring a manual GO tap. Read once via a ref, not as a live dependency, so plan.tsx clearing it back to false afterward doesn't undo tracking once it's started. */
    autoTrack?: boolean
}

// How far past its delay-adjusted departure the earliest pending transit leg
// must be - while still showing no live vehicle - before tracking is allowed to
// skip ahead to a later leg that does have one.
const OVERDUE_SKIP_MS = 5 * 60 * 1000

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
    const now = useNow(20000)

    // Captured via ref (not a dependency) so autoTrack flipping back to false
    // right after being consumed doesn't re-run this effect and undo tracking.
    const autoTrackRef = useRef(autoTrack)
    autoTrackRef.current = autoTrack

    // Reset per-journey UI state whenever a different (or no) route is selected.
    useEffect(() => {
        setJourneyStarted(!!autoTrackRef.current)
        setActiveSnapPoint(0.4)
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

    // Which leg the rider is on right now, by delay-adjusted schedule: the first
    // leg whose adjusted arrival is still in the future. Before departure that's
    // leg 0; once every leg's arrival has passed, the last leg.
    const currentLegIndex = useMemo(() => {
        if (!route) return -1
        const nowMs = now.getTime()
        const idx = route.Legs.findIndex(
            (l) => nowMs < new Date(l.ArrivalTime).getTime() + (l.delay_seconds ?? 0) * 1000
        )
        return idx === -1 ? route.Legs.length - 1 : idx
    }, [route, now])
    const currentLeg = currentLegIndex >= 0 ? route?.Legs[currentLegIndex] : undefined

    // The transit leg to track: the current leg if it's transit, otherwise the
    // next transit leg coming up - always in journey order, so a later bus that
    // happens to have realtime can't be jumped ahead of an earlier one that
    // doesn't. Exception: if the earliest pending transit leg is well past its
    // adjusted departure and still shows no live vehicle, allow skipping to a
    // later leg that does (bad schedule data / a cancelled-but-not-flagged run).
    const activeTransitLeg = useMemo(() => {
        if (!route || currentLegIndex < 0) return undefined
        const upcoming = route.Legs
            .map((l, i) => ({ l, i }))
            .filter(({ l, i }) => i >= currentLegIndex && l.Mode === "transit")
        if (upcoming.length === 0) return undefined
        const first = upcoming[0].l
        const firstOverdueMs =
            now.getTime() - (new Date(first.DepartureTime).getTime() + (first.delay_seconds ?? 0) * 1000)
        if (!vehiclesByTripId[first.TripID] && firstOverdueMs > OVERDUE_SKIP_MS) {
            const live = upcoming.find(({ l }) => vehiclesByTripId[l.TripID])
            if (live) return live.l
        }
        return first
    }, [route, currentLegIndex, vehiclesByTripId, now])

    const trackedTripId =
        journeyStarted && activeTransitLeg && vehiclesByTripId[activeTransitLeg.TripID]
            ? activeTransitLeg.TripID
            : undefined
    const trackedVehicle = trackedTripId ? vehiclesByTripId[trackedTripId] : undefined
    const trackedStops = useTrackedTripStops(trackedTripId ?? null)
    const trackedRouteLine = useRouteLine(trackedTripId ?? "", trackedVehicle?.route.id)
    const followMarkerId = trackedVehicle ? `vehicle-${trackedVehicle.trip_id}` : undefined

    // The leg whose board/alight stops + walk-to-stop indicator the map should
    // show: the tracked vehicle's leg, or - before any vehicle is live - the
    // current/next transit leg (so the walking-to-the-first-stop indicator
    // doesn't depend on a vehicle having been assigned yet).
    const trackedLeg =
        (trackedTripId && route?.Legs.find((l) => l.TripID === trackedTripId)) ||
        (journeyStarted ? activeTransitLeg : undefined)
    const trackedBoardStop = trackedLeg?.FromStop ?? undefined
    const trackedAlightStop = trackedLeg?.ToStop ?? undefined

    // If there's a walk leg immediately before the tracked one, the rider may
    // still be walking there - LiveMap shows that (hidden once their live
    // location is close enough to the boarding stop). FromStop null on that
    // walk leg means it's the very first leg, starting from startLocation.
    const trackedLegIndex = trackedLeg && route ? route.Legs.indexOf(trackedLeg) : -1
    const precedingWalkLeg = trackedLegIndex > 0 ? route?.Legs[trackedLegIndex - 1] : undefined
    const walkingToStopFrom = precedingWalkLeg?.Mode === 'walk'
        ? (precedingWalkLeg.FromStop
            ? { lat: precedingWalkLeg.FromStop.stop_lat, lon: precedingWalkLeg.FromStop.stop_lon }
            : startLocation ? { lat: startLocation.lat, lon: startLocation.lon } : undefined)
        : undefined

    const defaultZoom = useMemo<[LatLng, LatLng]>(() => [
        [route?.StartLat ?? 0, route?.StartLon ?? 0],
        [route?.EndLat ?? 0, route?.EndLon ?? 0],
    ], [route?.StartLat, route?.StartLon, route?.EndLat, route?.EndLon])

    if (!route) return null

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
            vehiclesByTripId={vehiclesByTripId}
            followMarkerId={followMarkerId}
            trackedVehicle={trackedVehicle}
            trackedStops={trackedStops}
            trackedRouteLine={trackedRouteLine}
            trackedBoardStop={trackedBoardStop}
            trackedAlightStop={trackedAlightStop}
            walkingToStopFrom={walkingToStopFrom}
            followUser={journeyStarted && !trackedVehicle && currentLeg?.Mode === "walk"}
            showOverlayButtons
            onToggleAlternates={onShowAlternates}
        />
    )

    const summary = (
        <JourneySummary
            route={route}
            onShare={handleShare}
            journeyStarted={journeyStarted}
            onGo={() => setJourneyStarted(true)}
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
                            <RouteItinerary route={route} />
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
                snapPoints={[0.4, 0.85]}
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
                        <RouteItinerary route={route} />
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
}: {
    route: JourneyType
    onShare: () => void
    journeyStarted: boolean
    onGo: () => void
}) {
    const firstTransitLeg = route.Legs.find(l => l.Mode === 'transit')
    const headsign = journeyHeadsign(route)
    const stopCount = journeyStopCount(route)

    // Delay-adjusted arrival, and a live "time remaining" countdown against it -
    // ticks down as real time passes, and runs longer than the planned duration
    // whenever the last transit leg is running late.
    const now = useNow(30000)
    const delaySeconds = journeyDelaySeconds(route)
    const adjustedArrival = new Date(new Date(route.ArrivalTime).getTime() + delaySeconds * 1000)
    const remainingMs = adjustedArrival.getTime() - now.getTime()
    const remainingLabel = remainingMs <= 30000 ? "Arrived" : formatDuration(remainingMs * 1_000_000)

    return (
        <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    {firstTransitLeg?.Route && (
                        <span
                            className="shrink-0 px-2 py-1 rounded text-sm font-semibold"
                            style={{
                                background: "#" + (firstTransitLeg.Route.route_color || "424242"),
                                color: firstTransitLeg.Route.route_text_color ? `#${firstTransitLeg.Route.route_text_color}` : "#ffffff",
                            }}
                        >
                            {firstTransitLeg.Route.route_short_name || firstTransitLeg.RouteID}
                        </span>
                    )}
                    <div className="min-w-0">
                        <p className="text-base font-semibold truncate">{headsign ?? "Your journey"}</p>
                        <p className="text-xs text-muted-foreground">
                            {stopCount > 0 ? `${stopCount} stop${stopCount !== 1 ? 's' : ''}` : `${route.Transfers} transfer${route.Transfers !== 1 ? 's' : ''}`}
                        </p>
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
        </div>
    )
}

function RouteItinerary({ route }: { route: JourneyType }) {
    return (
        <div className="space-y-1">
            {route.Legs.map((leg, legIndex) => (
                <LegRow key={legIndex} leg={leg} isLast={legIndex === route.Legs.length - 1} nextLeg={route.Legs[legIndex + 1]} />
            ))}
        </div>
    )
}

function LegRow({ leg, isLast, nextLeg }: { leg: Leg; isLast: boolean; nextLeg?: Leg }) {
    const isWalk = leg.Mode === 'walk'
    const isDelayed = leg.realtime_status === RealtimeStatus.Delayed
    const isEarly = leg.realtime_status === RealtimeStatus.Early
    const isOnTime = leg.realtime_status === RealtimeStatus.OnTime
    const hasRealtime = isDelayed || isEarly || isOnTime
    const routeColor = leg.Route?.route_color ? `#${leg.Route.route_color}` : "#424242"
    const waitNs = nextLeg ? getWaitingTimeNs(leg, nextLeg) : null

    return (
        <div className="relative">
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
                                color: leg.Route?.route_text_color ? `#${leg.Route.route_text_color}` : "#ffffff",
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
                        <span className="text-xs text-muted-foreground">· {formatDuration(leg.Duration)}</span>
                    </div>
                )}
            </div>

            <div className="ml-2 space-y-0 border-l-2 border-border pl-4">
                <div className="relative py-2">
                    <span className="absolute -left-[21px] top-3 h-3 w-3 rounded-full border-2 border-background bg-green-500 ring-1 ring-green-500" />
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-medium text-sm">{formatTime(leg.DepartureTime)}</span>
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
                        <span className="font-medium text-sm">{formatTime(leg.ArrivalTime)}</span>
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
