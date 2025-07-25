import type React from "react"
import { Star, TriangleAlert } from "lucide-react"
import { Button } from "../ui/button"
import { toast } from "sonner"
import { useEffect, useState } from "react"
import Link from "next/link"

const localStorageKey = "favorites"
const FAVORITES_UPDATED_EVENT = "favoritesUpdated"

export default function Favorites({ grid, onClick }: { grid?: boolean, onClick?: (stop: string) => void }) {
    const [favorites, setFavorites] = useState<{ stop: string; displayName: string }[]>([])

    useEffect(() => {
        const storedFavorites = getFavorites()
        setFavorites(storedFavorites)

        // Optional: Listen for updates across components
        const updateFavorites = () => {
            setFavorites(getFavorites())
        }
        window.addEventListener(FAVORITES_UPDATED_EVENT, updateFavorites)

        return () => {
            window.removeEventListener(FAVORITES_UPDATED_EVENT, updateFavorites)
        }
    }, [])

    return (
        <div role="tablist" aria-label="Favorite stops" className={`flex flex-nowrap gap-2 items-center w-full overflow-x-auto p-1 ${grid ? 'grid grid-cols-2 gap-2' : ''}`}>
            {
                favorites.length > 0 ? (
                    favorites.map((favorite) => (
                        <Link
                            key={favorite.stop}
                            role="tab"
                            aria-selected="false"
                            tabIndex={0}
                            href={`/?s=${favorite.stop}`}
                            onClick={() => {
                                if (onClick) {
                                    onClick(favorite.stop)
                                }
                            }}
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
                )
            }
        </div>
    )
}

function checkIfStopFavourited(stopName: string): boolean {
    const favorites = getFavorites()
    if (favorites.length === 0) {
        return false
    }
    return favorites.some(fav => fav.stop === stopName)
}

function getFavorites(): { stop: string, displayName: string }[] {
    if (typeof window === "undefined") {
        return []
    }

    return JSON.parse(window.localStorage.getItem(localStorageKey) || "[]")
}

export function AddToFavorites({ stopName }: { stopName: string }) {
    const [isFavorited, setIsFavorited] = useState<boolean>(false)

    useEffect(() => {
        setIsFavorited(checkIfStopFavourited(stopName))
    }, [stopName])

    function handleAddToFavorites() {
        const favorites = getFavorites()

        if (!favorites.some(fav => fav.stop === stopName)) {
            let customName = ""
            while (true) {
                const input = prompt("Enter a name for the stop (max 10 characters):", stopName)
                if (input === null) {
                    // User cancelled prompt, do nothing
                    return
                }
                customName = input
                if (customName.length <= 10) break
                alert("Name too long. Please enter a name with 10 characters or fewer.")
            }
            favorites.push({ stop: stopName, displayName: customName !== "" ? customName : stopName })
            window.localStorage.setItem(localStorageKey, JSON.stringify(favorites))
            toast.success(`${stopName} added to favorites`)
            setIsFavorited(true)
        } else {
            const updatedFavorites = favorites.filter((fav: { stop: string }) => fav.stop !== stopName)
            window.localStorage.setItem(localStorageKey, JSON.stringify(updatedFavorites))
            toast.success(`${stopName} removed from favorites`)
            setIsFavorited(false)
        }
        const event = new CustomEvent(FAVORITES_UPDATED_EVENT)
        window.dispatchEvent(event)
    }

    return (
        <Button aria-label="Favorite current stop toggle" onClick={() => handleAddToFavorites()} disabled={stopName === ""} variant={"outline"}>
            {isFavorited ? <Star className="fill-yellow-500 text-yellow-500" /> : <Star className="text-yellow-500" />}
        </Button>
    )
}
