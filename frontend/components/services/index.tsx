import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AccessibilityIcon, BadgeInfoIcon, BikeIcon, ChevronDown, ChevronUp } from "lucide-react"
import { convert24hTo12h, formatTextToNiceLookingWords, timeTillArrival } from "@/lib/formating"
import ServiceTrackerModal from "./tracker"
import { ApiFetch } from "@/lib/url-context"
import { fullyEncodeURIComponent, useIsMobile } from "@/lib/utils"
import ErrorScreen, { InfoScreen } from "../ui/error-screen"
import { DisplayTodaysAlerts } from "@/pages/alerts"
import ServicesLoadingSkeleton from "./loading-skeleton"
import { motion, AnimatePresence } from "framer-motion"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip"

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
    stop_state: "Arrived" | "Departed" | "Arriving" | "Boarding"
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
    id: string
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
                        infoTitle="No Services Scheduled"
                        infoText={`No services are scheduled at "${stopName}" for this time.`}
                    />
                </>
            )
        }
        return <ErrorScreen traceId={errorTrace} errorTitle="Could not load services" errorText={errorMessage} />
    }

    if (stopName === "") return null

    if (isInitialLoading) {
        return (
            <div className="max-w-[1400px] w-full mx-auto p-4">
                <ServicesLoadingSkeleton />
            </div>
        )
    }

    const uniquePlatforms = getUniquePlatforms(services)
    const shouldShowExpandButton = uniquePlatforms.platforms.length > 3 && isMobile
    const platformsToShow = shouldShowExpandButton && !showAllPlatforms
        ? uniquePlatforms.platforms.slice(0, 3)
        : uniquePlatforms.platforms

    return (
        <div className="max-w-[1400px] w-full mx-auto px-4 pb-8">
            {uniquePlatforms.platforms.length > 1 && (
                <section className="mb-5" aria-labelledby="platform-filter-heading">
                    <h2 id="platform-filter-heading" className="sr-only">
                        Filter services by {uniquePlatforms.type === "platforms" ? "platform" : "route"}
                    </h2>
                    <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Platform filters">
                            <button
                                role="tab"
                                aria-selected={platformFilter.value === "all"}
                                onClick={() => setPlatformFilter({ ...platformFilter, value: "all" })}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 ${platformFilter.value === "all"
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                    }`}
                            >
                                All {uniquePlatforms.type === "platforms" ? "Platforms" : "Routes"}
                            </button>
                            {platformsToShow.map((platform) => (
                                <button
                                    key={platform}
                                    role="tab"
                                    aria-selected={platformFilter.value === platform}
                                    onClick={() => setPlatformFilter({ ...platformFilter, value: platform })}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 ${platformFilter.value === platform
                                        ? "bg-primary text-primary-foreground shadow-sm"
                                        : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                        }`}
                                >
                                    {uniquePlatforms.type === "platforms" ? "Platform " : ""}{platform}
                                </button>
                            ))}
                        </div>
                        {shouldShowExpandButton && (
                            <button
                                onClick={() => setShowAllPlatforms(!showAllPlatforms)}
                                aria-expanded={showAllPlatforms}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                {showAllPlatforms ? (
                                    <><ChevronUp className="w-3 h-3" /> Show fewer</>
                                ) : (
                                    <><ChevronDown className="w-3 h-3" /> {uniquePlatforms.platforms.length - 3} more</>
                                )}
                            </button>
                        )}
                    </div>
                </section>
            )}

            <section aria-labelledby="services-heading">
                <h2 id="services-heading" className="sr-only">Available services</h2>
                <ul
                    id="services-list"
                    role="list"
                    aria-live="polite"
                    aria-atomic="false"
                    className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
                >
                    <AnimatePresence mode="popLayout">
                        {sortServices(services, platformFilter).map((service, index) => (
                            <motion.li
                                key={service.trip_id + service.platform}
                                layout
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{
                                    duration: 0.18,
                                    delay: Math.min(index * 0.025, 0.25),
                                    layout: { duration: 0.25 },
                                }}
                                className="h-full"
                            >
                                <ServiceCard
                                    service={service}
                                    displayingSchedulePreview={displayingSchedulePreview}
                                />
                            </motion.li>
                        ))}
                    </AnimatePresence>
                </ul>
            </section>

            <footer className="mt-8 pt-5 border-t border-border">
                <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                        <BadgeInfoIcon className="w-3.5 h-3.5 shrink-0" />
                        <span>Partial tracking: trip updates only, no live location</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                            <BikeIcon className="w-3.5 h-3.5 text-green-600 dark:text-green-400" /> Bikes allowed
                        </span>
                        <span className="flex items-center gap-1">
                            <BikeIcon className="w-3.5 h-3.5 text-amber-500" /> Ask operator
                        </span>
                        <span className="flex items-center gap-1">
                            <BikeIcon className="w-3.5 h-3.5 text-red-500" /> No bikes
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                            <AccessibilityIcon className="w-3.5 h-3.5 text-green-600 dark:text-green-400" /> Accessible
                        </span>
                        <span className="flex items-center gap-1">
                            <AccessibilityIcon className="w-3.5 h-3.5 text-amber-500" /> Unknown
                        </span>
                        <span className="flex items-center gap-1">
                            <AccessibilityIcon className="w-3.5 h-3.5 text-red-500" /> Not accessible
                        </span>
                    </div>
                </div>
            </footer>
        </div>
    )
}

