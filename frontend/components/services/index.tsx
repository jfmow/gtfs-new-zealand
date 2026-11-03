import { useEffect, useRef, useState } from "react"
import {
    AccessibilityIcon,
    Bell,
    BikeIcon,
    ChevronDown,
    ChevronUp,
    History,
    Rss,
} from "lucide-react"
import { convert24hTo12h, formatTextToNiceLookingWords, headsignDisplay } from "@/lib/formating"
import { getOccupancyShort } from "./occupancy"
import ServiceTrackerView from "./tracker/panel"
import type { PreviewData } from "./tracker"
import { ApiFetch } from "@/lib/url-context"
import { cn, fullyEncodeURIComponent, useIsMobile, useOnlineStatus } from "@/lib/utils"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../ui/context-menu"
import { StopReminderDialog } from "./stop-reminder-dialog"
import ErrorScreen, { InfoScreen } from "../ui/error-screen"
import { DisplayTodaysAlerts } from "@/pages/alerts"
import ServicesLoadingSkeleton from "./loading-skeleton"
import { motion, AnimatePresence } from "framer-motion"
import { inRegion, regionMidnightOf } from "@/lib/region-time"

interface ServicesProps {
    stopName: string
    filterDate: Date | undefined
    /**
     * Hands a tapped departure to the parent instead of opening the tracker
     * here - the /map side panel shows it in the panel, over the page's map.
     */
    onOpenService?: (target: ServiceTrackerTarget) => void
    /** The service the parent is showing, highlighted in the list. */
    openTripId?: string
}

/** What ServiceTrackerView needs to open one departure. */
export interface ServiceTrackerTarget {
    tripId: string
    has: boolean
    tripUpdateTracking: boolean
    currentStop: {
        parent_stop_id: string
        child_stop_id: string
        lat: number
        lon: number
        name: string
    }
    previewData: PreviewData
}

function trackerTargetFor(service: Service): ServiceTrackerTarget {
    return {
        tripId: service.trip_id,
        has: service.location_tracking,
        tripUpdateTracking: service.trip_update_tracking,
        currentStop: {
            parent_stop_id: service.stop.parent_stop_id,
            child_stop_id: service.stop.child_stop_id,
            lat: service.stop.lat,
            lon: service.stop.lon,
            name: service.stop.name,
        },
        previewData: {
            tripHeadsign: service.headsign,
            route_id: service.route.id,
            route_name: service.route.name,
            trip_id: service.trip_id,
            route_color: service.route.color,
        } as PreviewData,
    }
}

export interface Service {
    trip_id: string
    headsign: string
    arrival_time: string
    platform: string
    stops_away: number
    occupancy: number
    /** Train length in cars once it's live - absent for buses/ferries or when unknown. */
    cars?: number
    canceled: boolean
    skipped: boolean
    bikes_allowed: number
    wheelchairs_allowed: number
    route: ServicesRoute
    stop: ServicesStop
    trip_update_tracking: boolean
    location_tracking: boolean
    departed: boolean
    time_till_arrival: number
    /** "" when no trip-update tracking is available for this service yet. */
    stop_state: "Unknown" | "Arriving" | "AtStop" | "Leaving" | "Travelling" | ""
    platform_changed: boolean
    trip_started: boolean
}

export interface ServicesRoute {
    id: string
    name: string
    color: string
}

export interface ServicesStop {
    lat: number
    lon: number
    parent_stop_id: string
    child_stop_id: string
    name: string
    platform: string
    sequence: number
}

type PlatformFilter = {
    type: "platforms" | "routes"
    value: string | number
}

const REFRESH_INTERVAL = 10

