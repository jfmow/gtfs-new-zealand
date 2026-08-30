"use client"

import React, { useEffect, useRef, useState } from "react"
import { Reorder, useDragControls } from "framer-motion"
import { Star, GripVertical, MoreVertical, Pencil, Trash2, Loader2 } from "lucide-react"
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
import Link from "next/link"
import { cn } from "@/lib/utils"
import { timeTillArrivalString } from "@/lib/formating"
import { useNextDepartures } from "../home/stop-preview-card"

const localStorageKey = "favorites"
const FAVORITES_UPDATED_EVENT = "favoritesUpdated"
const MAX_FAVORITES = 8

const FAVORITE_COLORS = [
    { name: "Amber", value: "#f59e0b" },
    { name: "Rose", value: "#f43f5e" },
    { name: "Sky", value: "#0ea5e9" },
    { name: "Emerald", value: "#10b981" },
    { name: "Violet", value: "#8b5cf6" },
    { name: "Orange", value: "#f97316" },
    { name: "Cyan", value: "#06b6d4" },
    { name: "Fuchsia", value: "#d946ef" },
]

type Favorite = { stop: string; displayName: string; color: string }

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

function useFavorites() {
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
                    <DialogTitle>Rename favourite</DialogTitle>
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
    triggerClassName,
}: {
    favorite: Favorite
    onRename: () => void
    triggerClassName?: string
}) {
    const setColor = (color: string) => {
        saveFavorites(getFavorites().map((f) => (f.stop === favorite.stop ? { ...f, color } : f)))
    }

    const remove = () => {
        saveFavorites(getFavorites().filter((f) => f.stop !== favorite.stop))
        toast.success("Removed from favourites")
    }

    return (
        <DropdownMenu>
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
                    Remove
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

// ─── Compact chip (used in the mobile nav drawer) ────────────────────────────

export function FavoritesChips({ onClick }: { onClick?: () => void }) {
    const favorites = useFavorites()
    const [renaming, setRenaming] = useState<Favorite | null>(null)

    if (favorites.length === 0) {
        return (
            <p className="text-xs text-muted-foreground py-1">
                No favourites yet — star a stop to save it here.
            </p>
        )
    }

    return (
        <>
            <div className="flex flex-wrap gap-1.5">
                {favorites.map((fav) => (
                    <div
                        key={fav.stop}
                        className="group flex items-center gap-1 pl-2.5 pr-1 py-1.5 rounded-full bg-muted hover:bg-accent transition-colors text-xs shrink-0"
                    >
                        <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: fav.color }}
                            aria-hidden
                        />
                        <Link
                            href={`/?s=${encodeURIComponent(fav.stop)}`}
                            onClick={onClick}
                            className="font-medium text-foreground leading-none"
                        >
                            {fav.displayName}
                        </Link>
                        <FavoriteMenu
                            favorite={fav}
                            onRename={() => setRenaming(fav)}
                            triggerClassName="w-5 h-5 ml-0.5"
                        />
                    </div>
                ))}
            </div>
            <RenameDialog favorite={renaming} onOpenChange={(open) => !open && setRenaming(null)} />
        </>
    )
}

// ─── Rich cards (used on the home page) ──────────────────────────────────────

