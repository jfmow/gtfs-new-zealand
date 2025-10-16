"use client"

import React, { useEffect, useState } from "react"
import { Star, TriangleAlert } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "../ui/dialog"
import { toast } from "sonner"
import Link from "next/link"

const localStorageKey = "favorites"
const FAVORITES_UPDATED_EVENT = "favoritesUpdated"
const MAX_FAVORITES = 4

// ----------------------------
// FAVORITES LIST
// ----------------------------
export default function Favorites({
    grid,
    onClick,
}: {
    grid?: boolean
    onClick?: (stop: string) => void
}) {
    const [favorites, setFavorites] = useState<{ stop: string; displayName: string }[]>([])

    useEffect(() => {
        const storedFavorites = getFavorites()
        setFavorites(storedFavorites)

        const updateFavorites = () => {
            setFavorites(getFavorites())
        }
        window.addEventListener(FAVORITES_UPDATED_EVENT, updateFavorites)
        return () => {
            window.removeEventListener(FAVORITES_UPDATED_EVENT, updateFavorites)
        }
    }, [])

    return (
        <div
            role="tablist"
            aria-label="Favorite stops"
            className={`flex flex-nowrap gap-2 items-center w-full overflow-x-auto p-1 ${grid ? "grid grid-cols-2 gap-2" : ""
                }`}
        >
            {favorites.length > 0 ? (
                favorites.map((favorite) => (
                    <Link
                        key={favorite.stop}
                        role="tab"
                        aria-selected="false"
                        tabIndex={0}
                        href={`/?s=${favorite.stop}`}
                        onClick={() => onClick?.(favorite.stop)}
                        className="text-xs text-nowrap text-center p-2 rounded bg-muted text-muted-foreground w-full sm:w-auto cursor-pointer hover:bg-accent hover:text-accent-foreground transition-all"
                    >
                        {favorite.displayName}
                    </Link>
                ))
            ) : (
                <div className="flex flex-col w-full text-gray-500 items-center gap-1 justify-center">
                    <TriangleAlert className="w-4 h-4 !rotate-0" />
                    <p className="text-sm">No favorites added yet.</p>
                </div>
            )}
        </div>
    )
}

// ----------------------------
// FAVORITES LOGIC HELPERS
// ----------------------------
function getFavorites(): { stop: string; displayName: string }[] {
    if (typeof window === "undefined") return []
    return JSON.parse(window.localStorage.getItem(localStorageKey) || "[]")
}

function checkIfStopFavorited(stopName: string): boolean {
    const favorites = getFavorites()
    return favorites.some((fav) => fav.stop === stopName)
}

// ----------------------------
// ADD / REMOVE FAVORITE BUTTON
// ----------------------------
export function AddToFavorites({ stopName }: { stopName: string }) {
    const [isFavorited, setIsFavorited] = useState(false)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [replaceDialogOpen, setReplaceDialogOpen] = useState(false)
    const [customName, setCustomName] = useState(stopName)
    const [favorites, setFavorites] = useState<{ stop: string; displayName: string }[]>([])

    useEffect(() => {
        const favs = getFavorites()
        setFavorites(favs)
        setIsFavorited(checkIfStopFavorited(stopName))
    }, [stopName])

    const updateFavorites = (newFavs: { stop: string; displayName: string }[]) => {
        window.localStorage.setItem(localStorageKey, JSON.stringify(newFavs))
        window.dispatchEvent(new CustomEvent(FAVORITES_UPDATED_EVENT))
        setFavorites(newFavs)
    }

    const handleAddToFavorites = () => {
        const currentFavorites = getFavorites()

        // Remove if already favorited
        if (currentFavorites.some((fav) => fav.stop === stopName)) {
            const updated = currentFavorites.filter((fav) => fav.stop !== stopName)
            updateFavorites(updated)
            toast.success(`${stopName} removed from favorites`)
            setIsFavorited(false)
            return
        }

        // If full, show replace dialog
        if (currentFavorites.length >= MAX_FAVORITES) {
            toast.warning("Favorites full — select one to replace.")
            setReplaceDialogOpen(true)
            return
        }

        // Otherwise, open naming dialog
        setCustomName(stopName)
        setDialogOpen(true)
    }

    const confirmAdd = () => {
        const trimmedName = customName.trim().slice(0, 10)
        const newFav = {
            stop: stopName,
            displayName: trimmedName || stopName,
        }

        const updated = [...favorites, newFav]
        updateFavorites(updated)
        toast.success(`${stopName} added to favorites`)
        setIsFavorited(true)
        setDialogOpen(false)
    }

    const handleReplace = (stopToReplace: string) => {
        // Remove the selected favorite and open name input for new stop
        const updated = favorites.filter((fav) => fav.stop !== stopToReplace)
        updateFavorites(updated)

        // Prefill the new name to the new stop
        setCustomName(stopName)
        setReplaceDialogOpen(false)
        setDialogOpen(true)
    }

    return (
        <>
            {/* Star Toggle Button */}
            <Button
                aria-label="Favorite current stop toggle"
                onClick={handleAddToFavorites}
                disabled={!stopName}
                variant="outline"
            >
                {isFavorited ? (
                    <Star className="fill-yellow-500 text-yellow-500" />
                ) : (
                    <Star className="text-yellow-500" />
                )}
            </Button>

            {/* Name Input Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Set a name for this stop</DialogTitle>
                    </DialogHeader>

                    <Input
                        value={customName}
                        maxLength={10}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder="Enter name (max 10 chars)"
                    />

                    <DialogFooter>
                        <Button onClick={confirmAdd}>Save</Button>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Replace Favorite Dialog */}
            <Dialog open={replaceDialogOpen} onOpenChange={setReplaceDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Favorites Full</DialogTitle>
                        <p className="text-sm text-muted-foreground">
                            You can only have 4 favorites. Choose one to replace with{" "}
                            <span className="font-medium text-foreground">{stopName}</span>.
                        </p>
                    </DialogHeader>

                    <div className="flex flex-col gap-2 py-2">
                        {favorites.map((fav) => (
                            <Button
                                key={fav.stop}
                                variant="outline"
                                onClick={() => handleReplace(fav.stop)}
                            >
                                {fav.displayName}
                            </Button>
                        ))}
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setReplaceDialogOpen(false)}>
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
