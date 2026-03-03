'use client'

import { useEffect, useState, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, Clock, X, MapPin, Navigation } from 'lucide-react'
import { ApiFetch } from "@/lib/url-context"
import { cn } from "@/lib/utils"

export interface LocationAutocompleteResult {
    id: number
    label: string
    lat: number
    lon: number
    type: string
    importance: number
    boundingBox?: string[]
}

interface LocationSearchInputProps {
    placeholder: string
    value?: { lat: number; lon: number; label: string } | null
    onSelect: (location: { lat: number; lon: number; label: string } | null) => void
    storageKey: string
    onSelectFromMap?: () => void
    onUseCurrentLocation?: () => void
    isLocating?: boolean
}

export function LocationSearchInput({
    placeholder,
    value,
    onSelect,
    storageKey,
    onSelectFromMap,
    onUseCurrentLocation,
    isLocating,
}: LocationSearchInputProps) {
    const [searchTerm, setSearchTerm] = useState("")
    const [results, setResults] = useState<LocationAutocompleteResult[]>([])
    const [recentSearches, setRecentSearches] = useState<LocationAutocompleteResult[]>([])
    const [isOpen, setIsOpen] = useState(false)
    const [showRecent, setShowRecent] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const searchRef = useRef<HTMLDivElement>(null)
    const skipSearchRef = useRef(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const MAX_RECENT = 5

    useEffect(() => {
        const saved = localStorage.getItem(storageKey)
        if (saved) setRecentSearches(JSON.parse(saved))
    }, [storageKey])

    useEffect(() => {
        if (skipSearchRef.current) {
            skipSearchRef.current = false
            return
        }

        if (!searchTerm || searchTerm.length < 2) {
            setResults([])
            setShowRecent(searchTerm.length === 0 && recentSearches.length > 0)
            return
        }

        const controller = new AbortController()
        setIsLoading(true)
        const timeout = setTimeout(async () => {
            try {
                const response = await ApiFetch<LocationAutocompleteResult[]>(
                    `/map/search?q=${encodeURIComponent(searchTerm)}&limit=5`,
                    { signal: controller.signal }
                )
                if (response.ok) {
                    setResults(response.data)
                    setShowRecent(false)
                } else {
                    setResults([])
                }
            } catch (err) {
                console.error(err)
            } finally {
                setIsLoading(false)
                setIsOpen(true)
            }
        }, 300)

        return () => {
            clearTimeout(timeout)
            controller.abort()
        }
    }, [searchTerm, recentSearches])

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const saveRecent = (item: LocationAutocompleteResult) => {
        setRecentSearches(prev => {
            const filtered = prev.filter(r => r.id !== item.id)
            const newRecent = [item, ...filtered].slice(0, MAX_RECENT)
            localStorage.setItem(storageKey, JSON.stringify(newRecent))
            return newRecent
        })
    }

    const handleSelect = (item: LocationAutocompleteResult) => {
        skipSearchRef.current = true
        setSearchTerm(item.label)
        onSelect({ lat: item.lat, lon: item.lon, label: item.label })
        setIsOpen(false)
        saveRecent(item)
    }

    const handleSelectRecent = (item: LocationAutocompleteResult) => {
        skipSearchRef.current = true
        setSearchTerm(item.label)
        onSelect({ lat: item.lat, lon: item.lon, label: item.label })
        setIsOpen(false)
    }

    const handleClear = () => {
        onSelect(null)
        setSearchTerm("")
        inputRef.current?.focus()
    }

    const displayValue = value?.label || searchTerm

    return (
        <div className="relative w-full" ref={searchRef}>
            <div className="relative flex items-center">
                <input
                    ref={inputRef}
                    value={displayValue}
                    placeholder={placeholder}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onFocus={() => {
                        if (!searchTerm) {
                            setShowRecent(recentSearches.length > 0)
                            setIsOpen(true)
                        } else if (searchTerm.length >= 2) {
                            setIsOpen(true)
                        }
                    }}
                    className={cn(
                        "flex h-10 w-full rounded-lg border border-input bg-background px-3 pr-8 text-sm transition-colors",
                        "placeholder:text-muted-foreground",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                        "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                />
                {value && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="absolute right-2 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Clear location"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            {isOpen && (
                <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover shadow-lg overflow-hidden">
                    <ScrollArea className="max-h-[220px]">
                        {/* show buttons before any results/recents when searchTerm is empty */}
                        {searchTerm.length === 0 && (onUseCurrentLocation || onSelectFromMap) && (
                            <ul className="py-1 border-b">
                                {onUseCurrentLocation && (
                                    <li>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onUseCurrentLocation()
                                                setIsOpen(false)
                                            }}
                                            disabled={isLocating}
                                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
                                        >
                                            <Navigation className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            <span className="truncate">
                                                {isLocating ? "Locating..." : "My location"}
                                            </span>
                                        </button>
                                    </li>
                                )}
                                {onSelectFromMap && (
                                    <li>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onSelectFromMap()
                                                setIsOpen(false)
                                            }}
                                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
                                        >
                                            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            <span className="truncate">Pick on map</span>
                                        </button>
                                    </li>
                                )}
                            </ul>
                        )}

                        {isLoading ? (
                            <div className="flex items-center justify-center py-6">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : showRecent && recentSearches.length ? (
                            <ul className="py-1">
                                <li className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                                    Recent
                                </li>
                                {recentSearches.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
                                            onClick={() => handleSelectRecent(item)}
                                        >
                                            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            <span className="truncate">{item.label}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : results.length ? (
                            <ul className="py-1">
                                {results.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
                                            onClick={() => handleSelect(item)}
                                        >
                                            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            <span className="truncate flex-1">{item.label}</span>
                                            <span className="text-[11px] text-muted-foreground shrink-0">
                                                {item.type}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : searchTerm.length >= 2 ? (
                            <p className="text-center text-sm text-muted-foreground py-6">
                                No results found
                            </p>
                        ) : null}
                    </ScrollArea>
                </div>
            )}
        </div>
    )
}
