import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ChevronDown, ChevronUp, LocateFixed, Map as MapIcon, MapPinOff, MoreVertical, Route as RouteIcon, SearchX, Star, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ApiFetch } from "@/lib/url-context"
import { getUserLocation } from "@/lib/userLocation"
import { formatDistance, haversineDistance } from "@/lib/utils"
import type { Stop } from "@/components/map/stops-map"
import { saveStop, useIsSaved } from "@/components/stops/favourites"
import { HomeHint, HomeSection } from "./home-section"
import { HomeStopRow, StopModeTile } from "./home-stop-row"

const SHOWN = 3
const SHOWN_EXPANDED = 6

type LocationState =
    | { status: "checking" }
    | { status: "ask" }
    | { status: "denied" }
    | { status: "locating" }
    | { status: "found"; lat: number; lon: number }
    | { status: "failed" }

/**
 * The rider's location for Nearby - without prompting on page load (as on
 * iOS, where the first launch explains and asks). Uses it straight away
 * when already allowed; otherwise waits for "Enable location".
 */
function useNearbyLocation() {
    const [state, setState] = useState<LocationState>({ status: "checking" })

    const locate = useCallback(() => {
        setState({ status: "locating" })
        getUserLocation()
            .then(([lat, lon]) => setState({ status: "found", lat, lon }))
            .catch((err: GeolocationPositionError) => {
                setState(err?.code === 1 ? { status: "denied" } : { status: "failed" })
            })
    }, [])

    useEffect(() => {
        if (!navigator.geolocation) return setState({ status: "failed" })
        if (!navigator.permissions) return setState({ status: "ask" })
        navigator.permissions.query({ name: "geolocation" }).then(
            (result) => {
                if (result.state === "granted") locate()
                else setState({ status: result.state === "denied" ? "denied" : "ask" })
            },
            () => setState({ status: "ask" })
        )
    }, [locate])

    return { state, locate }
}

/** The nearest stops, one per name - a station's platforms come back as separate stops. */
function distinctByName(stops: Stop[]) {
    const seen = new Set<string>()
    return stops.filter((stop) => {
        if (seen.has(stop.stop_name)) return false
        seen.add(stop.stop_name)
        return true
    })
}

function stopQueryOf(stop: Stop) {
    return `${stop.stop_name} ${stop.stop_code}`
}

/** Schedule's "Nearby" - the closest stops with their next departures (the iOS Home section). */
export function NearbySection({ className }: { className?: string }) {
    const { state, locate } = useNearbyLocation()
    const [stops, setStops] = useState<Stop[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [expanded, setExpanded] = useState(false)

    const lat = state.status === "found" ? state.lat : null
    const lon = state.status === "found" ? state.lon : null

    useEffect(() => {
        if (lat === null || lon === null) return
        let cancelled = false
        ApiFetch<Stop[]>(`stops/closest-stop?lat=${lat}&lon=${lon}`).then((res) => {
            if (cancelled) return
            if (res.ok) {
                setStops(distinctByName(res.data))
                setError(null)
            } else {
                setError(res.error)
            }
        })
        return () => { cancelled = true }
    }, [lat, lon])

    let content: React.ReactNode
    if (state.status === "ask") {
        content = (
            <HomeHint
                icon={LocateFixed}
                text="See live departures from the stops around you."
                action={<Button variant="outline" size="sm" className="h-8" onClick={locate}>Enable location</Button>}
            />
        )
    } else if (state.status === "denied") {
        content = <HomeHint icon={MapPinOff} text="Location is off for this site. Turn it on in your browser's settings to see stops near you." />
    } else if (state.status === "failed") {
        content = (
            <HomeHint
                icon={TriangleAlert}
                text="Couldn't find your location."
                action={<Button variant="outline" size="sm" className="h-8" onClick={locate}>Try again</Button>}
            />
        )
    } else if (error) {
        content = <HomeHint icon={TriangleAlert} text={error} />
    } else if (state.status !== "found" || stops === null) {
        content = <HomeHint icon={LocateFixed} text="Finding stops near you..." />
    } else if (stops.length === 0) {
        content = <HomeHint icon={SearchX} text="No stops found nearby." />
    } else {
        content = (
            <div className="flex flex-col gap-2.5">
                {stops.slice(0, expanded ? SHOWN_EXPANDED : SHOWN).map((stop) => (
                    <HomeStopRow
                        key={stop.stop_id}
                        stopQuery={stopQueryOf(stop)}
                        title={stop.stop_name}
                        detail={formatDistance(haversineDistance(state.lat, state.lon, stop.stop_lat, stop.stop_lon))}
                        href={`/?s=${encodeURIComponent(stopQueryOf(stop))}`}
                        tile={<StopModeTile stopType={stop.stop_type} />}
                        menu={<NearbyStopMenu stop={stop} />}
                    />
                ))}
                {stops.length > SHOWN && (
                    <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setExpanded(!expanded)}>
                        {expanded ? <><ChevronUp className="h-4 w-4" /> Show fewer</> : <><ChevronDown className="h-4 w-4" /> Show more nearby stops</>}
                    </Button>
                )}
            </div>
        )
    }

    return (
        <HomeSection
            title="Nearby"
            liveDot={state.status === "found"}
            className={className}
            actions={<Link href="/map" className="flex items-center gap-1"><MapIcon className="h-3.5 w-3.5" /> Map</Link>}
        >
            {content}
        </HomeSection>
    )
}

function NearbyStopMenu({ stop }: { stop: Stop }) {
    const query = stopQueryOf(stop)
    const saved = useIsSaved(query)
    const planHref = `/plan?${new URLSearchParams({
        endLat: String(stop.stop_lat),
        endLon: String(stop.stop_lon),
        endLabel: stop.stop_name,
        fromHere: "1",
    })}`

    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={`Options for ${stop.stop_name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                    <MoreVertical className="h-3.5 w-3.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {!saved && (
                    <DropdownMenuItem onSelect={() => saveStop(query, stop.stop_name)}>
                        <Star className="h-3.5 w-3.5" />
                        Save stop
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                    <Link href={planHref}>
                        <RouteIcon className="h-3.5 w-3.5" />
                        Plan a journey here
                    </Link>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
