"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ApiFetch } from "@/lib/url-context"

export interface RouteOption {
    route_id: string
    name: string
}

interface RouteMultiSelectProps {
    label: string
    placeholder: string
    selected: RouteOption[]
    onChange: (routes: RouteOption[]) => void
}

// A small search-and-tag control for picking one or more routes - backs the
// "only these routes" / "must include these routes" journey planner filters.
// Reuses the same /routes/find-route/:name search the standalone route search
// page uses, but keeps a running list of selections instead of navigating away.
export function RouteMultiSelect({ label, placeholder, selected, onChange }: RouteMultiSelectProps) {
    const [searchTerm, setSearchTerm] = useState("")
    const [results, setResults] = useState<RouteOption[]>([])
    const [isOpen, setIsOpen] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (searchTerm.length < 2) {
            setResults([])
            return
        }
        let cancelled = false
        const timeout = setTimeout(async () => {
            setIsLoading(true)
            try {
                const response = await ApiFetch<RouteOption[]>(`/routes/find-route/${encodeURIComponent(searchTerm)}`)
                if (!cancelled) setResults(response.ok ? response.data : [])
            } catch {
                if (!cancelled) setResults([])
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                    setIsOpen(true)
                }
            }
        }, 300)
        return () => {
            cancelled = true
            clearTimeout(timeout)
        }
    }, [searchTerm])

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const addRoute = (route: RouteOption) => {
        if (!selected.some((r) => r.route_id === route.route_id)) {
            onChange([...selected, route])
        }
        setSearchTerm("")
        setResults([])
        setIsOpen(false)
    }

    const removeRoute = (routeId: string) => {
        onChange(selected.filter((r) => r.route_id !== routeId))
    }

    return (
        <div className="flex flex-col gap-1.5 w-full sm:w-auto" ref={containerRef}>
            <span className="text-xs text-muted-foreground">{label}</span>
            <div className="relative">
                <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onFocus={() => searchTerm.length >= 2 && setIsOpen(true)}
                    placeholder={placeholder}
                    className="h-8 text-xs w-full sm:w-[180px]"
                />
                {isOpen && (
                    <div className="absolute z-50 mt-1 bg-background rounded-md shadow-lg border w-full sm:w-[220px] max-h-[180px] overflow-y-auto">
                        {isLoading ? (
                            <p className="text-center text-xs text-muted-foreground p-2">Searching…</p>
                        ) : results.length > 0 ? (
                            <ul className="p-1">
                                {results.map((route) => (
                                    <li key={route.route_id}>
                                        <button
                                            type="button"
                                            className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent truncate"
                                            onClick={() => addRoute(route)}
                                        >
                                            {route.name}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-center text-xs text-muted-foreground p-2">No routes found</p>
                        )}
                    </div>
                )}
            </div>
            {selected.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {selected.map((route) => (
                        <span
                            key={route.route_id}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                        >
                            {route.name}
                            <button
                                type="button"
                                onClick={() => removeRoute(route.route_id)}
                                aria-label={`Remove ${route.name}`}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    )
}

// Best-effort restore of a comma-separated list of route IDs (from a shared
// link) into displayable {route_id, name} pairs, via the single-route lookup
// endpoint (the cached route-by-id map, not a text search).
export async function resolveRouteIds(routeIds: string[]): Promise<RouteOption[]> {
    const resolved = await Promise.all(
        routeIds.map(async (routeId) => {
            try {
                const response = await ApiFetch<{ route_short_name: string; route_long_name: string }>(
                    `/routes/${encodeURIComponent(routeId)}`
                )
                if (!response.ok) return { route_id: routeId, name: routeId }
                const label = [response.data.route_short_name, response.data.route_long_name]
                    .filter(Boolean)
                    .join(" - ")
                return { route_id: routeId, name: label || routeId }
            } catch {
                return { route_id: routeId, name: routeId }
            }
        })
    )
    return resolved
}