export default function Services({ stopName, filterDate, onOpenService, openTripId }: ServicesProps) {
    const [services, setServices] = useState<Service[]>([])
    const [errorMessage, setErrorMessage] = useState("")
    const [errorTrace, setErrorTrace] = useState("")
    const [platformFilter, setPlatformFilter] = useState<PlatformFilter>({ type: 'platforms', value: "all" })
    const [isInitialLoading, setIsInitialLoading] = useState(true)
    const displayingSchedulePreview = filterDate ? true : false
    const [showAllPlatforms, setShowAllPlatforms] = useState(false)
    const [selectedService, setSelectedService] = useState<Service | null>(null)
    const [reminderFor, setReminderFor] = useState<Service | null>(null)
    /** When the departures last came back - shown once refreshes start failing, so a frozen board doesn't pass for live. */
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
    const [refreshFailed, setRefreshFailed] = useState(false)
    const retryRef = useRef<(() => void) | null>(null)
    const online = useOnlineStatus()
    const isMobile = useIsMobile()

    const getUniquePlatforms = (services: Service[]) => {
        const platforms = services.map((service) => service.platform)
        const uniquePlatforms = [...new Set(platforms)]
            .filter((i) => i !== "" && i !== undefined && i !== "no platform")
            .sort((a, b) => {
                if (!isNaN(Number(a)) && !isNaN(Number(b))) {
                    return Number(a) - Number(b)
                }
                return a.localeCompare(b)
            })

        if (uniquePlatforms.length === 0) {
            const routes = services.map((service) => service.route.name)
            const uniqueRoutes = [...new Set(routes)].sort()
            return { platforms: uniqueRoutes, type: "routes" }
        }
        return { platforms: uniquePlatforms, type: "platforms" }
    }

    useEffect(() => {
        if (stopName === "") return

        // A request fired for the previous stopName/filterDate can still resolve
        // after this effect re-runs for a new one - `cancelled` stops it from
        // clobbering the new stop's services with the old stop's response.
        let cancelled = false
        let hasData = false

        setServices([])
        setLastUpdated(null)
        setRefreshFailed(false)
        setPlatformFilter({ type: 'platforms', value: "all" })
        setSelectedService(null)
        setIsInitialLoading(true)

        async function fetchServices(date?: Date) {
            const req = await ApiFetch<Service[]>(
                encodeURI(
                    `/services/${fullyEncodeURIComponent(stopName)}${date ? `/schedule?date=${Math.floor(regionMidnightOf(date).getTime() / 1000)}` : "?limit=200"}`,
                ),
            )
            if (cancelled) return
            if (req.ok) {
                hasData = true
                setServices(req.data)
                setIsInitialLoading(false)
                setErrorMessage("")
                setLastUpdated(new Date())
                setRefreshFailed(false)
            } else if (hasData && req.status_code !== 404) {
                // Keep the last good board and say how old it is.
                setRefreshFailed(true)
            } else {
                setErrorTrace(req.trace_id || "")
                if (req.status_code === 404) {
                    setErrorMessage("no-services")
                } else {
                    setErrorMessage(req.error)
                    setIsInitialLoading(false)
                }
            }
        }

        let intervalId: NodeJS.Timeout | null = null

        function startAutoRefresh() {
            fetchServices(filterDate)
            if (!filterDate) {
                intervalId = setInterval(() => fetchServices(filterDate), REFRESH_INTERVAL * 1000)
            }
        }

        startAutoRefresh()
        retryRef.current = () => fetchServices(filterDate)

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                startAutoRefresh()
            } else if (document.visibilityState === "hidden") {
                if (intervalId) clearInterval(intervalId)
            }
        }

        document.addEventListener("visibilitychange", handleVisibilityChange)

        return () => {
            cancelled = true
            if (intervalId) clearInterval(intervalId)
            document.removeEventListener("visibilitychange", handleVisibilityChange)
        }
    }, [stopName, filterDate])

    if (errorMessage !== "") {
        if (errorMessage === "no-services") {
            return (
                <>
                    <DisplayTodaysAlerts stopName={stopName} forceDisplay />
                    <InfoScreen
                        infoTitle="No services scheduled"
                        infoText={`Nothing is scheduled to call at "${stopName}" around this time. Try another time or a nearby stop.`}
                    />
                </>
            )
        }
        return <ErrorScreen traceId={errorTrace} errorTitle="Could not load departures" errorText={errorMessage} />
    }

    if (stopName === "") return null

    if (isInitialLoading) {
        return (
            <div className="mx-auto w-full max-w-2xl px-4 pb-10">
                <ServicesLoadingSkeleton />
            </div>
        )
    }

    const uniquePlatforms = getUniquePlatforms(services)
    const shouldShowExpandButton = uniquePlatforms.platforms.length > 3 && isMobile
    const platformsToShow = shouldShowExpandButton && !showAllPlatforms
        ? uniquePlatforms.platforms.slice(0, 3)
        : uniquePlatforms.platforms

    const visibleServices = sortServices(services, platformFilter)
    const isStale = !filterDate && (refreshFailed || !online) && lastUpdated !== null

    const trackerProps = selectedService && trackerTargetFor(selectedService)

    return (
        <div className="mx-auto w-full max-w-2xl px-4 pb-10">
            <div className="min-w-0 flex-1">
                {isStale && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300" role="status">
                        <History className="h-3.5 w-3.5 shrink-0" />
                        <span className="flex-1">
                            {online ? "Couldn't refresh" : "You're offline"} · times as of{" "}
                            {lastUpdated!.toLocaleTimeString("en-NZ", inRegion({ hour: "numeric", minute: "2-digit" }))}
                        </span>
                        {online && (
                            <button type="button" onClick={() => retryRef.current?.()} className="font-medium underline-offset-2 hover:underline">
                                Retry
                            </button>
                        )}
                    </div>
                )}
                {uniquePlatforms.platforms.length > 1 && (
                    <section className="mb-3" aria-labelledby="platform-filter-heading">
                        <h2 id="platform-filter-heading" className="sr-only">
                            Filter departures by {uniquePlatforms.type === "platforms" ? "platform" : "route"}
                        </h2>
                        <div className="space-y-2">
                            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Platform filters">
                                <FilterChip
                                    selected={platformFilter.value === "all"}
                                    onClick={() => setPlatformFilter({ ...platformFilter, value: "all" })}
                                >
                                    All {uniquePlatforms.type === "platforms" ? "platforms" : "routes"}
                                </FilterChip>
                                {platformsToShow.map((platform) => (
                                    <FilterChip
                                        key={platform}
                                        selected={platformFilter.value === platform}
                                        onClick={() => setPlatformFilter({ ...platformFilter, value: platform })}
                                    >
                                        {uniquePlatforms.type === "platforms" ? "Platform " : ""}{platform}
                                    </FilterChip>
                                ))}
                            </div>
                            {shouldShowExpandButton && (
                                <button
                                    onClick={() => setShowAllPlatforms(!showAllPlatforms)}
                                    aria-expanded={showAllPlatforms}
                                    className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    {showAllPlatforms ? (
                                        <><ChevronUp className="h-3 w-3" /> Show fewer</>
                                    ) : (
                                        <><ChevronDown className="h-3 w-3" /> {uniquePlatforms.platforms.length - 3} more</>
                                    )}
                                </button>
                            )}
                        </div>
                    </section>
                )}

                <section aria-labelledby="services-heading">
                    <h2 id="services-heading" className="sr-only">Departures from {stopName}</h2>

                    {visibleServices.length === 0 ? (
                        <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                            Nothing on this {uniquePlatforms.type === "platforms" ? "platform" : "route"} right now.
                        </p>
                    ) : (
                        <ul
                            id="services-list"
                            role="list"
                            aria-live="polite"
                            aria-atomic="false"
                            className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
                        >
                            <AnimatePresence mode="popLayout" initial={false}>
                                {visibleServices.map((service) => (
                                    <motion.li
                                        key={service.trip_id + service.platform}
                                        layout
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.15, layout: { duration: 0.25 } }}
                                    >
                                        <ServiceRow
                                            service={service}
                                            displayingSchedulePreview={displayingSchedulePreview}
                                            selected={(openTripId ?? selectedService?.trip_id) === service.trip_id}
                                            onOpen={() => onOpenService ? onOpenService(trackerTargetFor(service)) : setSelectedService(service)}
                                            onRemind={() => setReminderFor(service)}
                                        />
                                    </motion.li>
                                ))}
                            </AnimatePresence>
                        </ul>
                    )}
                </section>

            </div>

            <StopReminderDialog
                offersGetOff={false}
                target={reminderFor && {
                    tripId: reminderFor.trip_id,
                    parentStopId: reminderFor.stop.parent_stop_id,
                    stopName: reminderFor.stop.name,
                    serviceLabel: `${reminderFor.route.name} to ${formatTextToNiceLookingWords(reminderFor.headsign)}`,
                }}
                onOpenChange={(open) => { if (!open) setReminderFor(null) }}
            />

            {selectedService && trackerProps && (
                <ServiceTrackerView
                    key={trackerProps.tripId}
                    variant={isMobile ? "sheet" : "dialog"}
                    backLabel="Departures"
                    tripId={trackerProps.tripId}
                    has={trackerProps.has}
                    tripUpdateTracking={trackerProps.tripUpdateTracking}
                    currentStop={trackerProps.currentStop}
                    previewData={trackerProps.previewData}
                    onClose={() => setSelectedService(null)}
                />
            )}
        </div>
    )
}

