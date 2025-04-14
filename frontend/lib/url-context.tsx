import type React from "react"
import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import { UrlOption, urlOptions, urlStore } from "./url-store"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

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



export function UrlSelector() {
    const { urlOptions, setCurrentUrl, currentUrl } = useUrl()
    return (
        <>
            <Select value={currentUrl.url} onValueChange={(val) => {
                const item = urlOptions.find((item) => item.url === val)
                if (item) {
                    setCurrentUrl(item)
                    window.location.reload()
                }
            }}>
                <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                    {urlOptions.map((item) => (
                        <SelectItem key={item.url} value={item.url}>
                            <div className="flex items-center gap-2">
                                <img className="w-4 h-4 object-contain" src={item.logoUrl} />
                                <span style={{ color: item.textColor }}>{item.displayName}</span>
                            </div>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

        </>
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

