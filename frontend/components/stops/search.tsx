import { useEffect, useState, useRef } from "react"
import { SearchInput } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TrainsApiResponse } from "../services/types"

export default function SearchForStop({ url, defaultValue }: { url: string, defaultValue: string }) {
    const [searchTerm, setSearchTerm] = useState("")
    const [result, setResult] = useState<StopSearch[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isOpen, setIsOpen] = useState(false)
    const searchRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
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
            } else {
                setResult([])
                setIsOpen(false)
            }
        }, 300)

        return () => clearTimeout(delayDebounceFn)
    }, [searchTerm])

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

    return (
        <div className="relative w-full" ref={searchRef}>
            <SearchInput
                defaultValue={defaultValue}
                className="w-full"
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search for stop..."
                onFocus={() => setIsOpen(true)}
            />
            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-background rounded-md shadow-lg border">
                    <ScrollArea className="h-[200px] rounded-md">
                        {isLoading ? (
                            <div className="flex items-center justify-center h-full">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : error ? (
                            <p className="text-center text-sm text-red-500 p-4">{error}</p>
                        ) : result.length > 0 ? (
                            <ul className="p-2 space-y-1">
                                {result.map((item) => (
                                    <li key={item.name}>
                                        <a href={`${url}${encodeURIComponent(item.name)}`}>
                                            <Button
                                                variant="ghost"
                                                className="w-full justify-start text-left font-normal"
                                                onClick={() => setIsOpen(false)}
                                            >
                                                <span className="truncate">{item.name}</span>
                                                <span className="ml-auto text-xs text-muted-foreground">
                                                    {item.type_of_stop}
                                                </span>
                                            </Button>
                                        </a>
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
        const response = await fetch(
            `${process.env.NEXT_PUBLIC_TRAINS}/at/stops/find-stop/${encodeURIComponent(search)}`
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