function FilterChip({
    selected,
    onClick,
    children,
}: {
    selected: boolean
    onClick: () => void
    children: React.ReactNode
}) {
    return (
        <button
            role="tab"
            aria-selected={selected}
            onClick={onClick}
            className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
        >
            {children}
        </button>
    )
}

function ServiceRow({
    service,
    displayingSchedulePreview,
    selected,
    onOpen,
    onRemind,
}: {
    service: Service
    displayingSchedulePreview: boolean
    selected: boolean
    onOpen: () => void
    /** "Remind me before it arrives" - right-click, or long-press on touch (the iOS row's context menu). */
    onRemind: () => void
}) {
    const isCanceled = service.canceled
    const isSkipped = service.skipped
    const isDeparted = service.departed && !displayingSchedulePreview
    // Only offer the tracker when there's actually something live to track.
    // A "Timetable only" service has no vehicle and no arrival predictions - the
    // tracker would just show a static stop list, and half the time can't even
    // load that (the trip may not be in the backend's stop cache), so it dead-
    // ends on a row we told the rider they could tap.
    const hasRealtime = service.location_tracking || service.trip_update_tracking
    const trackable =
        !displayingSchedulePreview && !isCanceled && !isDeparted && !isSkipped && hasRealtime

    const tint = isCanceled
        ? "bg-destructive/[0.06]"
        : isSkipped
            ? "bg-blue-500/[0.06]"
            : isDeparted
                ? "bg-amber-500/[0.06]"
                : ""

    const hasPlatform =
        service.platform && service.platform !== "" && service.platform !== "no platform"

    // Occupancy, "N stops away" and "at this stop" only mean something when this
    // service is actually being tracked - otherwise the values are placeholders
    // and would falsely tell a rider the bus has seats or is two stops out.
    // A cancelled or skipped service still carries a stale sequence from the
    // feed; don't dress "Cancelled" up with "6 stops away".
    const isLive =
        !displayingSchedulePreview && !isCanceled && !isSkipped &&
        (service.location_tracking || service.trip_update_tracking)
    const showOccupancy = isLive && service.location_tracking && service.occupancy >= 0

    // How much we really know about where this service is right now. A cancelled
    // or skipped service says its own thing ("Cancelled" / "Not stopping") - a
    // "Limited tracking" badge next to that is just noise.
    const tracking: "live" | "limited" | "scheduled" | "none" = isCanceled || isSkipped
        ? "none"
        : service.location_tracking
            ? "live"
            : service.trip_update_tracking
                ? "limited"
                : "scheduled"

    // Most useful first. The line is one row tall and wraps, so whatever
    // doesn't fit drops off whole rather than being cut mid-word - the
    // iOS row's ViewThatFits.
    const details: React.ReactNode[] = []
    if (hasPlatform) {
        details.push(service.platform_changed
            ? <span key="pl" className="font-medium text-destructive">Now platform {service.platform}</span>
            : <span key="pl">Platform {service.platform}</span>)
    }
    if (isLive && service.stops_away === -1 && service.stop_state === "AtStop") {
        details.push(<span key="at" className="text-blue-600 dark:text-blue-400">At the stop</span>)
    } else if (isLive && service.stops_away > 0) {
        details.push(<span key="away">{service.stops_away} {service.stops_away === 1 ? "stop" : "stops"} away</span>)
    }
    if (!displayingSchedulePreview && tracking === "scheduled") details.push(<span key="tt">Timetable only</span>)
    if (!displayingSchedulePreview && !isCanceled) details.push(<span key="time" className="tabular-nums">{convert24hTo12h(service.arrival_time)}</span>)
    if (isLive && !!service.cars) details.push(<span key="cars">{service.cars} cars</span>)
    if (showOccupancy) details.push(<span key="occ">{getOccupancyShort(service.occupancy)}</span>)
    if (service.bikes_allowed === 1) details.push(<BikeIcon key="bike" aria-label="Bikes allowed" className="h-3.5 w-3.5 self-center" />)
    if (service.wheelchairs_allowed === 1) details.push(<AccessibilityIcon key="wc" aria-label="Wheelchair accessible" className="h-3.5 w-3.5 self-center" />)

    // A board line, like Home's: route, destination and the countdown on
    // the right, the details under the destination (2026-11-03, iOS).
    const inner = (
        <div className={cn("flex w-full items-center gap-3 px-3.5 py-2.5 text-left", tint)}>
            <span className="min-w-[44px] shrink-0">
                <span
                    className="inline-block rounded px-1.5 py-0.5 text-xs font-semibold leading-4 text-white"
                    style={{ background: "#" + (service.route.color || "424242") }}
                >
                    {service.route.name}
                </span>
            </span>
            <div className="min-w-0 flex-1">
                <p className={cn("truncate text-[15px] font-medium leading-snug", isCanceled || isSkipped ? "text-muted-foreground" : "text-foreground", isCanceled && "line-through")}>
                    {headsignDisplay(service.headsign)}
                </p>
                {details.length > 0 && (
                    <div className="mt-0.5 flex h-[18px] flex-wrap items-center gap-x-2.5 overflow-hidden text-[13px] leading-[18px] text-muted-foreground">
                        {details}
                    </div>
                )}
            </div>
            {tracking === "live" && !isDeparted && !displayingSchedulePreview && (
                <Rss className="h-3 w-3 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />
            )}
            <div className="shrink-0 text-right">
                <BoardTime service={service} displayingSchedulePreview={displayingSchedulePreview} />
            </div>
        </div>
    )

    if (!trackable) {
        return inner
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <button
                    type="button"
                    onClick={onOpen}
                    aria-label={`Track ${service.route.name} to ${formatTextToNiceLookingWords(service.headsign)}`}
                    className={cn(
                        "block w-full select-none transition-colors hover:bg-muted/50 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [-webkit-touch-callout:none]",
                        selected && "bg-accent ring-1 ring-inset ring-border",
                    )}
                >
                    {inner}
                </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onSelect={onRemind} className="gap-2">
                    <Bell className="h-3.5 w-3.5" />
                    Remind me before it arrives
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    )
}