function ServiceCard({ service, displayingSchedulePreview }: { service: Service; displayingSchedulePreview: boolean }) {
    const isSpecialState = service.canceled || service.skipped || (service.departed && !displayingSchedulePreview)

    const statusStripeColor = service.canceled
        ? "bg-red-500"
        : service.skipped
            ? "bg-blue-500"
            : service.departed
                ? "bg-amber-500"
                : null

    return (
        <Card
            className={`h-full flex flex-col overflow-hidden transition-shadow duration-200 hover:shadow-md ${service.canceled
                ? "border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20"
                : service.skipped
                    ? "border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20"
                    : service.departed && !displayingSchedulePreview
                        ? "border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20"
                        : ""
                }`}
            role="article"
            aria-label={`${service.route.name} to ${formatTextToNiceLookingWords(service.headsign)}`}
        >
            {statusStripeColor && (
                <div className={`h-0.5 w-full ${statusStripeColor}`} aria-hidden="true" />
            )}

            <CardHeader className="p-4 pb-3">
                <div className="flex items-start gap-2.5">
                    {/* Route badge */}
                    <span
                        className="shrink-0 mt-0.5 px-2 py-0.5 rounded text-white text-xs font-bold tracking-wide leading-5"
                        style={{
                            background: "#" + (service.route.color || "424242"),
                        }}
                        aria-label={`Route ${service.route.name}`}
                    >
                        {service.route.name}
                    </span>

                    {/* Destination + status badges */}
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm leading-snug text-foreground line-clamp-2">
                            {formatTextToNiceLookingWords(service.headsign)}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                            {service.canceled && (
                                <Badge className="text-[10px] px-1.5 py-0 h-4 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800">
                                    Canceled
                                </Badge>
                            )}
                            {service.skipped && (
                                <Badge className="text-[10px] px-1.5 py-0 h-4 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                                    Not stopping
                                </Badge>
                            )}
                            {service.departed && !displayingSchedulePreview && (
                                <Badge className="text-[10px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                                    Departed
                                </Badge>
                            )}
                            {service.platform_changed && (
                                <Badge className="text-[10px] px-1.5 py-0 h-4 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800">
                                    Platform changed
                                </Badge>
                            )}
                            {service.trip_update_tracking && !service.location_tracking && service.trip_started && (
                                <TooltipProvider>
                                    <Tooltip delayDuration={100}>
                                        <TooltipTrigger>
                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 cursor-default">
                                                Partial updates
                                            </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Receiving trip updates but no live location</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>
                    </div>

                    {/* Time till arrival chip */}
                    {!displayingSchedulePreview && !isSpecialState && (
                        <div className={`shrink-0 rounded-lg px-2 py-1 text-center min-w-[48px] ${arrivalUrgencyClass(service.time_till_arrival)}`}>
                            <span className="text-sm font-bold leading-tight block tabular-nums">
                                {service.stops_away === 0 && service.time_till_arrival <= 1
                                    ? "Now"
                                    : formatArrivalTime(service.time_till_arrival)}
                            </span>
                        </div>
                    )}
                </div>
            </CardHeader>

            <CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col">
                {/* Scheduled time + platform row */}
                <div className="flex items-end justify-between gap-2">
                    <div className="space-y-1 text-sm">
                        <p className="text-muted-foreground leading-none">
                            {service.skipped ? "Passing" : "Scheduled"}{" "}
                            <time dateTime={service.arrival_time} className="text-foreground font-medium">
                                {convert24hTo12h(service.arrival_time)}
                            </time>
                        </p>
                        {!isSpecialState && !displayingSchedulePreview && (
                            <>
                                {service.stops_away > 0 && (
                                    <p className="text-muted-foreground leading-none">
                                        <span className="text-foreground font-medium">{service.stops_away}</span>{" "}
                                        {service.stops_away === 1 ? "stop" : "stops"} away
                                    </p>
                                )}
                                {service.stops_away === 0 && (
                                    <p className="text-green-700 dark:text-green-400 font-medium leading-none text-xs uppercase tracking-wide">
                                        At this stop
                                    </p>
                                )}
                                {service.occupancy > 0 && (
                                    <p className="text-muted-foreground leading-none">
                                        {getOccupancyLabel(service.occupancy)}
                                    </p>
                                )}
                            </>
                        )}
                    </div>

                    {/* Platform */}
                    {service.platform && service.platform !== "" && service.platform !== "no platform" && (
                        <div className="text-right shrink-0">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider leading-none mb-0.5">Platform</p>
                            <p className={`text-xl font-bold leading-none ${service.platform_changed ? "text-destructive" : "text-primary"}`}>
                                {service.platform}
                            </p>
                        </div>
                    )}
                </div>

                {/* Spacer pushes action row to bottom */}
                <div className="flex-1" />

                {/* Track button + accessibility icons — always at bottom */}
                {!displayingSchedulePreview && !service.canceled && !service.departed && !service.skipped && (
                    <div className="flex items-center gap-2 mt-3">
                        <div className="flex-1">
                            <ServiceTrackerModal
                                previewData={{
                                    tripHeadsign: service.headsign,
                                    route_id: service.route.id,
                                    route_name: service.route.name,
                                    trip_id: service.trip_id,
                                    route_color: service.route.color,
                                }}
                                currentStop={service.stop}
                                loaded={true}
                                has={service.location_tracking}
                                tripId={service.trip_id}
                            />
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <BikeIcon
                                aria-label={
                                    service.bikes_allowed === 1
                                        ? "Bikes allowed"
                                        : service.bikes_allowed === 2
                                            ? "No bikes"
                                            : "Ask about bikes"
                                }
                                className={`w-4 h-4 ${service.bikes_allowed === 1
                                    ? "text-green-600 dark:text-green-400"
                                    : service.bikes_allowed === 2
                                        ? "text-red-500"
                                        : "text-amber-500"
                                    }`}
                            />
                            <AccessibilityIcon
                                aria-label={
                                    service.wheelchairs_allowed === 1
                                        ? "Wheelchair accessible"
                                        : service.wheelchairs_allowed === 2
                                            ? "Not wheelchair accessible"
                                            : "Accessibility unknown"
                                }
                                className={`w-4 h-4 ${service.wheelchairs_allowed === 1
                                    ? "text-green-600 dark:text-green-400"
                                    : service.wheelchairs_allowed === 2
                                        ? "text-red-500"
                                        : "text-amber-500"
                                    }`}
                            />
                        </div>
                    </div>
                )}

                {/* Schedule preview: just accessibility icons at bottom */}
                {displayingSchedulePreview && (
                    <div className="flex items-center gap-1.5 mt-3">
                        <BikeIcon
                            className={`w-4 h-4 ${service.bikes_allowed === 1
                                ? "text-green-600 dark:text-green-400"
                                : service.bikes_allowed === 2
                                    ? "text-red-500"
                                    : "text-amber-500"
                                }`}
                        />
                        <AccessibilityIcon
                            className={`w-4 h-4 ${service.wheelchairs_allowed === 1
                                ? "text-green-600 dark:text-green-400"
                                : service.wheelchairs_allowed === 2
                                    ? "text-red-500"
                                    : "text-amber-500"
                                }`}
                        />
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

function arrivalUrgencyClass(minutes: number): string {
    if (minutes <= 1) return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
    if (minutes <= 5) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
    return "bg-primary/10 text-primary dark:bg-primary/20"
}

function getOccupancyLabel(value: number): string {
    switch (value) {
        case 0:
        case 1:
            return "Seats available"
        case 2:
            return "Some seats still available"
        case 3:
            return "Likely standing room only"
        case 4:
            return "Likely full, standing only"
        default:
            return ""
    }
}

function sortServices(services: Service[], platformFilter: PlatformFilter | undefined) {
    return services
        .filter((item) => platformFilter?.value === "all" || item.platform === platformFilter?.value || item.route.name === platformFilter?.value)
        .filter((item) => item.time_till_arrival >= -2)
        .sort((a, b) => {
            if (!a.canceled && !b.canceled) {
                if (a.departed && !b.departed) return -1
                if (!a.departed && b.departed) return 1
            }
            return timeTillArrival(a.arrival_time) - timeTillArrival(b.arrival_time)
        })
}

function formatArrivalTime(minutes: number): string {
    if (minutes <= 0.5) return "now"

    const hours = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)

    if (hours > 0 && mins > 0) return `${hours}h ${mins}m`
    if (hours > 0) return `${hours}h`
    return `${mins}m`
}
