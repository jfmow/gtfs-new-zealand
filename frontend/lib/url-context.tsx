import type React from "react"
import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import { createApiClient, type ApiResult } from "@transit/shared/api"
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

export type { ApiResult, ApiError } from "@transit/shared/api"

const TRACE_ID_KEY = "trace-id";

function getOrCreateTraceId(): string {
    let traceId = localStorage.getItem(TRACE_ID_KEY);
    if (!traceId) {
        traceId = crypto.randomUUID();
        localStorage.setItem(TRACE_ID_KEY, traceId);
    }
    return traceId;
}

// The request logic lives in the shared package (packages/shared/src/api.ts);
// the web supplies the selected region and its trace id.
const apiFetch = createApiClient({
    region: () => urlStore.currentUrl,
    traceId: getOrCreateTraceId,
})

/** GET/POST the selected region's API. Never throws: failures come back as `{ ok: false }`. */
export function ApiFetch<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
    const headers = options?.headers ? Object.fromEntries(new Headers(options.headers).entries()) : undefined
    return apiFetch<T>(path, { ...options, headers })
}
