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

interface TrainsApiResponse<DataType> {
    code: number;
    data: DataType;
    message: string;
    trace_id?: string;
}

export type ApiResult<DataType> = {
    ok: true
    data: DataType
} | {
    ok: false
    error: string
    status_code?: number
    trace_id?: string
}

const TRACE_ID_KEY = "trace-id";

function getOrCreateTraceId(): string {
    let traceId = localStorage.getItem(TRACE_ID_KEY);
    if (!traceId) {
        traceId = crypto.randomUUID();
        localStorage.setItem(TRACE_ID_KEY, traceId);
    }
    return traceId;
}

export async function ApiFetch<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
    const { url } = urlStore.currentUrl;

    if (!url || url.trim() === "") throw new Error("No valid URL provided");
    if (!path || path.trim() === "") throw new Error("No valid path provided");

    const normalizedPath = path.startsWith("/") ? path.substring(1) : path;
    const fullUrl = new URL(normalizedPath, `${url}/`).toString();

    const traceId = getOrCreateTraceId();

    const headers: HeadersInit = {
        ...(options?.headers || {}),
        "X-Trace-ID": traceId,
    };

    try {
        const req = await fetch(fullUrl, {
            ...options,
            headers,
        });

        const res_data = await req.json() as TrainsApiResponse<T>;

        if (req.ok) {
            return { ok: true, data: res_data.data };
        } else {
            return {
                ok: false,
                error: res_data.message,
                status_code: req.status,
                trace_id: res_data.trace_id,
            };
        }
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : "Unknown error occurred",
            status_code: 500,
            trace_id: "",
        };
    }
}


