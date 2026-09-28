"use client"

import React, { useEffect, useRef, useState } from "react"
import { Reorder, useDragControls } from "framer-motion"
import { Star, GripVertical, MoreVertical, Pencil, Trash2, ArrowUpDown } from "lucide-react"
import { Button } from "../ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../ui/dialog"
import { Input } from "../ui/input"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { SWATCH_COLORS as FAVORITE_COLORS } from "@/lib/colors"
import { HomeHint, HomeSection } from "../home/home-section"
import { FavouriteTile, HomeStopRow } from "../home/home-stop-row"

const localStorageKey = "favorites"
const FAVORITES_UPDATED_EVENT = "favoritesUpdated"
const MAX_FAVORITES = 8

export type Favorite = { stop: string; displayName: string; color: string }

// ─── Storage helpers ──────────────────────────────────────────────────────────

function getFavorites(): Favorite[] {
    if (typeof window === "undefined") return []
    try {
        const raw: Array<{ stop: string; displayName: string; color?: string }> = JSON.parse(
            window.localStorage.getItem(localStorageKey) || "[]"
        )
        return raw.map((f, i) => ({
            ...f,
            color: f.color || FAVORITE_COLORS[i % FAVORITE_COLORS.length].value,
        }))
    } catch {
        return []
    }
}

function saveFavorites(favs: Favorite[]) {
    window.localStorage.setItem(localStorageKey, JSON.stringify(favs))
    window.dispatchEvent(new CustomEvent(FAVORITES_UPDATED_EVENT))
}

function isFavorited(stopName: string) {
    return getFavorites().some((f) => f.stop === stopName)
}

function makeDisplayName(stopName: string): string {
    // Take up to 18 chars, prefer to break at a word boundary
    if (stopName.length <= 18) return stopName
    const truncated = stopName.slice(0, 18)
    const lastSpace = truncated.lastIndexOf(" ")
    return lastSpace > 8 ? truncated.slice(0, lastSpace) : truncated
}

/** The saved stops, kept in sync with changes anywhere on the page. */
export function useFavorites() {
    const [favorites, setFavorites] = useState<Favorite[]>([])

    useEffect(() => {
        setFavorites(getFavorites())
        const handler = () => setFavorites(getFavorites())
        window.addEventListener(FAVORITES_UPDATED_EVENT, handler)
        return () => window.removeEventListener(FAVORITES_UPDATED_EVENT, handler)
    }, [])

    return favorites
}

// ─── Rename dialog ────────────────────────────────────────────────────────────

function RenameDialog({
    favorite,
    onOpenChange,
}: {
    favorite: Favorite | null
    onOpenChange: (open: boolean) => void
}) {
    const [value, setValue] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (favorite) setValue(favorite.displayName)
    }, [favorite])

    const commit = () => {
        if (!favorite) return
        const trimmed = value.trim().slice(0, 18)
        if (!trimmed) return onOpenChange(false)
        saveFavorites(
            getFavorites().map((f) => (f.stop === favorite.stop ? { ...f, displayName: trimmed } : f))
        )
        onOpenChange(false)
    }

    return (
        <Dialog open={!!favorite} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Rename saved stop</DialogTitle>
                </DialogHeader>
                <Input
                    ref={inputRef}
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commit()
                    }}
                    maxLength={18}
                    placeholder="Display name"
                />
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={commit}>Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ─── Shared menu (rename / colour / remove) ──────────────────────────────────

