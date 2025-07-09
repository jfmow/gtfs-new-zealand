import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MapPin, Loader2, AlertCircle, Locate } from "lucide-react"
import { ApiFetch } from "@/lib/url-context"
import { formatDistance } from "@/lib/utils"
import ServiceTrackerModal from "../tracker"

export interface ClosestVehicle {
    distance_from_vehicle: number
    routeId: string
    tripHeadsign: string
    tripId: string
}

function FindCurrentVehicle() {
    const [vehicles, setVehicles] = useState<ClosestVehicle[]>([])
    const [errorMessage, setErrorMessage] = useState("")
    const [traceId, setTraceId] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [isOpen, setIsOpen] = useState(false)

    async function getVehicle() {
        setIsLoading(true)
        setErrorMessage("")
        setTraceId("")
        setVehicles([])

        try {
            // Get the user's location
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error("Geolocation is not supported by this browser"))
                    return
                }

                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 60000,
                })
            })

            const lat = position.coords.latitude
            const lon = position.coords.longitude

            // Make API request
            const req = await ApiFetch<ClosestVehicle[]>(`/realtime/find-my-vehicle/${lat}/${lon}`)

            if (req.ok) {
                setVehicles(req.data)
            } else {
                setErrorMessage(req.error || "Failed to find vehicles")
                setTraceId(req.trace_id || "")
            }
        } catch (error) {
            if (error instanceof GeolocationPositionError) {
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        setErrorMessage("Location access denied. Please enable location permissions.")
                        break
                    case error.POSITION_UNAVAILABLE:
                        setErrorMessage("Location information is unavailable.")
                        break
                    case error.TIMEOUT:
                        setErrorMessage("Location request timed out.")
                        break
                    default:
                        setErrorMessage("An unknown error occurred while getting location.")
                        break
                }
            } else {
                setErrorMessage(error instanceof Error ? error.message : "Failed to get location")
            }
        } finally {
            setIsLoading(false)
        }
    }

    const handleDialogOpen = (open: boolean) => {
        setIsOpen(open)
        if (open) {
            getVehicle()
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={handleDialogOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Locate className="w-4 h-4" />
                    Find My Vehicle
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Find Your Current Vehicle</DialogTitle>
                    <DialogDescription>We&apos;ll use your location to find nearby vehicles you might be on.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {isLoading && (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin mr-2" />
                            <span>Finding nearby vehicles...</span>
                        </div>
                    )}

                    {errorMessage && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                {errorMessage}
                                {traceId && <div className="text-xs mt-1 opacity-70">Trace ID: {traceId}</div>}
                            </AlertDescription>
                        </Alert>
                    )}

                    {vehicles.length > 0 && !isLoading && (
                        <div className="space-y-3">
                            <h4 className="font-medium text-sm mb-2">Are you on one of these vehicles?</h4>
                            {vehicles.map((vehicle) => (
                                <Card key={vehicle.tripId} className="cursor-pointer hover:bg-muted/50 transition-colors">
                                    <CardHeader>
                                        <div className="flex items-center justify-between">
                                            <CardTitle className="text-sm font-medium">{vehicle.routeId}</CardTitle>
                                            <div className="flex items-center text-xs text-muted-foreground">
                                                <MapPin className="w-3 h-3 mr-1" />
                                                {formatDistance(vehicle.distance_from_vehicle)}
                                            </div>
                                        </div>
                                        <CardDescription className="text-xs">{vehicle.tripHeadsign}</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <ServiceTrackerModal tripId={vehicle.tripId} loaded={true} has={true} />
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}

                    {vehicles.length === 0 && !isLoading && !errorMessage && (
                        <div className="text-center py-8 text-muted-foreground">
                            <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No vehicles found nearby</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default FindCurrentVehicle
