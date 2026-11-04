import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/router"
import { ListFilter, MapPin, Search, X } from "lucide-react"
import LoadingSpinner from "@/components/loading-spinner"
import ErrorScreen from "@/components/ui/error-screen"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { MapItem } from "@/components/map/markers/create"
import type { Stop } from "@/components/map/stops-map"
import { MapModeSwitch, type MapMode } from "@/components/map/mode-switch"
import { MapTopBar } from "@/components/map/floating-controls"
import { Header, MobileSettingsLink } from "@/components/nav"
import { MAP_SIDE_PANEL_OCCUPIED_WIDTH } from "@/components/map/map-side-panel"
import { HomeStopRow, StopModeTile } from "@/components/home/home-stop-row"
import { StopBoardPage, StopBoardPanel } from "@/components/stops/stop-board"
import type { ServiceTrackerTarget } from "@/components/services"
import type { VehiclesResponse } from "@/components/services/tracker"
import ServiceTrackerView from "@/components/services/tracker/panel"
import { useRouteLine, useServiceTracker } from "@/components/services/tracker/use-service-tracker"
import { RouteMultiSelect, type RouteOption } from "@/components/journey/route-filter"
import { ApiError, ApiFetch, useUrl } from "@/lib/url-context"
import { hasRealtime } from "@/lib/url-store"
import { useUserLocation } from "@/lib/userLocation"
import { haversineDistance, useIsMobile } from "@/lib/utils"
import { useUrlOverlay } from "@/lib/url-overlay"

const MapComp = dynamic(() => import("../components/map/map"), { ssr: false })

type ModeFilter = "all" | "bus" | "train" | "ferry"

const MODE_FILTERS: { value: ModeFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "bus", label: "Bus" },
    { value: "train", label: "Train" },
    { value: "ferry", label: "Ferry" },
]

const VEHICLE_REFRESH_MS = 10_000
/** "Stops" on the vehicles map shows only the nearest ones - the whole network is too many markers. */
const VEHICLES_MODE_STOP_LIMIT = 300

/**
 * The Map tab - the iOS app's Map tab: one full-bleed map with a Stops /
 * Vehicles switch and filter pills floating on it. Replaces /stops and
 * /vehicles (which redirect here, keeping ?tripId=).
 *
 * URL: `mode` (stops | vehicles), `s` (the stop whose board is open, stops
 * mode), `tripId` (the tracked vehicle, vehicles mode).
 */
export default function MapPage() {
    const router = useRouter()
    const { currentUrl } = useUrl()
    // No vehicles to show without realtime - a vehicles link lands on stops.
    const mode: MapMode = router.query.mode === "vehicles" && hasRealtime(currentUrl) ? "vehicles" : "stops"

    return (
        <>
            <Header title={mode === "vehicles" ? "Vehicle tracker" : "Stops map"} />
            {/* Full bleed: cancels the header's bottom margin and fills the
                screen down to the tab bar. */}
            <div className="map-page relative -mt-[var(--header-mb)] h-[calc(100svh-var(--header-h)-var(--tabbar-h))] overflow-hidden">
                {router.isReady && (mode === "vehicles" ? <VehiclesMode /> : <StopsMode />)}
            </div>
        </>
    )
}

// ---------------------------------------------------------------------------
// shared

function stopQueryOf(stop: Stop) {
    return `${stop.stop_name} ${stop.stop_code}`
}

function stopIcon(stop: Stop): MapItem["icon"] {
    switch (stop.stop_type) {
        case "bus": return "bus stop marker"
        case "ferry": return "ferry stop marker"
        case "train": return "train stop marker"
        default: return "dot"
    }
}

/**
 * Mode (and, for vehicles, route search and "show stops") in one menu on a
 * round button - the iOS map's filter (2026-11-03), replacing a row of
 * pills that ran off the screen.
 */
