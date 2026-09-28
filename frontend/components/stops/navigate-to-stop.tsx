import { useEffect, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Loader2 } from "lucide-react"
import Navigate from "@/components/map/navigate"
import { getUserLocation } from "@/lib/userLocation"
import { ApiFetch } from "@/lib/url-context"
import { useIsMobile } from "@/lib/utils"

interface StopSearchResult {
    name: string
    type_of_stop: string
    stop_lat: number
    stop_lon: number
}

interface NavigateToStopProps {
    stopName: string
}

/**
 * "Directions to stop" opened from the board's ⋯ menu: walking directions
 * from the rider's location, in a sheet on phones and a dialog on desktop.
 */
export function NavigateToStopDialog({ stopName, open, onOpenChange }: NavigateToStopProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [route, setRoute] = useState<{ user: [number, number]; stop: [number, number] } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const isMobile = useIsMobile()

    useEffect(() => {
        if (!open) return
        let cancelled = false
        setRoute(null)
        setError(null)
        Promise.all([
            getUserLocation(),
            ApiFetch<StopSearchResult[]>(`stops/find-stop/${encodeURIComponent(stopName)}`),
        ]).then(([user, stopResponse]) => {
            if (cancelled) return
            if (!stopResponse.ok || stopResponse.data.length === 0) return setError("Could not find where this stop is.")
            const stop = stopResponse.data[0]
            setRoute({ user, stop: [stop.stop_lat, stop.stop_lon] })
        }).catch(() => {
            if (!cancelled) setError("Could not get your location. Please allow location for this site.")
        })
        return () => { cancelled = true }
    }, [open, stopName])

    const content = error ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{error}</p>
    ) : route ? (
        <Navigate
            start={{ lat: route.user[0], lon: route.user[1], name: "Your location" }}
            end={{ lat: route.stop[0], lon: route.stop[1], name: stopName }}
            liveMode
        />
    ) : (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Finding your location...
        </div>
    )

    if (isMobile) {
        return (
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>Directions to {stopName}</SheetTitle>
                    </SheetHeader>
                    <div className="mt-4">{content}</div>
                </SheetContent>
            </Sheet>
        )
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Directions to {stopName}</DialogTitle>
                </DialogHeader>
                {content}
            </DialogContent>
        </Dialog>
    )
}
