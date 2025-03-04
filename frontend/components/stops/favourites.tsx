import { toast } from "sonner"
import { createContext, ReactNode, useContext, useEffect, useState } from "react"
import { Button } from "../ui/button"
import Router from "next/router"

const storage_key = "favourite_stops"

interface FavouritesContext {
    favourites: string[]
    addFavourite: (name: string) => void
    removeFavourite: (name: string) => void
    searchFavourites: (name: string) => boolean
}

const FavouritesContext = createContext<FavouritesContext>({
    favourites: [],
    addFavourite: () => { },
    removeFavourite: () => { },
    searchFavourites: () => false
})

export function FavouritesProvider({ children }: { children: ReactNode }) {
    const [favourites, setFavourites] = useState<string[]>([])

    function addFavouriteStop(stopName: string) {
        if (stopName === "") {
            throw new Error("missing stop name")
        }

        const savedStops = getFavouriteStops()
        if (savedStops.length >= 1) {

            if (savedStops.includes(stopName)) {
                toast.warning("Stop already favourited")
                return
            }

            window.localStorage.setItem(storage_key, JSON.stringify([...savedStops, stopName]))

        } else {
            window.localStorage.setItem(storage_key, JSON.stringify([stopName]))
        }
        setFavourites(prev => [...prev, stopName])
        toast.success("Stop added to favourites")
    }

    function removeFavouriteStop(stopName: string) {
        if (stopName === "") {
            throw new Error("missing stop name")
        }
        const savedStops = getFavouriteStops()
        if (savedStops.length >= 1) {
            if (savedStops.includes(stopName)) {
                window.localStorage.setItem(storage_key, JSON.stringify(savedStops.filter((item) => item !== stopName)))
                setFavourites(prev => prev.filter((item) => item !== stopName))
                toast.success("Stop removed from favourites")
                return
            }
        }

        toast.error("Stop not in favourites")
        return

    }

    function checkIfStopIsFavourite(stopName: string) {
        const favourites = getFavouriteStops()
        if (stopName !== "" && favourites.includes(stopName)) {
            return true
        } else {
            return false
        }
    }

    useEffect(() => {
        setFavourites(getFavouriteStops())
    }, [])

    return (
        <FavouritesContext.Provider value={{ favourites: favourites, addFavourite: addFavouriteStop, searchFavourites: checkIfStopIsFavourite, removeFavourite: removeFavouriteStop }}>
            {children}
        </FavouritesContext.Provider>
    )
}

export default function FavouriteStops() {
    const { favourites } = useContext(FavouritesContext)
    return (
        <>
            <div className="flex flex-wrap items-center justify-center gap-4">
                {favourites.map((item: string) => (
                    <Button variant={"outline"} onClick={() => Router.push(`/?s=${encodeURIComponent(item)}`)}>
                        {item}
                    </Button>
                ))}
            </div>
        </>
    )
}

export function useFavourites() {
    const context = useContext(FavouritesContext)
    return context
}



function getFavouriteStops(): string[] {
    if (typeof window === "undefined") return []
    const savedStops = window.localStorage.getItem(storage_key)
    if (savedStops && savedStops !== "") {
        try {
            const parsedStops = JSON.parse(savedStops)
            return parsedStops
        } catch {
            return []
        }
    } else {
        return []
    }
}