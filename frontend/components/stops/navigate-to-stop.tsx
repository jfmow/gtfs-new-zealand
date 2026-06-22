import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Loader2, Navigation } from "lucide-react"
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

export default function NavigateToStop({ stopName }: NavigateToStopProps) {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [userLat, setUserLat] = useState(0)
    const [userLon, setUserLon] = useState(0)
    const [stopLat, setStopLat] = useState(0)
    const [stopLon, setStopLon] = useState(0)
    const [ready, setReady] = useState(false)
    const isMobile = useIsMobile()

    async function handleNavigate() {
        setLoading(true)
        setError(null)
        setReady(false)

        try {
            const [userLocation, stopResponse] = await Promise.all([
                getUserLocation(),
                ApiFetch<StopSearchResult[]>(`stops/find-stop/${encodeURIComponent(stopName)}`),
            ])

            if (!stopResponse.ok || stopResponse.data.length === 0) {
                setError("Could not find stop location")
                setLoading(false)
                return
            }

            const stop = stopResponse.data[0]
            setUserLat(userLocation[0])
            setUserLon(userLocation[1])
            setStopLat(stop.stop_lat)
            setStopLon(stop.stop_lon)
            setReady(true)
            setOpen(true)
        } catch {
            setError("Could not get your location. Please enable location services.")
        } finally {
            setLoading(false)
        }
    }

    const content = ready ? (
        <Navigate
            start={{ lat: userLat, lon: userLon, name: "Your location" }}
            end={{ lat: stopLat, lon: stopLon, name: stopName }}
            liveMode
        />
    ) : null

    if (isMobile) {
        return (
            <>
                <Button
                    aria-label="Navigate to stop"
                    variant="outline"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={handleNavigate}
                    disabled={loading}
                >
                    {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Navigation className="w-4 h-4" />
                    )}
                </Button>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <Sheet open={open} onOpenChange={setOpen}>
                    <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
                        <SheetHeader>
                            <SheetTitle>Navigate to {stopName}</SheetTitle>
                        </SheetHeader>
                        <div className="mt-4">
                            {content}
                        </div>
                    </SheetContent>
                </Sheet>
            </>
        )
    }

    return (
        <>
            <Button
                aria-label="Navigate to stop"
                variant="outline"
                size="icon"
                className="flex-shrink-0"
                onClick={handleNavigate}
                disabled={loading}
            >
                {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <Navigation className="w-4 h-4" />
                )}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Navigate to {stopName}</DialogTitle>
                    </DialogHeader>
                    {content}
                </DialogContent>
            </Dialog>
        </>
    )
}
