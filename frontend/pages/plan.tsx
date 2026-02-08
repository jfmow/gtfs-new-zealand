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
import { Clock, Footprints } from "lucide-react";
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
                                return (
                                    <Button
                                        key={index}
                                        variant={'outline'}
                                        className="h-auto w-full justify-start p-4 text-left"
                                        onClick={() => {
                                            setSelectedRoute(route);
                                            setIsRouteMapOpen(true);
                                        }}
                                    >
                                        <div className="flex w-full flex-col gap-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold">{formatDuration(route.TotalDuration)}</span>
                                                </div>
                                                <Badge variant={route.Transfers === 0 ? 'default' : 'secondary'} className="text-xs">
                                                    {route.Transfers === 0 ? 'Direct' : `${route.Transfers} transfer${route.Transfers !== 1 ? 's' : ''}`}
                                                </Badge>
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                <div className="flex items-center flex-wrap gap-y-1">{getRouteStepsJSX(route)}</div>
                                                <div className="mt-2">{formatTime(route.DepartureTime)} → {formatTime(route.ArrivalTime)}</div>
                                            </div>
                                        </div>
                                    </Button>
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

function getRouteStepsJSX(route: JourneyType) {
    return route.Legs.map((leg, index) => {
        const isLast = index === route.Legs.length - 1;
        const nextLeg = !isLast ? route.Legs[index + 1] : null;
        const waitingNs = nextLeg ? getWaitingTimeNs(leg, nextLeg) : null;

        return (
            <span key={index} className="inline-flex items-center gap-1">
                {leg.Mode === "walk" ? (
                    <>
                        <Footprints size={12} />
                        {Math.round(leg.Duration / 60000000000)} min
                    </>
                ) : (
                    <span
                        className="shrink-0 px-1 py-1 rounded text-white dark:text-gray-100 text-xs font-medium"
                        style={{
                            background:
                                "#" +
                                (leg.Route?.route_color !== ""
                                    ? leg.Route?.route_color
                                    : "424242"),
                            filter: "brightness(0.9) contrast(1.1)",
                        }}
                    >
                        {leg.Route?.route_short_name || leg.RouteID}
                    </span>
                )}

                {!isLast && <span className="mx-1">→</span>}

                {/* ⏰ Waiting time */}
                {!isLast && waitingNs && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground mx-1">
                        <Clock size={12} />
                        {formatDuration(waitingNs)}
                        <span className="mx-1">→</span>
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
        <div className="space-y-4">
            {route.Legs.map((leg, index) => (
                <div key={index} className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0">
                    <div className="flex items-center gap-2">
                        <Badge
                            variant={leg.Mode === 'walk' ? 'secondary' : 'default'}
                            style={leg.Route?.route_color ? { backgroundColor: `#${leg.Route.route_color}`, color: '#fff' } : undefined}
                        >
                            {leg.Mode === 'walk' ? 'Walk' : `${leg.Route?.vehicle_type || 'Bus'} ${leg.Route?.route_short_name || leg.RouteID}`}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                            {formatDuration(leg.Duration)}
                        </span>
                    </div>
                    <div className="space-y-1 text-sm">
                        <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-green-500" />
                            <span className="font-medium">{formatTime(leg.DepartureTime)}</span>
                            <span className="text-muted-foreground">
                                {leg.FromStop?.stop_name || 'Start'}
                            </span>
                            {leg.FromStop?.platform_number && leg.FromStop.platform_number !== "" && (
                                <Badge variant={"outline"}>
                                    Platform {leg.FromStop?.platform_number || ''}
                                </Badge>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-red-500" />
                            <span className="font-medium">{formatTime(leg.ArrivalTime)}</span>
                            <span className="text-muted-foreground">
                                {leg.ToStop?.stop_name || 'Destination'}
                            </span>
                            {leg.ToStop?.platform_number && leg.ToStop.platform_number !== "" && (
                                <Badge variant={"outline"}>
                                    Platform {leg.ToStop?.platform_number || ''}
                                </Badge>
                            )}
                        </div>
                    </div>
                    {leg.DistanceKm > 0 && (
                        <p className="text-xs text-muted-foreground">
                            Distance: {leg.DistanceKm.toFixed(2)} km
                        </p>
                    )}
                </div>
            ))}
        </div>
    );
}

export interface JourneyType {
    ID: string;
    StartLat: number;
    StartLon: number;
    EndLat: number;
    EndLon: number;
    DepartureTime: Date;
    ArrivalTime: Date;
    TotalDuration: number;
    Transfers: number;
    TransferStops: null;
    Legs: Leg[];
    RouteGeoJSON: GeoJSON;
}

export interface Leg {
    Mode: string;
    RouteID: string;
    TripID: string;
    FromStop?: Stop;
    ToStop?: Stop;
    DepartureTime: Date;
    ArrivalTime: Date;
    Duration: number;
    DistanceKm: number;
    Route?: Route;
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

export interface Route {
    route_id: string;
    route_short_name: string;
    route_long_name: string;
    route_type: number;
    route_color?: string;
    route_text_color?: string;
    agency_id: string;
    vehicle_type?: string;
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