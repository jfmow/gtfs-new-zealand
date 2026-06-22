"use client"

import React, { useEffect, useRef, useState } from "react"
import { Star, X, Check } from "lucide-react"
import { Button } from "../ui/button"
import { toast } from "sonner"
import Link from "next/link"

const localStorageKey = "favorites"
const FAVORITES_UPDATED_EVENT = "favoritesUpdated"
const MAX_FAVORITES = 8

type Favorite = { stop: string; displayName: string }

// ─── Storage helpers ──────────────────────────────────────────────────────────

function getFavorites(): Favorite[] {
    if (typeof window === "undefined") return []
    try {
        return JSON.parse(window.localStorage.getItem(localStorageKey) || "[]")
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

// ─── Favorites list ───────────────────────────────────────────────────────────

export default function Favorites({
    onClick,
}: {
    onClick?: () => void
}) {
    const [favorites, setFavorites] = useState<Favorite[]>([])
    const [editingStop, setEditingStop] = useState<string | null>(null)
    const [editValue, setEditValue] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        setFavorites(getFavorites())
        const handler = () => setFavorites(getFavorites())
        window.addEventListener(FAVORITES_UPDATED_EVENT, handler)
        return () => window.removeEventListener(FAVORITES_UPDATED_EVENT, handler)
    }, [])

    useEffect(() => {
        if (editingStop && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [editingStop])

    const startEditing = (fav: Favorite, e: React.MouseEvent) => {
        e.preventDefault()
        setEditingStop(fav.stop)
        setEditValue(fav.displayName)
    }

    const commitEdit = (stop: string) => {
        const trimmed = editValue.trim().slice(0, 18)
        if (!trimmed) return cancelEdit()
        const updated = getFavorites().map((f) =>
            f.stop === stop ? { ...f, displayName: trimmed } : f
        )
        saveFavorites(updated)
        setFavorites(updated)
        setEditingStop(null)
    }

    const cancelEdit = () => setEditingStop(null)

    const remove = (stop: string, e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const updated = getFavorites().filter((f) => f.stop !== stop)
        saveFavorites(updated)
        setFavorites(updated)
        toast.success("Removed from favourites")
    }

    if (favorites.length === 0) {
        return (
            <p className="text-xs text-muted-foreground py-1">
                No favourites yet — star a stop to save it here.
            </p>
        )
    }

    return (
        <div className="flex flex-wrap gap-1.5">
            {favorites.map((fav) =>
                editingStop === fav.stop ? (
                    <div
                        key={fav.stop}
                        className="flex items-center gap-1 pl-2 pr-1 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs"
                    >
                        <input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") commitEdit(fav.stop)
                                if (e.key === "Escape") cancelEdit()
                            }}
                            onBlur={() => commitEdit(fav.stop)}
                            maxLength={18}
                            className="bg-transparent outline-none text-foreground font-medium w-24"
                        />
                        <button
                            onMouseDown={(e) => { e.preventDefault(); commitEdit(fav.stop) }}
                            className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-primary/20"
                        >
                            <Check className="w-2.5 h-2.5 text-primary" />
                        </button>
                    </div>
                ) : (
                    <div
                        key={fav.stop}
                        className="group flex items-center gap-1 pl-2.5 pr-1 py-1.5 rounded-full bg-muted hover:bg-accent transition-colors text-xs shrink-0"
                    >
                        <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 shrink-0" />
                        <Link
                            href={`/?s=${encodeURIComponent(fav.stop)}`}
                            onClick={onClick}
                            className="font-medium text-foreground leading-none"
                        >
                            {fav.displayName}
                        </Link>
                        <button
                            onDoubleClick={(e) => startEditing(fav, e)}
                            onClick={(e) => remove(fav.stop, e)}
                            title="Click to remove · Double-click to rename"
                            className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-foreground/10 ml-0.5 transition-colors shrink-0"
                        >
                            <X className="w-2.5 h-2.5 text-muted-foreground" />
                        </button>
                    </div>
                )
            )}
        </div>
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
        let updated: Favorite[]

        if (current.length >= MAX_FAVORITES) {
            // Replace the oldest (first in array)
            updated = [...current.slice(1), { stop: stopName, displayName }]
            toast.success("Added to favourites", {
                description: `Replaced "${current[0].displayName}"`,
            })
        } else {
            updated = [...current, { stop: stopName, displayName }]
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
