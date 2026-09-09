import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import {
    AccessibilityIcon,
    BikeIcon,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    ClockIcon,
    InfoIcon,
    MapPinIcon,
    WaypointsIcon,
} from "lucide-react"
import { convert24hTo12h, formatTextToNiceLookingWords } from "@/lib/formating"
import { getOccupancyShort } from "./occupancy"
import ServiceTrackerView from "./tracker/panel"
import type { PreviewData } from "./tracker"
import { ApiFetch } from "@/lib/url-context"
import { cn, fullyEncodeURIComponent, useIsMobile } from "@/lib/utils"
import ErrorScreen, { InfoScreen } from "../ui/error-screen"
import { DisplayTodaysAlerts } from "@/pages/alerts"
import ServicesLoadingSkeleton from "./loading-skeleton"
import { motion, AnimatePresence } from "framer-motion"

interface ServicesProps {
    stopName: string
    filterDate: Date | undefined
}

export interface Service {
    trip_id: string
    headsign: string
    arrival_time: string
    platform: string
    stops_away: number
    occupancy: number
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

export default function Services({ stopName, filterDate }: ServicesProps) {
    const [services, setServices] = useState<Service[]>([])
    const [errorMessage, setErrorMessage] = useState("")
    const [errorTrace, setErrorTrace] = useState("")
    const [platformFilter, setPlatformFilter] = useState<PlatformFilter>({ type: 'platforms', value: "all" })
    const [isInitialLoading, setIsInitialLoading] = useState(true)
    const displayingSchedulePreview = filterDate ? true : false
    const [showAllPlatforms, setShowAllPlatforms] = useState(false)
    const [selectedService, setSelectedService] = useState<Service | null>(null)
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

        setServices([])
        setPlatformFilter({ type: 'platforms', value: "all" })
        setSelectedService(null)
        setIsInitialLoading(true)

        async function fetchServices(date?: Date) {
            const req = await ApiFetch<Service[]>(
                encodeURI(
                    `/services/${fullyEncodeURIComponent(stopName)}${date ? `/schedule?date=${Math.floor(date.getTime() / 1000)}` : "?limit=200"}`,
                ),
            )
            if (cancelled) return
            if (req.ok) {
                setServices(req.data)
                setIsInitialLoading(false)
                setErrorMessage("")
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

    const trackerProps = selectedService && {
        tripId: selectedService.trip_id,
        has: selectedService.location_tracking,
        tripUpdateTracking: selectedService.trip_update_tracking,
        currentStop: {
            parent_stop_id: selectedService.stop.parent_stop_id,
            child_stop_id: selectedService.stop.child_stop_id,
            lat: selectedService.stop.lat,
            lon: selectedService.stop.lon,
            name: selectedService.stop.name,
        },
        previewData: {
            tripHeadsign: selectedService.headsign,
            route_id: selectedService.route.id,
            route_name: selectedService.route.name,
            trip_id: selectedService.trip_id,
            route_color: selectedService.route.color,
        } as PreviewData,
    }

    return (
        <div className="mx-auto w-full max-w-2xl px-4 pb-10">
            <div className="min-w-0 flex-1">
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
                                            selected={selectedService?.trip_id === service.trip_id}
                                            onOpen={() => setSelectedService(service)}
                                        />
                                    </motion.li>
                                ))}
                            </AnimatePresence>
                        </ul>
                    )}
                </section>

                <IconKey />
            </div>

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
}: {
    service: Service
    displayingSchedulePreview: boolean
    selected: boolean
    onOpen: () => void
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

    const inner = (
        <div className={cn("flex w-full items-start gap-3 px-3 py-3 text-left", tint)}>
            {/* Route-colour rail: the one place agency colour lives */}
            <span
                aria-hidden
                className="mt-0.5 w-1 shrink-0 self-stretch rounded-full"
                style={{ background: "#" + (service.route.color || "9ca3af") }}
            />

            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span
                                className="rounded px-1.5 py-0.5 text-[11px] font-bold leading-4 tracking-wide text-white"
                                style={{ background: "#" + (service.route.color || "424242") }}
                            >
                                {service.route.name}
                            </span>
                            {service.platform_changed && (
                                <Badge className="h-4 border-red-200 bg-red-100 px-1.5 py-0 text-[10px] text-red-700 dark:border-red-800 dark:bg-red-900/40 dark:text-red-300">
                                    Platform changed
                                </Badge>
                            )}
                            {!displayingSchedulePreview && tracking === "limited" && (
                                <Badge
                                    variant="outline"
                                    className="h-4 border-amber-300 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:border-amber-700/70 dark:text-amber-400"
                                >
                                    Limited tracking
                                </Badge>
                            )}
                            {!displayingSchedulePreview && tracking === "scheduled" && (
                                <Badge
                                    variant="outline"
                                    className="h-4 px-1.5 py-0 text-[10px] font-medium text-muted-foreground"
                                >
                                    Timetable only
                                </Badge>
                            )}
                        </div>

                        <p className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
                            {formatTextToNiceLookingWords(service.headsign)}
                        </p>
                    </div>

                    <div className="shrink-0 pt-0.5 text-right">
                        <BoardTime service={service} displayingSchedulePreview={displayingSchedulePreview} />
                    </div>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {!displayingSchedulePreview && (
                        <span className="inline-flex items-center gap-1 tabular-nums">
                            <ClockIcon className="h-3 w-3 shrink-0" />
                            {convert24hTo12h(service.arrival_time)}
                        </span>
                    )}
                    {hasPlatform && (
                        <span
                            className={cn(
                                "inline-flex items-center gap-1",
                                service.platform_changed && "font-medium text-destructive",
                            )}
                        >
                            <MapPinIcon className="h-3 w-3 shrink-0" />
                            Platform {service.platform}
                        </span>
                    )}
                    {isLive && service.stops_away > 0 && (
                        <span className="inline-flex items-center gap-1">
                            <WaypointsIcon className="h-3 w-3 shrink-0" />
                            {service.stops_away} {service.stops_away === 1 ? "stop" : "stops"} away
                        </span>
                    )}
                    {isLive && service.stops_away === -1 && service.stop_state === "AtStop" && (
                        <span className="font-medium text-blue-600 dark:text-blue-400">At this stop</span>
                    )}
                    {showOccupancy && <span>{getOccupancyShort(service.occupancy)}</span>}

                    <span className="ml-auto inline-flex items-center gap-1.5">
                        <BikeIcon className={cn("h-3.5 w-3.5", allowedColor(service.bikes_allowed))} />
                        <AccessibilityIcon
                            className={cn("h-3.5 w-3.5", allowedColor(service.wheelchairs_allowed))}
                        />
                        {trackable && (
                            <ChevronRight className="h-4 w-4 text-muted-foreground/60" aria-hidden />
                        )}
                    </span>
                </div>
            </div>
        </div>
    )

    if (!trackable) {
        return inner
    }

    return (
        <button
            type="button"
            onClick={onOpen}
            aria-label={`Track ${service.route.name} to ${formatTextToNiceLookingWords(service.headsign)}`}
            className={cn(
                "block w-full transition-colors hover:bg-muted/50 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                selected && "bg-accent ring-1 ring-inset ring-border",
            )}
        >
            {inner}
        </button>
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
        return <span className="text-sm font-bold uppercase tracking-wide text-destructive">Cancelled</span>
    }
    if (service.skipped) {
        return (
            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">Not stopping</span>
        )
    }
    if (service.departed) {
        return <span className="text-sm font-bold text-amber-600 dark:text-amber-400">Departed</span>
    }

    const now = service.stops_away === 0 && service.time_till_arrival <= 1
    if (now) {
        return (
            <span className="live-dot text-xl font-bold leading-none text-blue-600 dark:text-blue-400">
                Now
            </span>
        )
    }

    const imminent = service.time_till_arrival <= 2
    return (
        <span
            className={cn(
                "text-xl font-bold leading-none tabular-nums",
                imminent ? "text-blue-600 dark:text-blue-400" : "text-foreground",
            )}
        >
            {boardCountdown(service.time_till_arrival)}
        </span>
    )
}

