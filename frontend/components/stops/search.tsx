import { useEffect, useState, useRef } from "react"
import { SearchInput } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, Clock, X } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { TrainsApiResponse } from "../services/types"
import { ApiFetch } from "@/lib/url-context"
import { useQueryParams } from "@/lib/url-params"

// Maximum number of recent searches to store
const MAX_RECENT_SEARCHES = 5

export default function SearchForStop() {
    const { selected_stop } = useQueryParams({ selected_stop: { type: "string", default: "", keys: ["s"] } })
    const [searchTerm, setSearchTerm] = useState("")
    const [result, setResult] = useState<StopSearch[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isOpen, setIsOpen] = useState(false)
    const [recentSearches, setRecentSearches] = useState<string[]>([])
    const [showRecent, setShowRecent] = useState(false)
    const searchRef = useRef<HTMLDivElement>(null)
    const skipSearchRef = useRef(false)

    // Load recent searches from localStorage on component mount
    useEffect(() => {
        const savedSearches = localStorage.getItem('recentStopSearches')
        if (savedSearches) {
            setRecentSearches(JSON.parse(savedSearches))
        }
    }, [])

    useEffect(() => {
        if (skipSearchRef.current) {
            skipSearchRef.current = false
            return
        }

        const delayDebounceFn = setTimeout(async () => {
            if (searchTerm.length >= 2) {
                setIsLoading(true)
                setError(null)
                const data = await searchForStop(searchTerm)
                if (data.error !== undefined) {
                    setError(data.error)
                    setResult([])
                } else {
                    setResult(data.result)
                }
                setIsLoading(false)
                setIsOpen(true)
                setShowRecent(false)
            } else {
                setResult([])
                setShowRecent(searchTerm.length === 0 && recentSearches.length > 0)
            }
        }, 300)

        return () => clearTimeout(delayDebounceFn)
    }, [searchTerm, recentSearches.length])

    useEffect(() => {
        if (selected_stop.found) {
            skipSearchRef.current = true
            setSearchTerm(selected_stop.value)
        }
    }, [selected_stop])

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [])

    // Save a search to recent searches
    const saveToRecentSearches = (search: string) => {
        setRecentSearches(prevSearches => {
            // Remove the search if it already exists to avoid duplicates
            const filteredSearches = prevSearches.filter(s => s !== search)
            // Add the new search to the beginning of the array
            const newSearches = [search, ...filteredSearches].slice(0, MAX_RECENT_SEARCHES)
            // Save to localStorage
            localStorage.setItem('recentStopSearches', JSON.stringify(newSearches))
            return newSearches
        })
    }

    // Remove a search from recent searches
    const removeFromRecentSearches = (search: string, e: React.MouseEvent) => {
        e.stopPropagation() // Prevent triggering the parent button click
        setRecentSearches(prevSearches => {
            const newSearches = prevSearches.filter(s => s !== search)
            localStorage.setItem('recentStopSearches', JSON.stringify(newSearches))
            return newSearches
        })
    }

    // Handle selecting a search result
    const handleSelectSearch = (item: StopSearch) => {
        skipSearchRef.current = true
        setSearchTerm(item.name)
        selected_stop.set(item.name)
        setIsOpen(false)
        saveToRecentSearches(item.name)
    }

    // Handle selecting a recent search
    const handleSelectRecentSearch = (search: string) => {
        skipSearchRef.current = true
        setSearchTerm(search)
        selected_stop.set(search)
        setIsOpen(false)
    }

    return (
        <div className="relative w-full" ref={searchRef}>
            <SearchInput
                value={searchTerm}
                className="w-full"
                onChange={(e) => {
                    if (e.target.value.length === 0 && recentSearches.length > 0 && isOpen) {
                        setShowRecent(true)
                    }
                    setSearchTerm(e.target.value)
                }}
                placeholder="Search for stop..."
                onFocus={() => {
                    if (searchTerm.length === 0 && recentSearches.length > 0) {
                        setShowRecent(true)
                        setIsOpen(true)
                    } else if (searchTerm.length >= 2) {
                        setIsOpen(true)
                    }
                }}
            />
            {isOpen && (
                <div className="absolute z-50 mt-1 bg-background rounded-md shadow-lg border w-[calc(100vw_-_2rem)] sm:w-full">
                    <ScrollArea className="h-[200px] rounded-md">
                        {isLoading ? (
                            <div className="flex items-center justify-center h-full">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : error ? (
                            <p className="text-center text-sm text-red-500 p-4">{error}</p>
                        ) : showRecent && recentSearches.length > 0 ? (
                            <div className="p-2">
                                <h3 className="text-sm font-medium text-muted-foreground px-2 py-1">Recent Searches</h3>
                                <ul className="space-y-1">
                                    {recentSearches.map((search) => (
                                        <li key={search}>
                                            <Button
                                                variant="ghost"
                                                className="w-full justify-start text-left font-normal group"
                                                onClick={() => handleSelectRecentSearch(search)}
                                            >
                                                <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
                                                <span className="truncate">{search}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="ml-auto h-6 w-6 sm:opacity-0 group-hover:opacity-100"
                                                    onClick={(e) => removeFromRecentSearches(search, e)}
                                                >
                                                    <X className="h-4 w-4" />
                                                    <span className="sr-only">Remove</span>
                                                </Button>
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : result.length > 0 ? (
                            <ul className="p-2 space-y-1">
                                {result.map((item) => (
                                    <li key={item.name}>
                                        <Button
                                            variant="ghost"
                                            className="w-full justify-start text-left font-normal"
                                            onClick={() => handleSelectSearch(item)}
                                        >
                                            <span className="truncate">{item.name}</span>
                                            <span className="ml-auto text-xs text-muted-foreground">
                                                {item.type_of_stop}
                                            </span>
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        ) : searchTerm.length > 2 ? (
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

type searchData =
    | { error: string; result: null }
    | { error: undefined; result: StopSearch[] }

async function searchForStop(search: string): Promise<searchData> {
    if (search.length <= 1) return { error: "Search too short", result: null }
    try {
        const response = await ApiFetch(
            `stops/find-stop/${encodeURIComponent(search)}`
        )
        const data: TrainsApiResponse<StopSearch[]> = await response.json()
        if (!response.ok) {
            console.error(data.message)
            return { error: data.message, result: null }
        }
        return { error: undefined, result: data.data }
    } catch {
        return { error: "An error occurred while fetching data", result: null }
    }
}

interface StopSearch {
    name: string
    type_of_stop: string
}