function FavoriteMenu({
    favorite,
    onRename,
    onReorder,
    triggerClassName,
}: {
    favorite: Favorite
    onRename: () => void
    onReorder?: () => void
    triggerClassName?: string
}) {
    const setColor = (color: string) => {
        saveFavorites(getFavorites().map((f) => (f.stop === favorite.stop ? { ...f, color } : f)))
    }

    const remove = () => {
        saveFavorites(getFavorites().filter((f) => f.stop !== favorite.stop))
        toast.success("Removed from saved stops")
    }

    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <button
                    aria-label={`Options for ${favorite.displayName}`}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                        "flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors shrink-0",
                        triggerClassName
                    )}
                >
                    <MoreVertical className="w-3.5 h-3.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onRename}>
                    <Pencil className="w-3.5 h-3.5" />
                    Rename
                </DropdownMenuItem>
                {onReorder && (
                    <DropdownMenuItem onSelect={onReorder}>
                        <ArrowUpDown className="w-3.5 h-3.5" />
                        Reorder
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">Colour</DropdownMenuLabel>
                <div className="flex flex-wrap gap-1.5 px-2 py-1.5">
                    {FAVORITE_COLORS.map((c) => (
                        <button
                            key={c.value}
                            aria-label={c.name}
                            onClick={() => setColor(c.value)}
                            className={cn(
                                "w-5 h-5 rounded-full transition-transform hover:scale-110 flex items-center justify-center",
                                favorite.color === c.value && "ring-2 ring-offset-1 ring-offset-popover ring-foreground/50"
                            )}
                            style={{ background: c.value }}
                        />
                    ))}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={remove}
                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove from saved
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

// ─── Home: saved stops ────────────────────────────────────────────────────────

/** Saves a stop from somewhere other than its board (e.g. a nearby stop's menu). */
export function saveStop(stopName: string, displayName?: string) {
    const current = getFavorites()
    if (current.some((f) => f.stop === stopName)) return
    const color = FAVORITE_COLORS[current.length % FAVORITE_COLORS.length].value
    const entry = { stop: stopName, displayName: displayName ? makeDisplayName(displayName) : makeDisplayName(stopName), color }
    saveFavorites(current.length >= MAX_FAVORITES ? [...current.slice(1), entry] : [...current, entry])
    toast.success("Saved to Schedule")
}

export function useIsSaved(stopName: string) {
    const favorites = useFavorites()
    return favorites.some((f) => f.stop === stopName)
}

/**
 * Schedule's "Saved stops" - one row per stop with its next departures (the
 * iOS Home section). Rename / colour / reorder / remove from each row's
 * menu; "Edit" opens the list for dragging into order.
 */
export default function SavedStopsSection({ className }: { className?: string }) {
    const favorites = useFavorites()
    const [renaming, setRenaming] = useState<Favorite | null>(null)
    const [managing, setManaging] = useState(false)

    return (
        <HomeSection
            title="Saved stops"
            count={favorites.length}
            className={className}
            actions={favorites.length > 0 && <button type="button" onClick={() => setManaging(true)}>Edit</button>}
        >
            {favorites.length === 0 ? (
                <HomeHint icon={Star} text="Tap the star on any stop to keep its departures here." />
            ) : (
                <div className="flex flex-col gap-2.5">
                    {favorites.map((fav) => (
                        <HomeStopRow
                            key={fav.stop}
                            stopQuery={fav.stop}
                            title={fav.displayName}
                            href={`/?s=${encodeURIComponent(fav.stop)}`}
                            tile={<FavouriteTile color={fav.color} />}
                            menu={
                                <FavoriteMenu
                                    favorite={fav}
                                    onRename={() => setRenaming(fav)}
                                    onReorder={() => setManaging(true)}
                                    triggerClassName="h-8 w-8"
                                />
                            }
                        />
                    ))}
                </div>
            )}
            <RenameDialog favorite={renaming} onOpenChange={(open) => !open && setRenaming(null)} />
            <ManageSavedStopsDialog open={managing} onOpenChange={setManaging} />
        </HomeSection>
    )
}

function ManageSavedStopsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const favorites = useFavorites()
    const [order, setOrder] = useState<Favorite[]>([])
    const orderRef = useRef<Favorite[]>([])

    useEffect(() => setOrder(favorites), [favorites])
    useEffect(() => { orderRef.current = order }, [order])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Saved stops</DialogTitle>
                </DialogHeader>
                {order.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No saved stops.</p>
                ) : (
                    <Reorder.Group as="ul" axis="y" values={order} onReorder={setOrder} className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
                        {order.map((fav) => (
                            <ManageRow key={fav.stop} favorite={fav} onDragEnd={() => saveFavorites(orderRef.current)} />
                        ))}
                    </Reorder.Group>
                )}
                <DialogFooter>
                    <Button onClick={() => onOpenChange(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function ManageRow({ favorite, onDragEnd }: { favorite: Favorite; onDragEnd: () => void }) {
    const controls = useDragControls()
    return (
        <Reorder.Item
            value={favorite}
            dragListener={false}
            dragControls={controls}
            onDragEnd={onDragEnd}
            className="flex select-none items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5"
        >
            <button
                type="button"
                onPointerDown={(e) => controls.start(e)}
                aria-label={`Drag ${favorite.displayName} to reorder`}
                className="flex h-8 w-6 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
            >
                <GripVertical className="h-4 w-4" />
            </button>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: favorite.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm">{favorite.displayName}</span>
            <button
                type="button"
                aria-label={`Remove ${favorite.displayName}`}
                onClick={() => {
                    saveFavorites(getFavorites().filter((f) => f.stop !== favorite.stop))
                    toast.success("Removed from saved stops")
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
                <Trash2 className="h-4 w-4" />
            </button>
        </Reorder.Item>
    )
}

// ─── Add / remove button ──────────────────────────────────────────────────────

export function AddToFavorites({ stopName, className }: { stopName: string; className?: string }) {
    const [favorited, setFavorited] = useState(false)

    useEffect(() => {
        setFavorited(isFavorited(stopName))
        const handler = () => setFavorited(isFavorited(stopName))
        window.addEventListener(FAVORITES_UPDATED_EVENT, handler)
        return () => window.removeEventListener(FAVORITES_UPDATED_EVENT, handler)
    }, [stopName])

    const handleToggle = () => {
        const current = getFavorites()

        if (current.some((f) => f.stop === stopName)) {
            saveFavorites(current.filter((f) => f.stop !== stopName))
            setFavorited(false)
            toast.success("Removed from saved stops")
            return
        }

        const displayName = makeDisplayName(stopName)
        const color = FAVORITE_COLORS[current.length % FAVORITE_COLORS.length].value
        let updated: Favorite[]

        if (current.length >= MAX_FAVORITES) {
            // Replace the oldest (first in array)
            updated = [...current.slice(1), { stop: stopName, displayName, color }]
            toast.success("Saved to Schedule", {
                description: `Replaced "${current[0].displayName}"`,
            })
        } else {
            updated = [...current, { stop: stopName, displayName, color }]
            toast.success("Saved to Schedule")
        }

        saveFavorites(updated)
        setFavorited(true)
    }

    return (
        <Button
            aria-label={favorited ? "Remove from saved stops" : "Save stop"}
            aria-pressed={favorited}
            onClick={handleToggle}
            disabled={!stopName}
            variant="ghost"
            size="icon"
            className={cn("flex-shrink-0", className)}
        >
            <Star
                className={`w-4 h-4 transition-colors ${favorited ? "fill-yellow-500 text-yellow-500" : "text-foreground"}`}
            />
        </Button>
    )
}
