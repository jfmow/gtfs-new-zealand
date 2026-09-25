"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Reorder, useDragControls } from "framer-motion"
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { LocationSearchInput } from "@/components/map/search"
import { ApiFetch } from "@/lib/url-context"
import { cn } from "@/lib/utils"
import type { Location } from "@/components/journey/types"
import { PLACE_ICONS, placeIcon, useSavedPlaces, type PlaceIconKey, type SavedPlace } from "./use-saved-places"

/** The rounded tile with a place's icon on its tint. */
export function PlaceTile({ icon, size = 28 }: { icon: string; size?: number }) {
    const { icon: Icon, color } = placeIcon(icon)
    return (
        <span
            aria-hidden
            className="inline-flex shrink-0 items-center justify-center"
            style={{ width: size, height: size, borderRadius: size * 0.28, background: `${color}2e`, color }}
        >
            <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2.25} />
        </span>
    )
}

/** Link that plans a trip from the rider's location to `place` (see plan.tsx `fromHere`). */
export function planToPlaceHref(place: SavedPlace) {
    const params = new URLSearchParams({
        endLat: String(place.lat),
        endLon: String(place.lon),
        endLabel: place.name,
        fromHere: "1",
    })
    return `/plan?${params}`
}

// ─── Add / edit ───────────────────────────────────────────────────────────────

export type PlaceEditorTarget = { place: SavedPlace } | { preset: { name: string; icon: PlaceIconKey } }

