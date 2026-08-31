"use client"

import { Suspense } from "react"
import dynamic from "next/dynamic"
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerDescription,
} from "@/components/ui/drawer"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useIsMobile } from "@/lib/utils"
import type { MapItem } from "@/components/map/markers/create"
import type { LatLng } from "@/components/map/map"
import type { Location } from "./types"

const LeafletMap = dynamic(() => import("@/components/map/map"), { ssr: false })

interface MapPickerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    locationMode: 'start' | 'end'
    onMapClick: (lat: number, lon: number) => void
    startLocation: Location | null
    endLocation: Location | null
    defaultMapCenter: LatLng
}

export function MapPicker({ open, onOpenChange, locationMode, onMapClick, startLocation, endLocation, defaultMapCenter }: MapPickerProps) {
    const isMobile = useIsMobile()

    const mapMarkers: MapItem[] = []
    if (startLocation) {
        mapMarkers.push({
            lat: startLocation.lat, lon: startLocation.lon, icon: "start marker", id: "start",
            routeID: "", zIndex: 200, onClick: () => { }, visibleLabel: "Start", type: "stop",
        })
    }
    if (endLocation) {
        mapMarkers.push({
            lat: endLocation.lat, lon: endLocation.lon, icon: "end marker", id: "end",
            routeID: "", zIndex: 200, onClick: () => { }, visibleLabel: "End", type: "stop",
        })
    }

    const map = (
        <div className="mt-4 h-[65vh] overflow-hidden rounded-md border">
            <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                <LeafletMap
                    defaultZoom={["user", defaultMapCenter]}
                    mapItems={mapMarkers}
                    map_id="journey-planner-select-map"
                    height="100%"
                    onMapClick={onMapClick}
                />
            </Suspense>
        </div>
    )

    if (isMobile) {
        return (
            <Drawer open={open} onOpenChange={onOpenChange}>
                <DrawerContent className="h-[85vh]">
                    <DrawerHeader>
                        <DrawerTitle>Select {locationMode === 'start' ? 'start' : 'end'} location</DrawerTitle>
                        <DrawerDescription>Tap the map to set your {locationMode} point.</DrawerDescription>
                    </DrawerHeader>
                    <div className="px-4">{map}</div>
                </DrawerContent>
            </Drawer>
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Select {locationMode === 'start' ? 'start' : 'end'} location</DialogTitle>
                    <DialogDescription>Click the map to set your {locationMode} point.</DialogDescription>
                </DialogHeader>
                {map}
            </DialogContent>
        </Dialog>
    )
}