function FavoriteCard({
    favorite,
    onRename,
    onDragEnd,
}: {
    favorite: Favorite
    onRename: () => void
    onDragEnd: () => void
}) {
    const controls = useDragControls()
    const { services, error } = useNextDepartures(favorite.stop, 1)
    const next = services && services.length > 0 ? services[0] : null

    return (
        <Reorder.Item
            value={favorite}
            dragListener={false}
            dragControls={controls}
            onDragEnd={onDragEnd}
            as="li"
            className="relative shrink-0 w-[190px] snap-start rounded-lg border border-border bg-card select-none"
            style={{ borderLeft: `3px solid ${favorite.color}` }}
        >
            <Link
                href={`/?s=${encodeURIComponent(favorite.stop)}`}
                className="absolute inset-0 z-0 rounded-lg"
                aria-label={favorite.displayName}
            />

            <div className="relative z-10 pointer-events-none flex flex-col gap-2 p-3 pr-7">
                <div className="flex items-center gap-1.5 min-w-0">
                    <Star className="w-3 h-3 shrink-0" style={{ color: favorite.color, fill: favorite.color }} />
                    <span className="text-sm font-medium truncate">{favorite.displayName}</span>
                </div>

                {services === null && !error && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Loading...
                    </div>
                )}

                {error && <p className="text-xs text-muted-foreground">Couldn&apos;t load departures</p>}

                {services && services.length === 0 && (
                    <p className="text-xs text-muted-foreground">No upcoming services</p>
                )}

                {next && (
                    <div className="flex items-center gap-1.5 text-xs min-w-0">
                        <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-white dark:text-gray-100 font-display font-medium"
                            style={{
                                background: "#" + (next.route.color !== "" ? next.route.color : "000000"),
                                filter: "brightness(0.9) contrast(1.1)",
                            }}
                        >
                            {next.route.name}
                        </span>
                        <span className="truncate text-foreground">{next.headsign}</span>
                        <span className="ml-auto font-mono tabular-nums text-muted-foreground shrink-0">
                            {timeTillArrivalString(next.arrival_time)}
                        </span>
                    </div>
                )}
            </div>

            <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-0.5">
                <FavoriteMenu favorite={favorite} onRename={onRename} triggerClassName="w-6 h-6" />
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

export default function Favorites() {
    const favorites = useFavorites()
    const [order, setOrder] = useState<Favorite[]>([])
    const [renaming, setRenaming] = useState<Favorite | null>(null)
    const orderRef = useRef<Favorite[]>([])

    useEffect(() => setOrder(favorites), [favorites])
    useEffect(() => {
        orderRef.current = order
    }, [order])

    if (favorites.length === 0) {
        return (
            <p className="text-xs text-muted-foreground py-1">
                No favourites yet — star a stop to save it here.
            </p>
        )
    }

    return (
        <>
            <Reorder.Group
                as="ul"
                axis="x"
                values={order}
                onReorder={setOrder}
                className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-0.5 px-0.5 list-none"
            >
                {order.map((fav) => (
                    <FavoriteCard
                        key={fav.stop}
                        favorite={fav}
                        onRename={() => setRenaming(fav)}
                        onDragEnd={() => saveFavorites(orderRef.current)}
                    />
                ))}
            </Reorder.Group>
            <RenameDialog favorite={renaming} onOpenChange={(open) => !open && setRenaming(null)} />
        </>
    )
}

// ─── Add / remove button ──────────────────────────────────────────────────────

export function AddToFavorites({ stopName }: { stopName: string }) {
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
            toast.success("Removed from favourites")
            return
        }

        const displayName = makeDisplayName(stopName)
        const color = FAVORITE_COLORS[current.length % FAVORITE_COLORS.length].value
        let updated: Favorite[]

        if (current.length >= MAX_FAVORITES) {
            // Replace the oldest (first in array)
            updated = [...current.slice(1), { stop: stopName, displayName, color }]
            toast.success("Added to favourites", {
                description: `Replaced "${current[0].displayName}"`,
            })
        } else {
            updated = [...current, { stop: stopName, displayName, color }]
            toast.success("Added to favourites")
        }

        saveFavorites(updated)
        setFavorited(true)
    }

    return (
        <Button
            aria-label={favorited ? "Remove from favourites" : "Add to favourites"}
            onClick={handleToggle}
            disabled={!stopName}
            variant="outline"
            size="icon"
            className="flex-shrink-0"
        >
            <Star
                className={`w-4 h-4 transition-colors ${favorited ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground"
                    }`}
            />
        </Button>
    )
}
