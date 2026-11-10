import { hasRealtime, type UrlOption } from "./regions"

/** The backend's envelope around every response (`providers` JSON). */
export interface TrainsApiResponse<DataType> {
    code: number
    data: DataType
    message: string
    trace_id?: string
}

export interface ApiError {
    ok: false
    error: string
    status_code?: number
    trace_id?: string
}

export type ApiResult<DataType> = { ok: true; data: DataType } | ApiError

/** `RequestInit` with plain-object headers, so they merge the same way on every platform. */
export type ApiRequestInit = Omit<RequestInit, "headers"> & { headers?: Record<string, string> }

export interface ApiClientConfig {
    /** The selected region, read on every call so switching region needs no new client. */
    region: () => UrlOption
    /** A stable per-install id, sent as `X-Trace-ID` so backend logs can follow one client. */
    traceId: () => string
    /** Headers added to every call (e.g. the iOS/Android device id and secret). */
    headers?: () => Record<string, string>
    /** Defaults to the global `fetch`. */
    fetch?: typeof fetch
}

/** Live vehicles and alerts don't exist for a region without GTFS-RT. (realtime/stop-times stays: it falls back to the timetable.) */
const REALTIME_ONLY_PATH = /^realtime\/(live|alerts|find-my-vehicle)\b/

/**
 * A fetch for the selected region's API that never throws: a network error,
 * a non-2xx status or a bad body all come back as `{ ok: false }`.
 */
export function createApiClient(config: ApiClientConfig) {
    return async function apiFetch<T>(path: string, options?: ApiRequestInit): Promise<ApiResult<T>> {
        const region = config.region()
        const { url } = region

        if (!url || url.trim() === "") throw new Error("No valid URL provided")
        if (!path || path.trim() === "") throw new Error("No valid path provided")

        const normalizedPath = path.startsWith("/") ? path.substring(1) : path

        if (!hasRealtime(region) && REALTIME_ONLY_PATH.test(normalizedPath)) {
            return { ok: false, error: "No realtime data for this region", status_code: 404, trace_id: "" }
        }
        const fullUrl = new URL(normalizedPath, `${url}/`).toString()

        const headers: Record<string, string> = {
            ...(config.headers?.() ?? {}),
            ...(options?.headers ?? {}),
            "X-Trace-ID": config.traceId(),
        }

        const doFetch = config.fetch ?? fetch
        try {
            const req = await doFetch(fullUrl, { ...options, headers })
            // Not every response is an envelope (the rate limiter answers a
            // 429 with a bare `null`), so a missing body falls back to the status.
            let resData: TrainsApiResponse<T> | null = null
            try {
                resData = (await req.json()) as TrainsApiResponse<T> | null
            } catch {
                resData = null
            }
            if (!resData || typeof resData !== "object") {
                return req.ok
                    ? { ok: false, error: "empty response", status_code: req.status, trace_id: "" }
                    : { ok: false, error: req.status === 429 ? "Too many requests - try again in a moment" : "request failed", status_code: req.status, trace_id: "" }
            }

            // The envelope carries its own code too; iOS treats a non-2xx one as an error even on HTTP 200.
            const codeOk = typeof resData.code !== "number" || (resData.code >= 200 && resData.code < 300)
            if (req.ok && codeOk) return { ok: true, data: resData.data }
            if (req.ok) return { ok: false, error: resData.message, status_code: resData.code, trace_id: resData.trace_id }
            return { ok: false, error: resData.message, status_code: req.status, trace_id: resData.trace_id }
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : "Unknown error occurred",
                status_code: 500,
                trace_id: "",
            }
        }
    }
}

export type ApiFetchFn = ReturnType<typeof createApiClient>
