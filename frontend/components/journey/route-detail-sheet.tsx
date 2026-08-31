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
    const isMobile = useIsMobile()
    const [activeSnapPoint, setActiveSnapPoint] = useState<number | string | null>(0.4)
    const [journeyStarted, setJourneyStarted] = useState(false)

    // Captured via ref (not a dependency) so autoTrack flipping back to false
    // right after being consumed doesn't re-run this effect and undo tracking.
    const autoTrackRef = useRef(autoTrack)
    autoTrackRef.current = autoTrack

    // Reset per-journey UI state whenever a different (or no) route is selected.
    useEffect(() => {
        setJourneyStarted(!!autoTrackRef.current)
        setActiveSnapPoint(0.4)
    }, [route?.ID])

    const tripIds = useMemo(() => (route ? getTransitTripIds(route) : []), [route])
    const { vehiclesByTripId } = useJourneyVehicles(tripIds, open && journeyStarted)

    // The trip currently in service among this journey's legs - there's normally
    // at most one at a time, since transit legs run sequentially.
    const trackedTripId = journeyStarted ? tripIds.find((id) => vehiclesByTripId[id]) : undefined
    const trackedVehicle = trackedTripId ? vehiclesByTripId[trackedTripId] : undefined
    const trackedStops = useTrackedTripStops(trackedTripId ?? null)
    const trackedRouteLine = useRouteLine(trackedTripId ?? "", trackedVehicle?.route.id)
    const followMarkerId = trackedVehicle ? `vehicle-${trackedVehicle.trip_id}` : undefined

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
            defaultZoom={[[route.StartLat, route.StartLon], [route.EndLat, route.EndLon]]}
            startLocation={startLocation}
            endLocation={endLocation}
            selectedRoute={route}
            vehiclesByTripId={vehiclesByTripId}
            followMarkerId={followMarkerId}
            trackedVehicle={trackedVehicle}
            trackedStops={trackedStops}
            trackedRouteLine={trackedRouteLine}
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
            {open && (
                <div className="fixed inset-0 z-40">
                    {map}
                </div>
            )}
            <Drawer
                open={open}
                onOpenChange={onOpenChange}
                modal={false}
                snapPoints={[0.4, 0.85]}
                activeSnapPoint={activeSnapPoint}
                setActiveSnapPoint={setActiveSnapPoint}
            >
                <DrawerContent overlayClassName="hidden" className="z-50">
                    <DrawerTitle className="sr-only">Route details</DrawerTitle>
                    <div className="overflow-y-auto px-4 pb-4 space-y-4">
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
                    <p className="text-lg font-bold leading-none">{formatDuration(route.TotalDuration)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatTime(route.DepartureTime)} - {formatTime(route.ArrivalTime)}</p>
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