function FilterMenu({ value, onChange, noun, active, children }: {
    value: ModeFilter
    onChange: (value: ModeFilter) => void
    noun: "stops" | "vehicles"
    active?: boolean
    children?: React.ReactNode
}) {
    const highlighted = active || value !== "all"
    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={`Filter ${noun}`}
                    className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-full border border-border shadow-sm backdrop-blur-md transition-colors",
                        highlighted ? "bg-primary text-primary-foreground" : "bg-background/90 text-foreground hover:bg-accent",
                    )}
                >
                    <ListFilter className="h-[18px] w-[18px]" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as ModeFilter)}>
                    {MODE_FILTERS.map((filter) => (
                        <DropdownMenuRadioItem key={filter.value} value={filter.value}>
                            {filter.value === "all" ? `All ${noun}` : noun === "stops" ? `${filter.label} stops` : filter.value === "bus" ? "Buses" : filter.value === "ferry" ? "Ferries" : "Trains"}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
                {children}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

// ---------------------------------------------------------------------------
// stops

function StopsMode() {
    const isMobile = useIsMobile({ immediate: true })
    const { currentUrl } = useUrl()
    const [filter, setFilter] = useState<ModeFilter>("all")
    const [stops, setStops] = useState<Stop[]>([])
    const [error, setError] = useState<ApiError | null>(null)
    /** Phone: the tapped stop, previewed in a card over the map. */
    const [preview, setPreview] = useState<Stop | null>(null)
    /** Desktop: the departure opened from the side panel's board. */
    const [openService, setOpenService] = useState<ServiceTrackerTarget | null>(null)
    const board = useUrlOverlay("s")

    useEffect(() => {
        let cancelled = false
        ApiFetch<Stop[]>(`stops?children=false&stop_type=${filter}`).then((res) => {
            if (cancelled) return
            if (res.ok) {
                setStops(res.data)
                setError(null)
            } else {
                setError(res)
            }
        })
        return () => { cancelled = true }
    }, [filter])

    // A different board (or none) closes the service opened from the last one.
    useEffect(() => setOpenService(null), [board.value])
    useEffect(() => setPreview(null), [filter, isMobile])

    const stopsByQuery = useMemo(() => new Map(stops.map((stop) => [stopQueryOf(stop), stop])), [stops])

    const mapItems = useMemo(
        () => stops.map((stop): MapItem => ({
            lat: stop.stop_lat,
            lon: stop.stop_lon,
            icon: stopIcon(stop),
            id: stopQueryOf(stop),
            routeID: "",
            zIndex: 1,
            type: "stop",
            onClick: (id) => {
                const tapped = stopsByQuery.get(id)
                if (!tapped) return
                if (isMobile) setPreview(tapped)
                else board.open(id)
            },
        })),
        // `board.open` is recreated each render but only reads the router.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [stops, stopsByQuery, isMobile]
    )

    const boardTitle = stopsByQuery.get(board.value)?.stop_name ?? board.value
    const panelOpen = !isMobile && board.value !== ""

    // Phone: a board takes over the tab (the map stays mounted underneath,
    // so coming back doesn't rebuild it).
    const showsBoardPage = isMobile && board.value !== ""

    return (
        <>
            {showsBoardPage && (
                <div className="absolute inset-0 z-30 overflow-y-auto bg-background pt-3">
                    <StopBoardPage stopQuery={board.value} title={boardTitle} backLabel="Map" onClose={board.close} />
                </div>
            )}

            {error && (
                <div className="absolute inset-0 z-[5] flex items-center justify-center bg-background">
                    <ErrorScreen errorTitle="Failed to load stops" errorText={error.error} traceId={error.trace_id} />
                </div>
            )}
            <Suspense fallback={<LoadingSpinner description="Loading map..." height="100%" />}>
                <MapComp
                    map_id="map-tab-stops"
                    height="100%"
                    square
                    hideZoomControls={isMobile}
                    options={{ buttonPosition: "bottom" }}
                    defaultZoom={["user", currentUrl.defaultMapCenter]}
                    mapItems={mapItems}
                    padding={{ left: panelOpen ? MAP_SIDE_PANEL_OCCUPIED_WIDTH : 0 }}
                />
            </Suspense>

            <MapTopBar switcher={<MapModeSwitch mode="stops" />} insetLeft={panelOpen ? MAP_SIDE_PANEL_OCCUPIED_WIDTH : 0}>
                <FilterMenu value={filter} onChange={setFilter} noun="stops" />
                <MobileSettingsLink />
            </MapTopBar>

            {preview && (
                <StopPreviewOverlay stop={preview} onOpen={() => { board.open(stopQueryOf(preview)); setPreview(null) }} onClose={() => setPreview(null)} />
            )}

            {panelOpen && (openService ? (
                <ServiceTrackerView
                    key={openService.tripId}
                    variant="panel"
                    backLabel={boardTitle}
                    {...openService}
                    onClose={() => setOpenService(null)}
                />
            ) : (
                <StopBoardPanel
                    key={board.value}
                    stopQuery={board.value}
                    title={boardTitle}
                    onClose={board.close}
                    onOpenService={setOpenService}
                />
            ))}
        </>
    )
}

/**
 * Phone: the tapped stop with its next departures, above the map's bottom
 * edge (and the resume card, when there is one). Tap it for the board.
 * While it shows, the map's corner buttons move up above it.
 */
function StopPreviewOverlay({ stop, onOpen, onClose }: { stop: Stop; onOpen: () => void; onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = ref.current
        const page = el?.closest<HTMLElement>(".map-page")
        if (!el || !page) return
        const observer = new ResizeObserver(() => page.style.setProperty("--map-card-h", `${el.offsetHeight + 12}px`))
        observer.observe(el)
        return () => {
            observer.disconnect()
            page.style.removeProperty("--map-card-h")
        }
    }, [])

    const query = stopQueryOf(stop)
    return (
        <div
            ref={ref}
            className="absolute inset-x-3 bottom-[calc(var(--resume-h,0px)+0.75rem)] z-20 animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
            <div className="relative rounded-2xl shadow-xl" onClickCapture={(e) => {
                // The card is a link to the board - open it in this tab instead.
                if ((e.target as HTMLElement).closest("[data-close]")) return
                e.preventDefault()
                onOpen()
            }}>
                {/* A Home-style board: the next three departures (iOS, 2026-11-03). */}
                <HomeStopRow
                    stopQuery={query}
                    title={stop.stop_name}
                    href={`/map?mode=stops&s=${encodeURIComponent(query)}`}
                    tile={<StopModeTile stopType={stop.stop_type} />}
                    lines={3}
                    menu={
                        <button
                            type="button"
                            data-close
                            onClick={onClose}
                            aria-label="Close"
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    }
                />
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// vehicles

type VehicleTypeFilter = "all" | "Bus" | "Train" | "Ferry"

const VEHICLE_TYPE: Record<ModeFilter, VehicleTypeFilter> = { all: "all", bus: "Bus", train: "Train", ferry: "Ferry" }

function VehiclesMode() {
    const isMobile = useIsMobile({ immediate: true })
    const { currentUrl } = useUrl()
    const { location, locationFound } = useUserLocation()
    const [filter, setFilter] = useState<ModeFilter>("all")
    const [vehicles, setVehicles] = useState<VehiclesResponse[]>([])
    const [error, setError] = useState<ApiError | null>(null)
    const [showStops, setShowStops] = useState(false)
    const [allStops, setAllStops] = useState<Stop[]>([])
    const [routes, setRoutes] = useState<RouteOption[]>([])
    const [pickingRoutes, setPickingRoutes] = useState(false)
    const tracked = useUrlOverlay("tripId")
    const selectedTrip = tracked.value

    // Live positions every 10s - paused while a vehicle is open, as on iOS
    // (its own tracker polls it).
    useEffect(() => {
        let cancelled = false
        async function load() {
            const res = await ApiFetch<VehiclesResponse[]>(`realtime/live?type=${VEHICLE_TYPE[filter]}`)
            if (cancelled) return
            if (res.ok) {
                setVehicles(res.data)
                setError(null)
            } else {
                setError(res)
            }
        }
        load()
        if (selectedTrip !== "") return () => { cancelled = true }
        const id = setInterval(load, VEHICLE_REFRESH_MS)
        return () => {
            cancelled = true
            clearInterval(id)
        }
    }, [filter, selectedTrip])

    // Trains AT is running without a trip in its feed can't go on the map -
    // when there are several, say so rather than look like they're missing.

    useEffect(() => {
        if (!showStops || allStops.length > 0) return
        ApiFetch<Stop[]>("stops?children=false").then((res) => { if (res.ok) setAllStops(res.data) })
    }, [showStops, allStops.length])

    // The tracked trip, fetched on its own so its stops are always populated.
    const { vehicle: trackedVehicle, stops: tripStops } = useServiceTracker(selectedTrip, true, selectedTrip !== "")
    const routeLine = useRouteLine(selectedTrip, trackedVehicle?.route.id)

    const shownVehicles = useMemo(() => {
        const running = vehicles.filter((v) => v.route.id !== "")
        if (routes.length === 0) return running
        const ids = new Set(routes.map((r) => r.route_id))
        const names = new Set(routes.map((r) => r.name.toLowerCase()))
        return running.filter((v) => ids.has(v.route.id) || names.has(v.route.name.toLowerCase()))
    }, [vehicles, routes])

    const nearbyStops = useMemo(() => {
        if (!showStops) return []
        const [lat, lon] = locationFound ? location : currentUrl.defaultMapCenter
        return allStops
            .map((stop) => ({ stop, distance: haversineDistance(lat, lon, stop.stop_lat, stop.stop_lon) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, VEHICLES_MODE_STOP_LIMIT)
            .map(({ stop }) => stop)
    }, [showStops, allStops, locationFound, location, currentUrl.defaultMapCenter])

    const mapItems = useMemo((): MapItem[] => {
        const focused = selectedTrip !== ""
        const vehicleItems = shownVehicles.map((vehicle): MapItem => {
            const isSelected = selectedTrip === vehicle.trip_id
            return {
                lat: vehicle.position.lat,
                lon: vehicle.position.lon,
                icon: vehicle.type as MapItem["icon"],
                bearing: vehicle.position.bearing,
                opacity: focused && !isSelected ? 0.35 : 1,
                id: vehicle.trip_id,
                routeID: vehicle.route.id,
                color: vehicle.route.color,
                visibleLabel: `${vehicle.route.name}${vehicle.type ? " · " + vehicle.type : ""}${vehicle.license_plate ? " · " + vehicle.license_plate : ""}`,
                zIndex: isSelected ? 10 : 1,
                type: "vehicle",
                onClick: (id) => tracked.open(id),
            }
        })
        const stopItems = nearbyStops.map((stop): MapItem => ({
            lat: stop.stop_lat,
            lon: stop.stop_lon,
            icon: stopIcon(stop),
            id: stopQueryOf(stop),
            routeID: "",
            zIndex: 1,
            type: "stop",
            onClick: () => { },
            popup: { title: stopQueryOf(stop), linkText: "View departures", linkHref: `/map?mode=stops&s=${encodeURIComponent(stopQueryOf(stop))}` },
        }))
        const tripItems = trackedVehicle && tripStops ? tripStops.map((stop): MapItem => {
            const trip = trackedVehicle.trip
            const icon: MapItem["icon"] =
                trip.final_stop.parent_stop_id === stop.parent_stop_id || trip.final_stop.child_stop_id === stop.child_stop_id
                    ? "end marker"
                    : trip.next_stop.parent_stop_id === stop.parent_stop_id || trip.next_stop.child_stop_id === stop.child_stop_id
                        ? "next stop marker"
                        : trip.current_stop.parent_stop_id === stop.parent_stop_id || trip.current_stop.child_stop_id === stop.child_stop_id
                            ? "current stop marker"
                            : trip.first_stop.parent_stop_id === stop.parent_stop_id
                                ? "start marker"
                                : trip.current_stop.sequence > stop.sequence ? "dot gray" : "dot"
            return {
                lat: stop.lat,
                lon: stop.lon,
                icon,
                id: "trip-stop-" + stop.name + stop.sequence,
                routeID: "",
                zIndex: 1,
                type: "stop",
                onClick: () => { },
                popup: {
                    title: `${stop.name}${stop.platform ? ` | Platform ${stop.platform}` : ""}`,
                    linkText: "View departures",
                    linkHref: `/map?mode=stops&s=${encodeURIComponent(stop.name)}`,
                },
            }
        }) : []
        return [...vehicleItems, ...stopItems, ...tripItems]
        // `tracked.open` is recreated each render but only reads the router.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shownVehicles, nearbyStops, trackedVehicle, tripStops, selectedTrip])

    const panelOpen = !isMobile && selectedTrip !== ""

    const routesLabel = routes.length === 0
        ? "Route"
        : routes.length <= 3 ? routes.map((r) => r.name).join(", ") : `${routes.length} routes`

    return (
        <>
            {error && (
                <div className="absolute inset-0 z-[5] flex items-center justify-center bg-background">
                    <ErrorScreen errorTitle="Failed to load vehicles" errorText={error.error} traceId={error.trace_id} />
                </div>
            )}
            <Suspense fallback={<LoadingSpinner description="Loading vehicles..." height="100%" />}>
                <MapComp
                    map_id="map-tab-vehicles"
                    height="100%"
                    square
                    hideZoomControls={isMobile}
                    options={{ buttonPosition: "bottom" }}
                    defaultZoom={["user", currentUrl.defaultMapCenter]}
                    followMarkerId={selectedTrip || undefined}
                    clusterOptions={{ threshold: 50 }}
                    line={routeLine ? { GeoJson: routeLine.line, color: routeLine.color } : undefined}
                    mapItems={mapItems}
                    padding={{ left: panelOpen ? MAP_SIDE_PANEL_OCCUPIED_WIDTH : 0 }}
                />
            </Suspense>

            {/* On a phone the tracker takes over the map, as on iOS - no
                switch or filters floating over it. */}
            {!(isMobile && selectedTrip !== "") && (
                <MapTopBar
                    switcher={<MapModeSwitch mode="vehicles" />}
                    insetLeft={panelOpen ? MAP_SIDE_PANEL_OCCUPIED_WIDTH : 0}
                    below={routes.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setRoutes([])}
                            aria-label={`Showing routes ${routesLabel}. Clear`}
                            className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm"
                        >
                            Routes: {routesLabel}
                            <X className="h-3 w-3" />
                        </button>
                    )}
                >
                    <FilterMenu value={filter} onChange={setFilter} noun="vehicles" active={routes.length > 0 || showStops}>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setPickingRoutes(true)}>
                            <Search className="h-4 w-4" />
                            {routes.length === 0 ? "Find a route…" : `Routes: ${routesLabel}`}
                        </DropdownMenuItem>
                        {routes.length > 0 && (
                            <DropdownMenuItem onSelect={() => setRoutes([])}>
                                <X className="h-4 w-4" /> Show all routes
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuCheckboxItem checked={showStops} onCheckedChange={(v) => setShowStops(!!v)}>
                            <MapPin className="h-4 w-4" /> Show stops
                        </DropdownMenuCheckboxItem>
                    </FilterMenu>
                    <MobileSettingsLink />
                </MapTopBar>
            )}

            <Dialog open={pickingRoutes} onOpenChange={setPickingRoutes}>
                <DialogContent className="max-w-sm">
                    <DialogHeader><DialogTitle>Show routes</DialogTitle></DialogHeader>
                    <RouteMultiSelect label="" placeholder="Search routes, e.g. 70" selected={routes} onChange={setRoutes} />
                </DialogContent>
            </Dialog>

            {routes.length > 0 && shownVehicles.length === 0 && vehicles.length > 0 && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
                    <p className="rounded-full border border-border bg-popover px-4 py-2.5 text-sm text-muted-foreground shadow-md">
                        None of these routes are running right now
                    </p>
                </div>
            )}

            {selectedTrip !== "" && (
                <ServiceTrackerView
                    key={selectedTrip}
                    variant={isMobile ? "sheet" : "panel"}
                    // Phone: the tracker's own full-screen map, just this
                    // vehicle and its stops (as on iOS). Desktop: the page's map.
                    hasOwnMap={isMobile}
                    has={true}
                    tripId={selectedTrip}
                    onClose={tracked.close}
                />
            )}
        </>
    )
}
