import type React from "react"
import { Star, TriangleAlert } from "lucide-react"
import { Button } from "../ui/button"
import { toast } from "sonner"
import { useEffect, useState, useRef } from "react"
import Router from "next/router"

const localStorageKey = "favorites"
const FAVORITES_UPDATED_EVENT = "favoritesUpdated"

export default function Favorites() {
    const [favorites, setFavorites] = useState<{ stop: string, displayName: string }[]>([])
    const dragItem = useRef<number | null>(null)
    const dragOverItem = useRef<number | null>(null)

    useEffect(() => {
        setFavorites(getFavorites())

        const handleFavoritesUpdated = () => {
            setFavorites(getFavorites())
        }

        window.addEventListener(FAVORITES_UPDATED_EVENT, handleFavoritesUpdated)

        return () => {
            window.removeEventListener(FAVORITES_UPDATED_EVENT, handleFavoritesUpdated)
        }
    }, [])

    const handleDragStart = (index: number) => {
        dragItem.current = index
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
    }

    const handleDragEnter = (index: number) => {
        dragOverItem.current = index
    }

    const handleDrop = () => {
        if (dragItem.current === null || dragOverItem.current === null) return

        // Create a copy of the favorites array
        const newFavorites = [...favorites]

        // Remove the dragged item
        const draggedItem = newFavorites[dragItem.current]
        newFavorites.splice(dragItem.current, 1)

        // Insert the dragged item at the new position
        newFavorites.splice(dragOverItem.current, 0, draggedItem)

        // Update state and localStorage
        setFavorites(newFavorites)
        window.localStorage.setItem(localStorageKey, JSON.stringify(newFavorites))

        // Reset refs
        dragItem.current = null
        dragOverItem.current = null

        // Dispatch event to notify other components
        const event = new CustomEvent(FAVORITES_UPDATED_EVENT)
        window.dispatchEvent(event)
    }

    return (
        <div className="flex flex-wrap gap-2 items-center w-full">
            {favorites.length > 0 ? (
                <>
                    {favorites.map((favorite, index) => (
                        <Button
                            size={"sm"}
                            variant={"outline"}
                            key={index}
                            className="w-full sm:w-auto active:cursor-grabbing min-w-[200px]"
                            onClick={() => Router.push(`/?s=${favorite.stop}`)}
                            draggable
                            onDragStart={() => handleDragStart(index)}
                            onDragOver={handleDragOver}
                            onDragEnter={() => handleDragEnter(index)}
                            onDrop={handleDrop}
                            onDragEnd={handleDrop}
                        >
                            {favorite.displayName}
                        </Button>
                    ))}
                </>
            ) : (
                <div className="flex flex-col w-full text-gray-500 items-center gap-1 justify-center">
                    <TriangleAlert className="w-4 h-4 !rotate-0" />
                    <p className="text-sm">No favorites added yet.</p>
                </div>
            )}
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
            const customName = prompt("Enter a name for the stop:", stopName) || ""
            favorites.push({ stop: stopName, displayName: customName !== "" ? customName : stopName }) // Initialize with the same name
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
        <Button onClick={() => handleAddToFavorites()} disabled={stopName === ""} variant={"outline"}>
            {isFavorited ? <Star className="fill-yellow-500 text-yellow-500" /> : <Star className="text-yellow-500" />}
        </Button>
    )
}
