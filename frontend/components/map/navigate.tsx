import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "../ui/alert"
import { ArrowRight, CheckCircle2, CornerDownRight, Flag, Footprints, MapPin, Navigation, TriangleAlert } from "lucide-react"
const LeafletMap = lazy(() => import('./map'));
import LoadingSpinner from "../loading-spinner"
import { Button } from "../ui/button"
import { GeoJSON } from "./geojson-types";
import { convertSecondsToTimeNoDecimal, formatDistance } from "@/lib/utils";
import { ApiFetch } from "@/lib/url-context";
import type { MapItem } from "./markers/create";
import { useNavigationTracker } from "@/lib/useNavigationTracker";

interface NavigateProps {
    start: { lat: number, lon: number, name: string },
    end: { lat: number, lon: number, name: string }
    liveMode?: boolean
}

function StepIcon({ step, className }: { step: DirectionStep, className?: string }) {
    const cls = className ?? "h-3.5 w-3.5"
    if (step.type === "depart") return <MapPin className={cls} />
    if (step.type === "arrive") return <Flag className={cls} />
    if (step.modifier?.includes("right")) return <CornerDownRight className={cls} />
    if (step.modifier?.includes("left")) return <CornerDownRight className={cls} style={{ transform: "scaleX(-1)" }} />
    return <ArrowRight className={cls} />
}

