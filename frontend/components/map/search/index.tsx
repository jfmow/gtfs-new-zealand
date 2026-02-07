'use client'

import { useEffect, useState, useRef } from "react"
import { SearchInput } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, Clock, X } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { ApiFetch } from "@/lib/url-context"

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
    storageKey: string // For recent searches
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

    const MAX_RECENT = 5

    // Load recent searches from localStorage
    useEffect(() => {
        const saved = localStorage.getItem(storageKey)
        if (saved) setRecentSearches(JSON.parse(saved))
    }, [storageKey])

    // Fetch autocomplete
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

    // Handle outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    // Save to recent
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
    }

    return (
        <div className="relative w-full" ref={searchRef}>
            <div className="flex flex-wrap items-center gap-2">
                <SearchInput
                    value={value?.label || searchTerm}
                    className="min-w-0 flex-1"
                    placeholder={placeholder}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onFocus={() => {
                        if (!searchTerm && recentSearches.length) {
                            setShowRecent(true)
                            setIsOpen(true)
                        } else if (searchTerm.length >= 2) setIsOpen(true)
                    }}
                />
                {value && (
                    <Button variant="ghost" size="icon" onClick={handleClear}>
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </div>
            {(onSelectFromMap || onUseCurrentLocation) && (
                <div className="mt-2 flex flex-wrap gap-2">
                    {onSelectFromMap && (
                        <Button type="button" variant="outline" size="sm" onClick={onSelectFromMap}>
                            <span className="whitespace-normal text-left leading-snug">Select on map</span>
                        </Button>
                    )}
                    {onUseCurrentLocation && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onUseCurrentLocation}
                            disabled={isLocating}
                        >
                            <span className="whitespace-normal text-left leading-snug">
                                {isLocating ? "Locating..." : "Use current location"}
                            </span>
                        </Button>
                    )}
                </div>
            )}

            {isOpen && (
                <div className="absolute z-50 mt-1 bg-background rounded-md shadow-lg border w-full max-w-full">
                    <ScrollArea className="h-[200px] rounded-md">
                        {isLoading ? (
                            <div className="flex items-center justify-center h-full">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : showRecent && recentSearches.length ? (
                            <ul className="p-2 space-y-1">
                                <h3 className="text-sm font-medium text-muted-foreground px-2 py-1">
                                    Recent Searches
                                </h3>
                                {recentSearches.map((item) => (
                                    <li key={item.id}>
                                        <Button
                                            variant="ghost"
                                            className="w-full justify-start text-left font-normal"
                                            onClick={() => handleSelectRecent(item)}
                                        >
                                            <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
                                            <span className="truncate">{item.label}</span>
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        ) : results.length ? (
                            <ul className="p-2 space-y-1">
                                {results.map((item) => (
                                    <li key={item.id}>
                                        <Button
                                            variant="ghost"
                                            className="w-full justify-start text-left font-normal"
                                            onClick={() => handleSelect(item)}
                                        >
                                            <span className="truncate">{item.label}</span>
                                            <span className="ml-auto text-xs text-muted-foreground">
                                                {item.type}
                                            </span>
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        ) : searchTerm.length >= 2 ? (
                            <p className="text-center text-sm text-muted-foreground p-4">
                                No results found
                            </p>
                        ) : (
                            <p className="text-center text-sm text-muted-foreground p-4">
                                Type at least 2 characters to search
                            </p>
                        )}
                    </ScrollArea>
                </div>
            )}
        </div>
    )
}
