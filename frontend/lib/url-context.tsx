import type React from "react"
import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import { UrlOption, urlOptions, urlStore } from "./url-store"

type UrlContextType = {
    currentUrl: UrlOption
    setCurrentUrl: (url: UrlOption) => void
    urlOptions: UrlOption[]
}

const UrlContext = createContext<UrlContextType | undefined>(undefined)

export const useUrl = () => {
    const context = useContext(UrlContext)
    if (!context) {
        throw new Error("useUrl must be used within a UrlProvider")
    }
    return context
}

export const UrlProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currentUrl, setCurrentUrl] = useState<UrlOption>(urlStore.currentUrl)

    useEffect(() => {
        const unsubscribe = urlStore.subscribe((newUrl: React.SetStateAction<UrlOption>) => {
            setCurrentUrl(newUrl)
        })

        return () => {
            unsubscribe()
        }
    }, [])

    const updateCurrentUrl = (newUrl: UrlOption) => {
        urlStore.currentUrl = newUrl
    }

    return (
        <UrlContext.Provider value={{ currentUrl, setCurrentUrl: updateCurrentUrl, urlOptions }
        }>
            {children}
        </UrlContext.Provider>
    )
}

export function ApiFetch(path: string, options?: RequestInit) {
    const { url } = urlStore.currentUrl;

    if (!url || url.trim() === "") {
        throw new Error("No valid URL provided");
    }

    if (!path || path.trim() === "") {
        throw new Error("No valid path provided");
    }

    // Normalize path (ensure no leading '/')
    const normalizedPath = path.startsWith("/") ? path.substring(1) : path;

    // Use URL constructor for proper URL joining
    const fullUrl = new URL(normalizedPath, `${url}/`).toString();

    return fetch(fullUrl, options);
}