export default function Navigate({ start, end, liveMode = false }: NavigateProps) {
    const [data, setData] = useState<OSRMResponse | null>(null)
    const [activeStep, setActiveStep] = useState<number | null>(null)
    const stepRefs = useRef<(HTMLLIElement | null)[]>([])

    const {
        currentStepIndex,
        distanceToNextManeuver,
        isFollowing,
        setIsFollowing,
        handleLocationUpdate,
        arrived,
    } = useNavigationTracker(data?.steps)

    async function getPoints() {
        if (start.lat === 0 || start.lon === 0) return
        if (end.lat === 0 || end.lon === 0) return

        try {
            const response = await ApiFetch<OSRMResponse>(`map/nav?startLat=${start.lat}&startLon=${start.lon}&endLat=${end.lat}&endLon=${end.lon}&method=walking`, { method: "GET" });
            if (!response.ok) {
                openNavigation(end.lat, end.lon)
                return
            }

            setData({ ...response.data, travelTime: Math.floor(response.data.duration / 60) })
        } catch (e) {
            console.error(e)
            openNavigation(end.lat, end.lon)
        }
    }

    useEffect(() => {
        getPoints()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (liveMode && data?.steps) {
            stepRefs.current[currentStepIndex]?.scrollIntoView({
                behavior: "smooth",
                block: "center",
            })
        }
    }, [currentStepIndex, liveMode, data?.steps])

    if (start.lat === 0 || start.lon === 0) {
        return (
            <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Location unavailable</AlertTitle>
                <AlertDescription>
                    Enable location services to get walking directions.
                </AlertDescription>
            </Alert>
        )
    }

    const effectiveActiveStep = liveMode ? currentStepIndex : activeStep

    const mapMarkers: MapItem[] = [
        {
            lat: start.lat, lon: start.lon, icon: "start marker",
            id: "nav-start", routeID: "", zIndex: 100,
            visibleLabel: "Start",
            onClick: () => { }, type: "stop"
        },
        {
            lat: end.lat, lon: end.lon, icon: "end marker",
            id: "nav-end", routeID: "", zIndex: 100,
            visibleLabel: end.name,
            onClick: () => { }, type: "stop"
        },
    ]

    if (data?.steps) {
        data.steps.forEach((step, i) => {
            if (step.lat === 0 && step.lon === 0) return
            if (step.type === "depart" || step.type === "arrive") return
            const isPassed = liveMode && i < currentStepIndex
            mapMarkers.push({
                lat: step.lat, lon: step.lon,
                icon: isPassed ? "dot gray" : "dot",
                id: `step-${i}`, routeID: "", zIndex: 50,
                popup: { title: step.instruction },
                onClick: () => !liveMode && setActiveStep(i),
                type: "stop"
            })
        })
    }

    const currentStep = data?.steps?.[currentStepIndex]

    return (
        <div className="space-y-3">
            {/* Summary bar */}
            <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
                <div className="flex items-center justify-center h-9 w-9 rounded-full bg-primary/10 shrink-0">
                    <Footprints className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">Walk to {end.name}</p>
                    <p className="text-xs text-muted-foreground">
                        {convertSecondsToTimeNoDecimal(data?.duration || 0)} · {formatDistance(data?.distance || 0)}
                    </p>
                </div>
                <Button
                    variant="outline" size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() => openNavigation(end.lat, end.lon)}
                >
                    <Navigation className="h-3.5 w-3.5" />
                    Open in Maps
                </Button>
            </div>

            {/* Live mode: current step card */}
            {liveMode && data?.steps && currentStep && (
                <div className={`flex items-center gap-3 rounded-lg border p-4 shadow-sm ${arrived
                    ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                    : "bg-card"
                    }`}>
                    <div className={`flex items-center justify-center h-10 w-10 rounded-full shrink-0 ${arrived
                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                        : currentStep.type === "depart"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                            : "bg-primary/10 text-primary"
                        }`}>
                        {arrived ? (
                            <CheckCircle2 className="h-5 w-5" />
                        ) : (
                            <StepIcon step={currentStep} className="h-5 w-5" />
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-base font-semibold capitalize">
                            {arrived ? `You have arrived at ${end.name}` : currentStep.instruction}
                        </p>
                        {!arrived && distanceToNextManeuver > 0 && (
                            <p className="text-sm text-muted-foreground">
                                {formatDistance(distanceToNextManeuver)}
                            </p>
                        )}
                    </div>
                    {!arrived && (
                        <Button
                            variant={isFollowing ? "default" : "outline"}
                            size="icon"
                            className="shrink-0"
                            onClick={() => setIsFollowing(!isFollowing)}
                            aria-label={isFollowing ? "Stop following" : "Re-center on location"}
                        >
                            <Navigation className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            )}

            {/* Map */}
            {data && data.features?.length > 0 ? (
                <div className="rounded-xl overflow-hidden border">
                    <Suspense fallback={<LoadingSpinner height={liveMode ? "450px" : "350px"} description="Loading map..." />}>
                        <LeafletMap
                            defaultZoom={liveMode
                                ? ["user", [end.lat, end.lon]]
                                : [[start.lat, start.lon], [end.lat, end.lon]]
                            }
                            map_id={"nav-map"}
                            height={liveMode ? "450px" : "350px"}
                            line={{ GeoJson: data as unknown as GeoJSON, color: "" }}
                            mapItems={mapMarkers}
                            onLocationUpdate={liveMode ? handleLocationUpdate : undefined}
                            followUser={liveMode ? isFollowing : undefined}
                        />
                    </Suspense>
                </div>
            ) : (
                <LoadingSpinner height={liveMode ? "450px" : "350px"} description="Loading route..." />
            )}

            {/* Directions list */}
            {data?.steps && data.steps.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                    <div className="px-3 py-2 bg-muted/50 border-b">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Directions</p>
                    </div>
                    <ol className="divide-y">
                        {data.steps.map((step, index) => {
                            const isPassed = liveMode && index < currentStepIndex
                            const isCurrent = liveMode && index === currentStepIndex
                            const isActive = effectiveActiveStep === index

                            return (
                                <li
                                    key={index}
                                    ref={el => { stepRefs.current[index] = el }}
                                    className={`flex items-start gap-3 px-3 py-2.5 transition-colors cursor-pointer hover:bg-accent/50 ${isActive ? "bg-accent" : ""
                                        } ${isPassed ? "opacity-50" : ""
                                        } ${isCurrent ? "bg-primary/5 border-l-2 border-l-primary" : ""
                                        }`}
                                    onClick={() => !liveMode && setActiveStep(isActive ? null : index)}
                                >
                                    <div className={`flex items-center justify-center h-7 w-7 rounded-full shrink-0 mt-0.5 ${step.type === "depart"
                                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                        : step.type === "arrive"
                                            ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                            : isPassed
                                                ? "bg-muted/50 text-muted-foreground/50"
                                                : "bg-muted text-muted-foreground"
                                        }`}>
                                        <StepIcon step={step} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium capitalize">{step.instruction}</p>
                                        {step.distance > 0 && step.type !== "arrive" && (
                                            <p className="text-xs text-muted-foreground mt-0.5">{formatDistance(step.distance)}</p>
                                        )}
                                    </div>
                                </li>
                            )
                        })}
                    </ol>
                </div>
            )}

            <p className="text-[11px] text-muted-foreground text-center px-4">
                Directions may not be 100% accurate or safe. Always take care when around roads and in unfamiliar places.
            </p>
        </div>
    )
}

export function openNavigation(lat: number, lon: number) {
    if (
        (navigator.platform.indexOf("iPhone") !== -1) ||
        (navigator.platform.indexOf("iPad") !== -1) ||
        (navigator.platform.indexOf("iPod") !== -1)
    ) {
        window.open(`http://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`, '_blank');
    } else {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`, '_blank');
    }
}

export interface DirectionStep {
    instruction: string
    modifier: string
    type: string
    name: string
    distance: number
    lat: number
    lon: number
}

export interface OSRMResponse {
    type: string;
    features: Feature[];
    instructions: string;
    steps: DirectionStep[];
    duration: number;
    travelTime: number;
    distance: number;
}

export interface Feature {
    type: string;
    geometry: Geometry;
    properties: null;
}

export interface Geometry {
    type: string;
    coordinates: Array<number[]>;
}