function IconKey() {
    return (
        <details className="mt-4 text-xs text-muted-foreground">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 hover:text-foreground [&::-webkit-details-marker]:hidden">
                <InfoIcon className="h-3.5 w-3.5" />
                What the icons mean
            </summary>
            <div className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
                <p className="flex items-center gap-1.5">
                    <BikeIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-400" /> bikes allowed
                    <span className="mx-1 text-border">|</span>
                    <BikeIcon className="h-3.5 w-3.5 text-amber-500" /> ask the operator
                    <span className="mx-1 text-border">|</span>
                    <BikeIcon className="h-3.5 w-3.5 text-red-500" /> no bikes
                </p>
                <p className="flex items-center gap-1.5">
                    <AccessibilityIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-400" /> step-free
                    <span className="mx-1 text-border">|</span>
                    <AccessibilityIcon className="h-3.5 w-3.5 text-amber-500" /> unknown
                    <span className="mx-1 text-border">|</span>
                    <AccessibilityIcon className="h-3.5 w-3.5 text-red-500" /> not step-free
                </p>
                <p>
                    <span className="font-medium text-amber-700 dark:text-amber-400">Limited tracking</span>{" "}
                    means we have arrival updates but no live position on the map.{" "}
                    <span className="font-medium">Timetable only</span> means this service isn&apos;t
                    reporting at all &mdash; times are scheduled.
                </p>
            </div>
        </details>
    )
}

function allowedColor(value: number): string {
    if (value === 1) return "text-green-600 dark:text-green-400"
    if (value === 2) return "text-red-500"
    return "text-amber-500"
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