export function PlaceEditorDialog({
    target,
    onOpenChange,
}: {
    target: PlaceEditorTarget | null
    onOpenChange: (open: boolean) => void
}) {
    const { addPlace, updatePlace, deletePlace } = useSavedPlaces()
    const editing = target && "place" in target ? target.place : null
    const [name, setName] = useState("")
    const [icon, setIcon] = useState<PlaceIconKey>("pin")
    const [location, setLocation] = useState<Location | null>(null)
    const [isLocating, setIsLocating] = useState(false)

    useEffect(() => {
        if (!target) return
        if ("place" in target) {
            setName(target.place.name)
            setIcon(target.place.icon)
            setLocation({ lat: target.place.lat, lon: target.place.lon, label: target.place.address })
        } else {
            setName(target.preset.name)
            setIcon(target.preset.icon)
            setLocation(null)
        }
    }, [target])

    const trimmed = name.trim()
    const canSave = !!trimmed && !!location

    const pickIcon = (key: PlaceIconKey) => {
        setIcon(key)
        // Naming by icon, until the rider types their own name.
        const isIconName = Object.values(PLACE_ICONS).some((i) => i.label === trimmed)
        if ((!trimmed || isIconName) && key !== "pin" && key !== "star") setName(PLACE_ICONS[key].label)
    }

    const useCurrentLocation = () => {
        if (!navigator?.geolocation) return toast.error("Current location is unavailable in this browser.")
        setIsLocating(true)
        navigator.geolocation.getCurrentPosition(
            async ({ coords }) => {
                let label = "Current location"
                try {
                    const res = await ApiFetch<{ name: string }>(`/map/reverse?lat=${coords.latitude}&lon=${coords.longitude}`)
                    if (res.ok) label = res.data.name
                } catch { /* keep the fallback label */ }
                setLocation({ lat: coords.latitude, lon: coords.longitude, label })
                setIsLocating(false)
            },
            () => {
                toast.error("Unable to access your current location.")
                setIsLocating(false)
            },
            { enableHighAccuracy: true, timeout: 10000 }
        )
    }

    const save = () => {
        if (!canSave || !location) return
        const fields = { name: trimmed, icon, address: location.label, lat: location.lat, lon: location.lon }
        if (editing) {
            updatePlace({ ...editing, ...fields })
        } else {
            addPlace(fields)
            toast.success(`Saved ${trimmed}`)
        }
        onOpenChange(false)
    }

    const remove = () => {
        if (!editing) return
        deletePlace(editing.id)
        toast.success("Place deleted")
        onOpenChange(false)
    }

    return (
        <Dialog open={!!target} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{editing ? "Edit place" : "Add place"}</DialogTitle>
                    <DialogDescription>Plan trips here in one tap from the home page or the planner.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Location</p>
                        <LocationSearchInput
                            placeholder="Search for an address or place"
                            value={location}
                            onSelect={setLocation}
                            storageKey="recentPlaceLocations"
                            onUseCurrentLocation={useCurrentLocation}
                            isLocating={isLocating}
                            showSavedPlaces={false}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Name</p>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") save() }}
                            placeholder="e.g. Home, Work, Sam's place"
                            maxLength={30}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Icon</p>
                        <div className="grid grid-cols-5 gap-2">
                            {(Object.keys(PLACE_ICONS) as PlaceIconKey[]).map((key) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => pickIcon(key)}
                                    aria-label={PLACE_ICONS[key].label}
                                    aria-pressed={icon === key}
                                    title={PLACE_ICONS[key].label}
                                    className={cn(
                                        "flex items-center justify-center rounded-xl p-1 transition-shadow",
                                        icon === key && "ring-2 ring-foreground/60"
                                    )}
                                >
                                    <PlaceTile icon={key} size={40} />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:justify-between">
                    {editing ? (
                        <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={remove}>
                            <Trash2 className="h-4 w-4" />
                            Delete
                        </Button>
                    ) : <span />}
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button onClick={save} disabled={!canSave}>Save</Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ─── Manage ───────────────────────────────────────────────────────────────────

function PlaceRow({ place, onEdit, onDelete }: { place: SavedPlace; onEdit: () => void; onDelete: () => void }) {
    const controls = useDragControls()
    return (
        <Reorder.Item value={place} dragListener={false} dragControls={controls} as="li"
            className="flex items-center gap-3 rounded-lg border bg-card px-2 py-2 select-none">
            <button
                onPointerDown={(e) => controls.start(e)}
                aria-label="Drag to reorder"
                className="flex h-7 w-5 items-center justify-center text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
            >
                <GripVertical className="h-4 w-4" />
            </button>
            <PlaceTile icon={place.icon} size={32} />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{place.name}</p>
                <p className="truncate text-xs text-muted-foreground">{place.address}</p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} aria-label={`Edit ${place.name}`}>
                <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label={`Delete ${place.name}`}>
                <Trash2 className="h-3.5 w-3.5" />
            </Button>
        </Reorder.Item>
    )
}

export function ManagePlacesDialog({
    open,
    onOpenChange,
    onEdit,
    onAdd,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onEdit: (place: SavedPlace) => void
    onAdd: () => void
}) {
    const { places, deletePlace, reorderPlaces } = useSavedPlaces()
    const [order, setOrder] = useState<SavedPlace[]>(places)
    useEffect(() => setOrder(places), [places.map((p) => `${p.id}:${p.name}:${p.icon}`).join(",")]) // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) reorderPlaces(order); onOpenChange(next) }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Places</DialogTitle>
                    <DialogDescription>Drag to reorder. Places only show in the region they were saved in.</DialogDescription>
                </DialogHeader>
                {order.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No saved places yet.</p>
                ) : (
                    <Reorder.Group axis="y" values={order} onReorder={setOrder} as="ul" className="space-y-2">
                        {order.map((place) => (
                            <PlaceRow
                                key={place.id}
                                place={place}
                                onEdit={() => onEdit(place)}
                                onDelete={() => {
                                    deletePlace(place.id)
                                    toast.success("Place deleted")
                                }}
                            />
                        ))}
                    </Reorder.Group>
                )}
                <DialogFooter className="gap-2 sm:justify-between">
                    <Button variant="outline" onClick={onAdd}>
                        <Plus className="h-4 w-4" />
                        Add place
                    </Button>
                    <Button onClick={() => { reorderPlaces(order); onOpenChange(false) }}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ─── Home page row ────────────────────────────────────────────────────────────

/**
 * The home page's "Places" row: a chip per saved place (tap = plan a trip
 * there from here) plus add chips - Home and Work until they're saved.
 */
export function SavedPlacesRow() {
    const { places } = useSavedPlaces()
    const [editor, setEditor] = useState<PlaceEditorTarget | null>(null)
    const [managing, setManaging] = useState(false)

    const hasIcon = (key: PlaceIconKey) => places.some((p) => p.icon === key)
    const addChip = (label: string, preset: { name: string; icon: PlaceIconKey }) => (
        <button
            type="button"
            onClick={() => setEditor({ preset })}
            className="flex shrink-0 items-center gap-2 rounded-full border border-dashed py-1 pl-1 pr-3.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
                <Plus className="h-3.5 w-3.5" />
            </span>
            {label}
        </button>
    )

    return (
        <section aria-labelledby="places-heading">
            <div className="mb-1.5 flex items-center justify-between">
                <h2 id="places-heading" className="text-xs font-display uppercase tracking-wide text-muted-foreground">
                    Places
                </h2>
                {places.length > 0 && (
                    <button type="button" onClick={() => setManaging(true)} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                        Edit
                    </button>
                )}
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide">
                {places.map((place) => (
                    <Link
                        key={place.id}
                        href={planToPlaceHref(place)}
                        title={`Plan a trip to ${place.address}`}
                        className="flex shrink-0 items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3.5 text-sm font-medium shadow-sm hover:bg-accent transition-colors"
                    >
                        <PlaceTile icon={place.icon} />
                        {place.name}
                    </Link>
                ))}
                {!hasIcon("home") && addChip("Add home", { name: "Home", icon: "home" })}
                {!hasIcon("work") && addChip("Add work", { name: "Work", icon: "work" })}
                {addChip("Add place", { name: "", icon: "pin" })}
            </div>

            <PlaceEditorDialog target={editor} onOpenChange={(open) => !open && setEditor(null)} />
            <ManagePlacesDialog
                open={managing}
                onOpenChange={setManaging}
                onEdit={(place) => { setManaging(false); setEditor({ place }) }}
                onAdd={() => { setManaging(false); setEditor({ preset: { name: "", icon: "pin" } }) }}
            />
        </section>
    )
}
