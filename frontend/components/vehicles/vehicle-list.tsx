import { memo, useMemo, useState } from "react"
import type { VehiclesResponse } from "@/components/services/tracker"
import { cn, formatDistance, haversineDistance } from "@/lib/utils"
import { SearchInput } from "@/components/ui/input"

interface VehicleListProps {
    vehicles: VehiclesResponse[]
    selectedTripId: string
    onSelect: (tripId: string) => void
    userLocation?: [number, number]
    locationFound?: boolean
}

const NEARBY_LIMIT = 20

/** Desktop-only list synced to map selection. Searches by route, otherwise shows the nearest vehicles to the user. */
const VehicleList = memo(function VehicleList({ vehicles, selectedTripId, onSelect, userLocation, locationFound }: VehicleListProps) {
    const [search, setSearch] = useState("")

    const withDistance = useMemo(() => {
        if (!locationFound || !userLocation) return vehicles.map((vehicle) => ({ vehicle, distance: null as number | null }))
        return vehicles.map((vehicle) => ({
            vehicle,
            distance: haversineDistance(userLocation[0], userLocation[1], vehicle.position.lat, vehicle.position.lon),
        }))
    }, [vehicles, userLocation, locationFound])

    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase()
        if (query === "") {
            const sorted = [...withDistance].sort((a, b) => {
                if (a.distance === null || b.distance === null) {
                    return a.vehicle.route.name.localeCompare(b.vehicle.route.name, undefined, { numeric: true })
                }
                return a.distance - b.distance
            })
            return locationFound ? sorted.slice(0, NEARBY_LIMIT) : sorted
        }

        return withDistance
            .filter(({ vehicle }) =>
                vehicle.route.name.toLowerCase().includes(query) || vehicle.route.id.toLowerCase().includes(query)
            )
            .sort((a, b) => a.vehicle.route.name.localeCompare(b.vehicle.route.name, undefined, { numeric: true }))
    }, [withDistance, search, locationFound])

    const isSearching = search.trim() !== ""

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="p-2 border-b border-border shrink-0">
                <SearchInput
                    placeholder="Search by route..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {!isSearching && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground shrink-0 border-b border-border">
                    {locationFound ? "Nearest to you" : "All vehicles"}
                </div>
            )}

            {filtered.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                    {isSearching ? "No vehicles found for that route." : "No vehicles found."}
                </div>
            ) : (
                <div className="overflow-y-auto h-full min-h-0 divide-y divide-border">
                    {filtered.map(({ vehicle, distance }) => {
                        const isSelected = vehicle.trip_id === selectedTripId
                        return (
                            <button
                                key={vehicle.trip_id}
                                onClick={() => onSelect(vehicle.trip_id)}
                                className={cn(
                                    "w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                                    isSelected ? "bg-accent" : "hover:bg-accent/50"
                                )}
                            >
                                <span
                                    className="shrink-0 px-2 py-0.5 rounded text-white dark:text-gray-100 text-xs font-medium"
                                    style={{
                                        background: "#" + (vehicle.route.color !== "" ? vehicle.route.color : "000000"),
                                        filter: "brightness(0.9) contrast(1.1)",
                                    }}
                                >
                                    {vehicle.route.name}
                                </span>
                                <span className="text-muted-foreground text-xs capitalize truncate">{vehicle.type}</span>
                                <span className="ml-auto text-muted-foreground text-xs shrink-0">
                                    {distance !== null ? formatDistance(distance) : vehicle.license_plate}
                                </span>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
})

export default VehicleList
