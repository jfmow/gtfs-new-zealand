'use client'

import React from "react"

import { MapItem } from "@/components/map/markers/create";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiFetch, useUrl } from "@/lib/url-context";
import { useIsMobile } from "@/lib/utils";
import { Header } from "@/components/nav";
import { Accessibility, AlertTriangle, ArrowRight, Clock, Footprints } from "lucide-react";
import dynamic from "next/dynamic";
import { Suspense, useState, useRef, useEffect } from "react";
import type { GeoJSON } from "@/components/map/geojson-types"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { format } from "date-fns"
import { ChevronDownIcon } from "lucide-react"
import { LocationSearchInput } from "@/components/map/search";

const LeafletMap = dynamic(() => import("@/components/map/map"), {
    ssr: false,
});

interface Location {
    lat: number;
    lon: number;
    label: string;
}

export default function PlanJourney() {
    const [startLocation, setStartLocation] = useState<Location | null>(null);
    const [endLocation, setEndLocation] = useState<Location | null>(null);
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [maxWalkKm, setMaxWalkKm] = useState<string>("1");
    const [walkSpeed, setWalkSpeed] = useState<string>("4.8");
    const [maxTransfers, setMaxTransfers] = useState<string>("5");
    const [apiResponse, setApiResponse] = useState<JourneyType[]>([]);
    const [selectedRoute, setSelectedRoute] = useState<JourneyType | undefined>();
    const [isSearching, setIsSearching] = useState(false);
    const [locationMode, setLocationMode] = useState<'start' | 'end'>('start');
    const [isSelectingOnMap, setIsSelectingOnMap] = useState(false);
    const [isRouteMapOpen, setIsRouteMapOpen] = useState(false);
    const [isLocating, setIsLocating] = useState<null | 'start' | 'end'>(null);
    const [locationError, setLocationError] = useState<string | null>(null);
    const isMobile = useIsMobile();
    const { currentUrl } = useUrl()

    const [timeType, setTimeType] = useState<"now" | "leaveat" | "arriveat">("now");

    // Handle map clicks to set start/end locations
    const locationModeRef = useRef<'start' | 'end'>('start');
    useEffect(() => {
        locationModeRef.current = locationMode;
    }, [locationMode]);

    useEffect(() => {
        if (timeType === "now") {
            setSelectedDate(new Date());
        }
    }, [timeType]);

    const handleMapClick = (lat: number, lon: number) => {
        if (locationModeRef.current === 'start') {
            setStartLocation({ lat, lon, label: "Start Point" });
        } else {
            setEndLocation({ lat, lon, label: "End Point" });
        }
        setIsSelectingOnMap(false);
    };

    const handleSelectFromMap = (mode: 'start' | 'end') => {
        setLocationMode(mode);
        setIsSelectingOnMap(true);
    };

    const handleUseCurrentLocation = (mode: 'start' | 'end') => {
        setLocationError(null);
        if (!navigator?.geolocation) {
            setLocationError("Current location is unavailable in this browser.");
            return;
        }
        setIsLocating(mode);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const location = {
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    label: "Current location",
                };
                if (mode === 'start') {
                    setStartLocation(location);
                } else {
                    setEndLocation(location);
                }
                setIsLocating(null);
            },
            () => {
                setLocationError("Unable to access your current location.");
                setIsLocating(null);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    // Plan the journey
    const planJourney = async () => {
        if (!startLocation || !endLocation) return;

        setIsSearching(true);
        setApiResponse([])
        try {
            // Simulate API call - replace with your actual API endpoint
            const response = await ApiFetch<JourneyType[]>(
                `/services/plan?startLat=${startLocation.lat}&startLon=${startLocation.lon}&endLat=${endLocation.lat}&endLon=${endLocation.lon}&date=${selectedDate.toISOString()}&timeType=${timeType}&maxWalkKm=${maxWalkKm}&walkSpeed=${walkSpeed}&maxTransfers=${maxTransfers}`
            );

            if (response.ok) {
                setApiResponse(response.data);
            }
        } catch (error) {
            console.error("Error planning journey:", error);
        } finally {
            setIsSearching(false);
        }
    };

    // Map markers for start and end points
    const mapMarkers: MapItem[] = [];

    if (startLocation) {
        mapMarkers.push({
            lat: startLocation.lat,
            lon: startLocation.lon,
            icon: "marked stop marker",
            id: "start",
            routeID: "",
            zIndex: 200,
            onClick: () => { },
            description: {
                text: `<strong>Start Point</strong>`,
                alwaysShow: true
            },
            type: "stop" as const
        });
    }

    if (endLocation) {
        mapMarkers.push({
            lat: endLocation.lat,
            lon: endLocation.lon,
            icon: "end marker",
            id: "end",
            routeID: "",
            zIndex: 200,
            onClick: () => { },
            description: {
                text: `<strong>End Point</strong>`,
                alwaysShow: true
            },
            type: "stop" as const
        });
    }

    // Add route markers if a route is selected
    if (selectedRoute) {
        selectedRoute.Legs.forEach((leg, index) => {
            if (leg.FromStop) {
                mapMarkers.push({
                    lat: leg.FromStop.stop_lat,
                    lon: leg.FromStop.stop_lon,
                    icon: "next stop marker",
                    id: leg.FromStop.stop_id + "-" + index,
                    routeID: leg.RouteID,
                    zIndex: 100,
                    onClick: () => { },
                    description: {
                        text: `<strong>${leg.FromStop?.stop_name}</strong><br/>${leg.Mode === 'transit' ? `${leg.Route?.route_short_name} - ${formatTime(leg.DepartureTime)}` : 'Walking'}`,
                        alwaysShow: false
                    },
                    type: "stop" as const
                });
            }
            if (leg.ToStop) {
                mapMarkers.push({
                    lat: leg.ToStop.stop_lat,
                    lon: leg.ToStop.stop_lon,
                    icon: "next stop marker",
                    id: leg.ToStop.stop_id + "-" + index,
                    routeID: leg.RouteID,
                    zIndex: 100,
                    onClick: () => { },
                    description: {
                        text: `<strong>${leg.ToStop?.stop_name}</strong><br/>${leg.Mode === 'transit' ? `${leg.Route?.route_short_name} - ${formatTime(leg.ArrivalTime)}` : 'Walking'}`,
                        alwaysShow: false
                    },
                    type: "stop" as const
                });
            }
        });
    }

    return (
        <>
            <Header title="Train, Bus, Ferry - Find your next journey" />
            <div className="mx-auto w-full max-w-4xl px-4 py-6 md:py-8">
                <Card className="">
                    <CardHeader>
                        <CardTitle>Journey Options</CardTitle>
                        <CardDescription>Plan a trip that works for you.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <div className="grid gap-3 md:grid-cols-[200px_1fr] md:items-end">
                                <div className="space-y-2">
                                    <Label htmlFor="timeType">Trip time</Label>
                                    <Select value={timeType} onValueChange={(value) => setTimeType(value as "now" | "leaveat" | "arriveat")}>
                                        <SelectTrigger id="timeType">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="now">Now</SelectItem>
                                            <SelectItem value="leaveat">Leave at</SelectItem>
                                            <SelectItem value="arriveat">Arrive at</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                {timeType !== "now" && (
                                    <DatePicker
                                        date={selectedDate}
                                        onDateChange={setSelectedDate}
                                    />
                                )}
                            </div>
                            {timeType === "now" && (
                                <p className="text-xs text-muted-foreground">
                                    Using your current time for routing.
                                </p>
                            )}
                        </div>

                        <LocationSearchInput
                            placeholder="Search start location..."
                            value={startLocation}
                            onSelect={setStartLocation}
                            storageKey="recentStartLocations"
                            onSelectFromMap={() => handleSelectFromMap('start')}
                            onUseCurrentLocation={() => handleUseCurrentLocation('start')}
                            isLocating={isLocating === 'start'}
                        />

                        <LocationSearchInput
                            placeholder="Search end location..."
                            value={endLocation}
                            onSelect={setEndLocation}
                            storageKey="recentEndLocations"
                            onSelectFromMap={() => handleSelectFromMap('end')}
                            onUseCurrentLocation={() => handleUseCurrentLocation('end')}
                            isLocating={isLocating === 'end'}
                        />


                        {locationError && (
                            <p className="text-sm text-destructive" role="alert">
                                {locationError}
                            </p>
                        )}

                        <details className="group">
                            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground transition-colors list-none flex items-center gap-2">
                                <svg
                                    className="h-4 w-4 transition-transform group-open:rotate-90"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                Advanced options
                            </summary>
                            <div className="mt-4 grid gap-4 sm:grid-cols-3 pt-2">
                                <div className="space-y-2">
                                    <Label htmlFor="maxWalk" className="text-xs">Max Walk</Label>
                                    <Select value={maxWalkKm} onValueChange={setMaxWalkKm}>
                                        <SelectTrigger id="maxWalk" className="h-9">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="0.5">0.5 km</SelectItem>
                                            <SelectItem value="1">1 km</SelectItem>
                                            <SelectItem value="2">2 km</SelectItem>
                                            <SelectItem value="5">5 km</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="walkSpeed" className="text-xs">Walk Speed</Label>
                                    <Select value={walkSpeed} onValueChange={setWalkSpeed}>
                                        <SelectTrigger id="walkSpeed" className="h-9">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="3">Slow</SelectItem>
                                            <SelectItem value="4.8">Average</SelectItem>
                                            <SelectItem value="5.5">Brisk</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="maxTransfers" className="text-xs">Transfers</Label>
                                    <Select value={maxTransfers} onValueChange={setMaxTransfers}>
                                        <SelectTrigger id="maxTransfers" className="h-9">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="0">Direct</SelectItem>
                                            <SelectItem value="1">1</SelectItem>
                                            <SelectItem value="2">2</SelectItem>
                                            <SelectItem value="5">5+</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </details>

                        <Button
                            className="w-full"
                            onClick={planJourney}
                            disabled={!startLocation || !endLocation || isSearching}
                        >
                            {isSearching ? "Searching..." : "Search Routes"}
                        </Button>
                    </CardContent>
                </Card>

                {/* Route Results */}
                {apiResponse.length > 0 && (
                    <div className="mt-6 space-y-3">
                        <h2 className="text-lg font-semibold px-1">Available Routes</h2>
                        <div className="space-y-3">
                            {apiResponse.map((route, index) => {
                                //const realtimeSummary = getRouteSummaryRealtime(route);
                                const hasDisruption = route.Legs.some(l => l.Mode === 'transit' && l.trip_usable === false);
                                return (
                                    <button
                                        key={index}
                                        type="button"
                                        className="w-full text-left rounded-lg border bg-card text-card-foreground shadow-sm hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring overflow-hidden"
                                        onClick={() => {
                                            setSelectedRoute(route);
                                            setIsRouteMapOpen(true);
                                        }}
                                    >
                                        {hasDisruption && (
                                            <div className="flex items-center gap-2 bg-destructive/10 px-4 py-1.5 text-xs font-medium text-destructive">
                                                <AlertTriangle size={12} />
                                                Service disruption on this route
                                            </div>
                                        )}
                                        <div className="flex w-full flex-col gap-3 p-4">
                                            {/* Top row: duration + times + transfer badge */}
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-base font-semibold">{formatDuration(route.TotalDuration)}</span>
                                                    <span className="text-sm text-muted-foreground">
                                                        {formatTimeWithRealtime(route.DepartureTime, getFirstTransitLeg(route)?.scheduled_departure_time, getFirstTransitLeg(route)?.realtime_status)}
                                                        <ArrowRight size={12} className="inline mx-1" />
                                                        {formatTimeWithRealtime(route.ArrivalTime, getLastTransitLeg(route)?.scheduled_arrival_time, getLastTransitLeg(route)?.realtime_status)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Badge variant={route.Transfers === 0 ? 'default' : 'secondary'} className="text-xs">
                                                        {route.Transfers === 0 ? 'Direct' : `${route.Transfers} transfer${route.Transfers !== 1 ? 's' : ''}`}
                                                    </Badge>
                                                </div>
                                            </div>
                                            {/* Leg strip */}
                                            <div className="flex items-center flex-wrap gap-y-1 gap-x-0.5">
                                                {getRouteStepsJSX(route)}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {isMobile ? (
                <Sheet open={isRouteMapOpen} onOpenChange={setIsRouteMapOpen}>
                    <SheetContent side="bottom" className="max-h-[85vh] overflow-hidden">
                        <SheetHeader>
                            <SheetTitle>Route Details</SheetTitle>
                            <SheetDescription>Review the selected journey on the map or in a list.</SheetDescription>
                        </SheetHeader>
                        <Tabs defaultValue="details" className="mt-4">
                            <TabsList className="w-full">
                                <TabsTrigger value="map" className="flex-1">Map</TabsTrigger>
                                <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
                            </TabsList>
                            <TabsContent value="map">
                                {selectedRoute && (
                                    <div className="h-[60vh] overflow-hidden rounded-md border">
                                        <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                                            <LeafletMap
                                                defaultZoom={[[selectedRoute.StartLat, selectedRoute.StartLon], [selectedRoute.EndLat, selectedRoute.EndLon]]}
                                                mapItems={mapMarkers}
                                                map_id="journey-planner-route-map"
                                                height="100%"
                                                line={selectedRoute ? { GeoJson: selectedRoute.RouteGeoJSON, color: "" } : undefined}
                                            />
                                        </Suspense>
                                    </div>
                                )}
                            </TabsContent>
                            <TabsContent value="details">
                                {selectedRoute && (
                                    <div className="max-h-[60vh] overflow-y-auto p-2">
                                        <RouteDetailsContent route={selectedRoute} />
                                    </div>
                                )}
                            </TabsContent>
                        </Tabs>
                    </SheetContent>
                </Sheet>
            ) : (
                <Dialog open={isRouteMapOpen} onOpenChange={setIsRouteMapOpen}>
                    <DialogContent className="max-w-5xl">
                        <DialogHeader>
                            <DialogTitle>Route Details</DialogTitle>
                            <DialogDescription>Review the selected journey on the map or in a list.</DialogDescription>
                        </DialogHeader>
                        <Tabs defaultValue="details" className="mt-4">
                            <TabsList className="w-full">
                                <TabsTrigger value="map" className="flex-1">Map</TabsTrigger>
                                <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
                            </TabsList>
                            <TabsContent value="map">
                                {selectedRoute && (
                                    <div className="h-[60vh] overflow-hidden rounded-md border">
                                        <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                                            <LeafletMap
                                                defaultZoom={[[selectedRoute.StartLat, selectedRoute.StartLon], [selectedRoute.EndLat, selectedRoute.EndLon]]}
                                                mapItems={mapMarkers}
                                                map_id="journey-planner-route-map"
                                                height="100%"
                                                line={selectedRoute ? { GeoJson: selectedRoute.RouteGeoJSON, color: "" } : undefined}
                                            />
                                        </Suspense>
                                    </div>
                                )}
                            </TabsContent>
                            <TabsContent value="details">
                                {selectedRoute && (
                                    <div className="max-h-[60vh] overflow-y-auto p-2">
                                        <RouteDetailsContent route={selectedRoute} />
                                    </div>
                                )}
                            </TabsContent>
                        </Tabs>
                    </DialogContent>
                </Dialog>
            )}

            {isMobile ? (
                <Sheet open={isSelectingOnMap} onOpenChange={setIsSelectingOnMap}>
                    <SheetContent side="bottom" className="h-[85vh] overflow-hidden">
                        <SheetHeader>
                            <SheetTitle>Select {locationMode === 'start' ? 'start' : 'end'} location</SheetTitle>
                            <SheetDescription>Tap the map to set your {locationMode} point.</SheetDescription>
                        </SheetHeader>
                        <div className="mt-4 h-[65vh] overflow-hidden rounded-md border">
                            <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                                <LeafletMap
                                    defaultZoom={["user", currentUrl.defaultMapCenter]}
                                    mapItems={mapMarkers}
                                    map_id="journey-planner-select-map"
                                    height="100%"
                                    onMapClick={handleMapClick}
                                />
                            </Suspense>
                        </div>
                    </SheetContent>
                </Sheet>
            ) : (
                <Dialog open={isSelectingOnMap} onOpenChange={setIsSelectingOnMap}>
                    <DialogContent className="max-w-5xl">
                        <DialogHeader>
                            <DialogTitle>Select {locationMode === 'start' ? 'start' : 'end'} location</DialogTitle>
                            <DialogDescription>Click the map to set your {locationMode} point.</DialogDescription>
                        </DialogHeader>
                        <div className="mt-4 h-[65vh] overflow-hidden rounded-md border">
                            <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                                <LeafletMap
                                    defaultZoom={["user", currentUrl.defaultMapCenter]}
                                    mapItems={mapMarkers}
                                    map_id="journey-planner-select-map"
                                    height="100%"
                                    onMapClick={handleMapClick}
                                />
                            </Suspense>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}

function getFirstTransitLeg(route: JourneyType): Leg | null {
    return route.Legs.find(l => l.Mode === 'transit') ?? null;
}

function getLastTransitLeg(route: JourneyType): Leg | null {
    const legs = route.Legs.filter(l => l.Mode === 'transit');
    return legs[legs.length - 1] ?? null;
}

/** Returns a realtime summary badge for the worst state across all transit legs */
/***
 * function getRouteSummaryRealtime(route: JourneyType): { label: string; className: string } | null {
    const transitLegs = route.Legs.filter(l => l.Mode === 'transit');
    if (transitLegs.length === 0) return null;

    const hasDisruption = transitLegs.some(l => l.trip_usable === false);
    if (hasDisruption) return null; // shown separately as a banner

    const maxDelaySec = Math.max(...transitLegs.filter(l => l.realtime_status === RealtimeStatus.Delayed).map(l => l.delay_seconds ?? 0));
    const maxEarlySec = Math.max(...transitLegs.filter(l => l.realtime_status === RealtimeStatus.Early).map(l => Math.abs(l.delay_seconds ?? 0)));

    if (maxDelaySec > 0) {
        const mins = Math.round(maxDelaySec / 60);
        return { label: `Up to ${mins} min delay`, className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
    }
    if (maxEarlySec > 0) {
        const mins = Math.round(maxEarlySec / 60);
        return { label: `${mins} min early`, className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
    }
    const hasScheduled = transitLegs.some(l => l.realtime_status === RealtimeStatus.Scheduled);
    if (hasScheduled) return { label: 'On time', className: 'bg-muted text-muted-foreground' };
    return null;
}
 */

/** Renders a time, with the scheduled time struck-through when realtime shows a difference */
function formatTimeWithRealtime(actual: Date, scheduled?: Date, status?: RealtimeStatus): React.ReactNode {
    const actualStr = formatTime(actual);
    const isDelayed = status === RealtimeStatus.Delayed;
    const isEarly = status === RealtimeStatus.Early;
    if ((isDelayed || isEarly) && scheduled) {
        const scheduledStr = formatTime(scheduled);
        if (scheduledStr !== actualStr) {
            return (
                <span className="inline-flex items-baseline gap-1">
                    <span>{actualStr}</span>
                    <span className="line-through text-muted-foreground/60 text-xs hidden">{scheduledStr}</span>
                </span>
            );
        }
    }
    return actualStr;
}

function getRouteStepsJSX(route: JourneyType) {
    return route.Legs.map((leg, index) => {
        const isLast = index === route.Legs.length - 1;
        const nextLeg = !isLast ? route.Legs[index + 1] : null;
        const waitingNs = nextLeg ? getWaitingTimeNs(leg, nextLeg) : null;
        const isDelayed = leg.realtime_status === RealtimeStatus.Delayed;
        const isEarly = leg.realtime_status === RealtimeStatus.Early;
        const isOnTime = leg.realtime_status === RealtimeStatus.OnTime;
        const hasRealtime = isDelayed || isEarly || isOnTime;

        return (
            <span key={index} className="inline-flex items-center gap-1">
                {leg.Mode === "walk" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Footprints size={12} />
                        {Math.round(leg.Duration / 60000000000)} min
                    </span>
                ) : (
                    <span className="relative inline-flex items-center">
                        <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-white dark:text-gray-100 text-xs font-medium"
                            style={{
                                background:
                                    "#" +
                                    (leg.Route?.route_color && leg.Route.route_color !== ""
                                        ? leg.Route.route_color
                                        : "424242"),
                                filter: "brightness(0.9) contrast(1.1)",
                                opacity: leg.trip_usable === false ? 0.5 : 1,
                            }}
                        >
                            {leg.Route?.route_short_name || leg.RouteID}
                        </span>
                        {hasRealtime && (
                            <span className={`absolute -top-1 -right-1 h-2 w-2 rounded-full ${isDelayed ? 'bg-amber-500' : 'bg-green-500'}`}>
                                <span className={`absolute inset-0 rounded-full animate-ping opacity-75 ${isDelayed ? 'bg-amber-500' : 'bg-green-500'}`} />
                            </span>
                        )}
                    </span>
                )}

                {!isLast && <ArrowRight size={10} className="text-muted-foreground mx-0.5" />}

                {!isLast && waitingNs && waitingNs >= 60000000000 && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground mx-1 text-xs">
                        <Clock size={10} />
                        {formatDuration(waitingNs)}
                        <ArrowRight size={10} />
                    </span>
                )}
            </span>
        );
    });
}

function getWaitingTimeNs(prev: Leg, next: Leg) {
    const arrival = new Date(prev.ArrivalTime).getTime();
    const departure = new Date(next.DepartureTime).getTime();

    const diffMs = departure - arrival;
    if (diffMs <= 0) return null;

    // convert ms → nanoseconds to reuse formatDuration
    return diffMs * 1_000_000;
}


function formatTime(dateString: string | Date) {
    return new Date(dateString).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function formatDuration(nanoseconds: number) {
    const minutes = Math.round(nanoseconds / 60000000000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}

function RouteDetailsContent({ route }: { route: JourneyType }) {
    return (
        <div className="space-y-1">
            {route.Legs.map((leg, legIndex) => {
                const isWalk = leg.Mode === 'walk';
                const isDelayed = leg.realtime_status === RealtimeStatus.Delayed;
                const isEarly = leg.realtime_status === RealtimeStatus.Early;
                const isOnTime = leg.realtime_status === RealtimeStatus.OnTime;
                const hasRealtime = isDelayed || isEarly || isOnTime;
                //const delaySec = leg.delay_seconds ?? 0;
                //const delayMin = Math.round(Math.abs(delaySec) / 60);
                const routeColor = leg.Route?.route_color && leg.Route.route_color !== "" ? `#${leg.Route.route_color}` : "#424242";

                return (
                    <div key={legIndex} className="relative">
                        {/* Disruption alert */}
                        {!isWalk && leg.trip_usable === false && (
                            <div className="mb-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                <span>This service is not running. Check alternative routes.</span>
                            </div>
                        )}

                        {/* Leg header */}
                        <div className="flex items-center gap-2 py-1">
                            {isWalk ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                                    <Footprints size={12} />
                                    Walk · {Math.round(leg.Duration / 60000000000)} min
                                    {leg.DistanceKm > 0 && <span className="text-muted-foreground/70">· {leg.DistanceKm.toFixed(2)} km</span>}
                                </span>
                            ) : (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span
                                        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-white"
                                        style={{ backgroundColor: routeColor, filter: "brightness(0.9) contrast(1.1)", opacity: leg.trip_usable === false ? 0.5 : 1 }}
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

                        {/* Stops */}
                        <div className="ml-2 space-y-0 border-l-2 border-border pl-4">
                            {/* From stop */}
                            <div className="relative py-2">
                                <span className="absolute -left-[21px] top-3 h-3 w-3 rounded-full border-2 border-background bg-green-500 ring-1 ring-green-500" />
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                    <span className="font-medium text-sm">{formatTime(leg.DepartureTime)}</span>
                                    {hasRealtime && leg.scheduled_departure_time && formatTime(leg.scheduled_departure_time) !== formatTime(leg.DepartureTime) && (
                                        <span className="text-xs text-muted-foreground line-through">{formatTime(leg.scheduled_departure_time)}</span>
                                    )}
                                    <span className="text-sm text-muted-foreground">{leg.FromStop?.stop_name || 'Start'}</span>
                                    <div className="flex items-center gap-1">
                                        {leg.FromStop?.platform_number && leg.FromStop.platform_number !== "" && (
                                            <Badge variant="outline" className="text-xs py-0 h-5">Plat. {leg.FromStop.platform_number}</Badge>
                                        )}
                                        {leg.FromStop?.stop_headsign && leg.FromStop.stop_headsign !== "" && (
                                            <span className="text-xs text-muted-foreground">towards {leg.FromStop.stop_headsign}</span>
                                        )}
                                        {leg.FromStop?.wheelchair_boarding === 1 && (
                                            <Accessibility size={12} className="text-muted-foreground" />
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* To stop */}
                            <div className="relative py-2">
                                <span className="absolute -left-[21px] top-3 h-3 w-3 rounded-full border-2 border-background bg-destructive ring-1 ring-destructive" />
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                    <span className="font-medium text-sm">{formatTime(leg.ArrivalTime)}</span>
                                    {hasRealtime && leg.scheduled_arrival_time && formatTime(leg.scheduled_arrival_time) !== formatTime(leg.ArrivalTime) && (
                                        <span className="text-xs text-muted-foreground line-through">{formatTime(leg.scheduled_arrival_time)}</span>
                                    )}
                                    <span className="text-sm text-muted-foreground">{leg.ToStop?.stop_name || 'Destination'}</span>
                                    <div className="flex items-center gap-1">
                                        {leg.ToStop?.platform_number && leg.ToStop.platform_number !== "" && (
                                            <Badge variant="outline" className="text-xs py-0 h-5">Plat. {leg.ToStop.platform_number}</Badge>
                                        )}
                                        {leg.ToStop?.stop_headsign && leg.ToStop.stop_headsign !== "" && (
                                            <span className="text-xs text-muted-foreground">towards {leg.ToStop.stop_headsign}</span>
                                        )}
                                        {leg.ToStop?.wheelchair_boarding === 1 && (
                                            <Accessibility size={12} className="text-muted-foreground" />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Transfer gap to next leg */}
                        {legIndex < route.Legs.length - 1 && (() => {
                            const nextLeg = route.Legs[legIndex + 1];
                            const waitNs = getWaitingTimeNs(leg, nextLeg);
                            if (!waitNs || waitNs < 60000000000) return null;
                            return (
                                <div className="ml-2 flex items-center gap-2 py-1.5 text-xs text-muted-foreground">
                                    <Clock size={11} />
                                    <span>{formatDuration(waitNs)} wait</span>
                                </div>
                            );
                        })()}
                    </div>
                );
            })}
        </div>
    );
}


export interface JourneyType {
    StartLat: number;
    StartLon: number;
    EndLat: number;
    EndLon: number;
    DepartureTime: Date;
    ArrivalTime: Date;
    TotalDuration: number;
    Transfers: number;
    TransferStops: Stop[] | null;
    Legs: Leg[];
    RouteGeoJSON: GeoJSON;
    ID: string;
}

export interface Leg {
    Mode: string;
    FromStop: Stop | null;
    ToStop: Stop | null;
    TripID: string;
    RouteID: string;
    Route: Route | null;
    DepartureTime: Date;
    ArrivalTime: Date;
    Duration: number;
    DistanceKm: number;
    StopSequenceID: number;
    scheduled_departure_time: Date;
    scheduled_arrival_time: Date;
    trip_usable: boolean;
    realtime_status?: RealtimeStatus;
    delay_seconds?: number;
}

export interface Stop {
    location_type: number;
    parent_station: string;
    stop_code: string;
    stop_id: string;
    stop_lat: number;
    stop_lon: number;
    stop_name: string;
    stop_headsign: string;
    wheelchair_boarding: number;
    platform_number: string;
    stop_type: string;
    stop_sequence: number;
    is_child_stop: boolean;
}

export enum RealtimeStatus {
    Delayed = "delayed",
    Early = "early",
    Scheduled = "scheduled",
    OnTime = "on_time",
}

export interface Route {
    route_id: string;
    route_short_name: string;
    route_long_name: string;
    route_color: string;
    route_text_color: string;
    vehicle_type: string;
}







function DatePicker({
    date,
    onDateChange,
    disabled,
}: {
    date: Date;
    onDateChange: (date: Date) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false)

    // Handle time input changes
    const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (disabled) return
        const [hours, minutes, seconds] = e.target.value.split(":").map(Number)
        const updatedDate = new Date(date)
        updatedDate.setHours(hours, minutes, seconds || 0)
        onDateChange(updatedDate)
    }

    return (
        <div className="flex flex-col space-y-2">
            <Label>Date & Time</Label>
            <div className="flex flex-col md:flex-row gap-2">
                <div className="">
                    <Popover open={open} onOpenChange={setOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                id="date-picker-optional"
                                className="font-normal"
                                disabled={disabled}
                            >
                                {date ? format(date, "PPP") : "Select date"}
                                <ChevronDownIcon />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                            <Calendar
                                mode="single"
                                selected={date}
                                captionLayout="dropdown"
                                defaultMonth={date}
                                onSelect={(selectedDate) => {
                                    if (!selectedDate) return
                                    const updatedDate = new Date(selectedDate)
                                    // Preserve current time
                                    updatedDate.setHours(date.getHours(), date.getMinutes(), date.getSeconds())
                                    onDateChange(updatedDate)
                                    setOpen(false)
                                }}
                            />
                        </PopoverContent>
                    </Popover>
                </div>
                <div className="space-y-1">
                    <Input
                        type="time"
                        id="time-picker-optional"
                        step="1"
                        value={date ? format(date, "HH:mm:ss") : "00:00:00"}
                        onChange={handleTimeChange}
                        disabled={disabled}
                        className="w-fit bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                    />
                </div>
            </div>
        </div>
    )
}
