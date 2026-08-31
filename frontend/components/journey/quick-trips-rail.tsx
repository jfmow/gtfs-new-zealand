"use client"

import { useEffect, useRef, useState } from "react"
import { Reorder, useDragControls } from "framer-motion"
import { GripVertical, MoreVertical, Pencil, Trash2, Route as RouteIcon } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { SWATCH_COLORS } from "@/lib/colors"
import type { SavedTrip } from "./use-saved-trips"

interface QuickTripsRailProps {
    trips: SavedTrip[]
    onLoadTrip: (trip: SavedTrip) => void
    onUpdateTrip: (trip: SavedTrip) => void
    onDeleteTrip: (id: string) => void
    onReorderTrips: (trips: SavedTrip[]) => void
}

function TripMenu({
    trip,
    onRename,
    onSetColor,
    onDelete,
}: {
    trip: SavedTrip
    onRename: () => void
    onSetColor: (color: string) => void
    onDelete: () => void
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    aria-label={`Options for ${trip.name}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors shrink-0"
                >
                    <MoreVertical className="w-3.5 h-3.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onRename}>
                    <Pencil className="w-3.5 h-3.5" />
                    Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">Colour</DropdownMenuLabel>
                <div className="flex flex-wrap gap-1.5 px-2 py-1.5">
                    {SWATCH_COLORS.map((c) => (
                        <button
                            key={c.value}
                            aria-label={c.name}
                            onClick={() => onSetColor(c.value)}
                            className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${trip.color === c.value ? "ring-2 ring-offset-1 ring-offset-popover ring-foreground/50" : ""
                                }`}
                            style={{ background: c.value }}
                        />
                    ))}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={onDelete}
                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function RenameDialog({
    trip,
    onOpenChange,
    onSave,
}: {
    trip: SavedTrip | null
    onOpenChange: (open: boolean) => void
    onSave: (name: string) => void
}) {
    const [value, setValue] = useState("")

    useEffect(() => {
        if (trip) setValue(trip.name)
    }, [trip])

    const commit = () => {
        const trimmed = value.trim()
        if (!trimmed) return onOpenChange(false)
        onSave(trimmed)
        onOpenChange(false)
    }

    return (
        <Dialog open={!!trip} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Rename trip</DialogTitle>
                </DialogHeader>
                <Input
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commit()
                    }}
                    placeholder="Trip name"
                />
                <DialogFooter>
                    <button
                        type="button"
                        className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="text-sm font-medium bg-primary text-primary-foreground rounded-md px-3 py-1.5"
                        onClick={commit}
                    >
                        Save
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function TripCard({
    trip,
    onLoad,
    onRename,
    onSetColor,
    onDelete,
    onDragEnd,
}: {
    trip: SavedTrip
    onLoad: () => void
    onRename: () => void
    onSetColor: (color: string) => void
    onDelete: () => void
    onDragEnd: () => void
}) {
    const controls = useDragControls()

    return (
        <Reorder.Item
            value={trip}
            dragListener={false}
            dragControls={controls}
            onDragEnd={onDragEnd}
            as="li"
            className="relative shrink-0 w-[200px] snap-start rounded-lg border border-border bg-card select-none"
            style={{ borderLeft: `3px solid ${trip.color}` }}
        >
            <button
                type="button"
                onClick={onLoad}
                className="absolute inset-0 z-0 rounded-lg text-left"
                aria-label={trip.name}
            />

            <div className="relative z-10 pointer-events-none flex flex-col gap-1.5 p-3 pr-7">
                <div className="flex items-center gap-1.5 min-w-0">
                    <RouteIcon className="w-3 h-3 shrink-0" style={{ color: trip.color }} />
                    <span className="text-sm font-medium truncate">{trip.name}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                    {trip.startLocation.label} &rarr; {trip.endLocation.label}
                </p>
            </div>

            <div className="absolute top-1.5 right-1.5 z-20 pointer-events-auto">
                <TripMenu trip={trip} onRename={onRename} onSetColor={onSetColor} onDelete={onDelete} />
            </div>

            <button
                onPointerDown={(e) => controls.start(e)}
                aria-label="Drag to reorder"
                className="absolute bottom-1 right-1.5 z-20 flex items-center justify-center w-6 h-6 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-colors cursor-grab active:cursor-grabbing touch-none"
            >
                <GripVertical className="w-3.5 h-3.5" />
            </button>
        </Reorder.Item>
    )
}

export function QuickTripsRail({ trips, onLoadTrip, onUpdateTrip, onDeleteTrip, onReorderTrips }: QuickTripsRailProps) {
    const [order, setOrder] = useState<SavedTrip[]>(trips)
    const [renaming, setRenaming] = useState<SavedTrip | null>(null)
    const orderRef = useRef<SavedTrip[]>(trips)

    useEffect(() => setOrder(trips), [trips])
    useEffect(() => {
        orderRef.current = order
    }, [order])

    if (trips.length === 0) return null

    return (
        <div className="space-y-1.5">
            <h2 className="text-sm font-medium text-muted-foreground">Saved trips</h2>
            <Reorder.Group
                as="ul"
                axis="x"
                values={order}
                onReorder={setOrder}
                className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-0.5 px-0.5 list-none"
            >
                {order.map((trip) => (
                    <TripCard
                        key={trip.id}
                        trip={trip}
                        onLoad={() => onLoadTrip(trip)}
                        onRename={() => setRenaming(trip)}
                        onSetColor={(color) => onUpdateTrip({ ...trip, color })}
                        onDelete={() => {
                            onDeleteTrip(trip.id)
                            toast.success("Trip deleted")
                        }}
                        onDragEnd={() => onReorderTrips(orderRef.current)}
                    />
                ))}
            </Reorder.Group>
            <RenameDialog
                trip={renaming}
                onOpenChange={(open) => !open && setRenaming(null)}
                onSave={(name) => {
                    if (renaming) onUpdateTrip({ ...renaming, name })
                }}
            />
        </div>
    )
}