function BoardTime({
    service,
    displayingSchedulePreview,
}: {
    service: Service
    displayingSchedulePreview: boolean
}) {
    if (displayingSchedulePreview) {
        return (
            <span className="text-sm font-semibold tabular-nums text-foreground">
                {convert24hTo12h(service.arrival_time)}
            </span>
        )
    }
    if (service.canceled) {
        return <span className="text-sm font-semibold text-destructive">Cancelled</span>
    }
    if (service.skipped) {
        return (
            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">Not stopping</span>
        )
    }
    if (service.departed) {
        return <span className="text-sm font-bold text-amber-600 dark:text-amber-400">Departed</span>
    }

    const tracked = service.location_tracking || service.trip_update_tracking
    return (
        <span
            className={cn(
                "font-mono text-base font-medium leading-none tabular-nums",
                tracked ? "text-blue-600 dark:text-blue-400" : "text-foreground",
            )}
        >
            {boardCountdown(service.time_till_arrival)}
        </span>
    )
}

function boardCountdown(minutes: number): string {
    if (minutes <= 0.5) return "Now"
    const hours = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
    return `${mins} min`
}

export { getOccupancyLabel, getOccupancyShort } from "./occupancy"

function sortServices(services: Service[], platformFilter: PlatformFilter | undefined) {
    return services
        .filter((item) => platformFilter?.value === "all" || item.platform === platformFilter?.value || item.route.name === platformFilter?.value)
        // A cancelled or skipped service stays on the board longer than a normal
        // one - a rider standing on the platform still needs to see that the
        // train they were waiting for isn't coming / won't stop.
        .filter((item) => item.time_till_arrival >= ((item.canceled || item.skipped) ? -20 : -2))
        .sort((a, b) => {
            if (!a.canceled && !b.canceled) {
                if (a.departed && !b.departed) return -1
                if (!a.departed && b.departed) return 1
            }
            // Sort on the backend's day-aware minutes-until value, NOT a
            // re-parse of arrival_time: a realtime-predicted after-midnight time
            // comes back formatted "00:06:00" and timeTillArrival() would read
            // that as ~20h in the past, flinging tonight's post-midnight trains
            // to the top of the board.
            return a.time_till_arrival - b.time_till_arrival
        })
}

