import type { ApiFetchFn, ApiResult } from "./api"
import type { FareEstimate, FareType, FareTypeOption } from "./fares"
import type { ReliabilityConnection } from "./reliability"
import type { JourneyType } from "./types/journey"
import type { StopSearchResult } from "./types/stops"
import type {
    AlertsForStop, Coordinate, Departure, JourneyLive, JourneyReminderCreated, JourneyReminderDTO, LocationSearchResult,
    MySubscriptions, NearbyVehicle, PushTestResult, ReverseGeocodeResult, Route, RouteSearchResult, RouteShape, Stop,
    StopSubscriptionState, StopTimeUpdate, TransitAlert, TripStopRef, Vehicle, WalkingDirections,
} from "./models"

/**
 * Typed calls for every backend endpoint the apps use - a port of iOS
 * `TransitCore/API/Endpoints.swift` and `NotificationEndpoints.swift`.
 * Each returns the shared client's `ApiResult` (never throws).
 */

/** A value for one path segment: everything but unreserved characters encoded, "/" included ("Customs St/Britomart"). */
export function pathSegment(value: string): string {
    return encodeURIComponent(value)
}

function query(params: Record<string, string | number | boolean | undefined | null>): string {
    const parts = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    return parts.length ? `?${parts.join("&")}` : ""
}

export type TravelMode = "bus" | "train" | "ferry"
export const TRAVEL_MODES: TravelMode[] = ["bus", "train", "ferry"]

/** GTFS route_type codes per mode (basic + extended), as iOS `TravelMode.routeTypes`. */
export const TRAVEL_MODE_ROUTE_TYPES: Record<TravelMode, number[]> = {
    bus: [3, 11, 700, 702, 704, 711, 712, 715],
    train: [0, 1, 2, 5, 7, 12, 100, 101, 102, 106, 109, 400, 401, 900],
    ferry: [4, 1000, 1200],
}

export function travelModeForRouteType(routeType: number): TravelMode | undefined {
    return TRAVEL_MODES.find((m) => TRAVEL_MODE_ROUTE_TYPES[m].includes(routeType))
}

export interface JourneyPlanRequest {
    start: Coordinate
    end: Coordinate
    date?: Date
    timeType?: "now" | "departat" | "arriveat"
    maxWalkKm?: number
    walkSpeed?: number
    maxTransfers?: number
    minResults?: number
    onlyRoutes?: string[]
    modes?: TravelMode[]
    minTransferSec?: number
}

/** The planner's query string, matching iOS `JourneyPlanRequest.queryItems`. */
export function planQuery(r: JourneyPlanRequest): string {
    const modes = r.modes?.length ? TRAVEL_MODES.filter((m) => r.modes!.includes(m)).join(",") : undefined
    return query({
        startLat: r.start.lat,
        startLon: r.start.lon,
        endLat: r.end.lat,
        endLon: r.end.lon,
        date: (r.date ?? new Date()).toISOString(),
        timeType: r.timeType ?? "now",
        maxWalkKm: r.maxWalkKm ?? 1.0,
        walkSpeed: r.walkSpeed ?? 3.6,
        maxTransfers: r.maxTransfers ?? 5,
        minResults: r.minResults ?? 3,
        onlyRoutes: r.onlyRoutes?.length ? r.onlyRoutes.join(",") : undefined,
        modes,
        minTransferSec: r.minTransferSec && r.minTransferSec > 0 ? r.minTransferSec : undefined,
    })
}

/** application/x-www-form-urlencoded body, keys sorted (as iOS). */
export function formBody(form: Record<string, string>): string {
    return Object.keys(form)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(form[k])}`)
        .join("&")
}

function jsonArray(values: (string | number)[] | undefined): string {
    return values && values.length ? JSON.stringify(values) : ""
}

export interface DeviceIdentity {
    id: string
    secret: string
}

export function createEndpoints(api: ApiFetchFn) {
    const get = <T>(path: string) => api<T>(path)
    const post = <T>(path: string, form: Record<string, string> = {}) =>
        api<T>(path, { method: "POST", body: formBody(form), headers: { "Content-Type": "application/x-www-form-urlencoded" } })

    return {
        // stops
        stops: (opts: { children?: boolean; type?: "all" | "bus" | "train" | "ferry" } = {}) =>
            get<Stop[]>(`stops${query({ children: opts.children ? "true" : "false", stop_type: opts.type ?? "all" })}`),
        stopsForTrip: (tripId: string) => get<TripStopRef[]>(`stops/${pathSegment(tripId)}`),
        closestStops: (c: Coordinate) => get<Stop[]>(`stops/closest-stop${query({ lat: c.lat, lon: c.lon })}`),
        stop: (stopId: string) => get<Stop>(`stops/stop/${pathSegment(stopId)}`),
        findStop: (q: string, children = false) => get<StopSearchResult[]>(`stops/find-stop/${pathSegment(q)}${query({ children: children ? "true" : "false" })}`),

        // routes
        routes: () => get<Record<string, Route>>("routes"),
        route: (routeId: string) => get<Route>(`routes/${pathSegment(routeId)}`),
        findRoute: (q: string) => get<RouteSearchResult[]>(`routes/find-route/${pathSegment(q)}`),

        // departures board (`stop` is a stop id or the "name code" board query)
        departures: (stop: string, limit = 200) => get<Departure[]>(`services/${pathSegment(stop)}${query({ limit })}`),
        schedule: (stop: string, date: Date) => get<Departure[]>(`services/${pathSegment(stop)}/schedule${query({ date: Math.floor(date.getTime() / 1000) })}`),

        // planning
        plan: (r: JourneyPlanRequest) => get<JourneyType[]>(`services/plan${planQuery(r)}`),
        planById: (id: string) => get<JourneyType[]>(`services/plan/${pathSegment(id)}`),

        // realtime
        liveVehicles: (opts: { tripIds?: string[]; type?: "all" | "Bus" | "Train" | "Ferry" } = {}) =>
            get<Vehicle[]>(`realtime/live${query({ type: opts.type ?? "all", tripId: opts.tripIds?.length ? opts.tripIds.join(",") : undefined })}`),
        stopTimes: (tripId: string) => get<StopTimeUpdate[]>(`realtime/stop-times${query({ tripId })}`),
        journeyLive: (tripIds: string[], from: string[] = [], to: string[] = []) =>
            get<JourneyLive>(`realtime/journey${query({ tripId: tripIds.join(","), from: from.length ? from.join(",") : undefined, to: to.length ? to.join(",") : undefined })}`),
        alertsForStop: (stop: string, todayOnly = false) => get<AlertsForStop>(`realtime/alerts/${pathSegment(stop)}${query({ today: todayOnly ? "true" : undefined })}`),
        alertsForRoute: (routeId: string) => get<TransitAlert[]>(`realtime/alerts/route/${pathSegment(routeId)}`),
        findMyVehicle: (c: Coordinate) => get<NearbyVehicle[]>(`realtime/find-my-vehicle/${pathSegment(String(c.lat))}/${pathSegment(String(c.lon))}`),

        // fares + reliability
        fares: (planIds: string[], fareType: FareType = "adult") =>
            get<{ fares: Record<string, FareEstimate | null> }>(`fares${query({ plans: planIds.join(","), concession: fareType })}`),
        fareTypes: () => get<{ types: FareTypeOption[] }>("fares/types"),
        connections: (changes: string[]) => get<{ changes: (ReliabilityConnection | null)[] }>(`reliability/connections${query({ changes: changes.join(",") })}`),

        // map
        routeShape: (opts: { tripId?: string; routeId?: string }) => get<RouteShape>(`map/geojson/shapes${query({ tripId: opts.tripId, routeId: opts.routeId })}`),
        walkingDirections: (from: Coordinate, to: Coordinate) =>
            get<WalkingDirections>(`map/nav${query({ startLat: from.lat, startLon: from.lon, endLat: to.lat, endLon: to.lon, method: "walking" })}`),
        searchLocations: (q: string, limit = 5) => get<LocationSearchResult[]>(`map/search${query({ q, limit })}`),
        reverseGeocode: (c: Coordinate) => get<ReverseGeocodeResult>(`map/reverse${query({ lat: c.lat, lon: c.lon })}`),

        // devices (identity also goes on every POST as X-Device-Id/Secret headers, set on the client)
        registerIOSDevice: (identity: DeviceIdentity, apnsToken: string, env: "sandbox" | "production", pushToStartToken = "") =>
            post<{ id: number }>("devices/register", { deviceId: identity.id, secret: identity.secret, apnsToken, env, pushToStartToken }),
        updateIOSDeviceToken: (identity: DeviceIdentity, apnsToken = "", env = "", pushToStartToken = "") =>
            post<{ id: number }>("devices/update-token", { deviceId: identity.id, secret: identity.secret, apnsToken, env, pushToStartToken }),
        registerAndroidDevice: (identity: DeviceIdentity, fcmToken = "") =>
            post<{ id: number }>("devices/register", { platform: "android", deviceId: identity.id, secret: identity.secret, fcmToken }),
        updateAndroidDeviceToken: (identity: DeviceIdentity, fcmToken: string) =>
            post<{ id: number }>("devices/update-token", { platform: "android", deviceId: identity.id, secret: identity.secret, fcmToken }),

        // stop + route alert subscriptions
        subscribeToStop: (stop: string, f: { routes?: string[]; causes?: string[]; minSeverity?: string; notifyCancellations?: boolean } = {}) =>
            post<null>("notifications/add", { stopIdOrName: stop, routes: jsonArray(f.routes), causes: jsonArray(f.causes), minSeverity: f.minSeverity ?? "", notifyCancellations: f.notifyCancellations === false ? "false" : "true" }),
        updateStopSubscription: (stop: string, f: { routes: string[]; causes: string[]; minSeverity: string; notifyCancellations: boolean }) =>
            post<null>("notifications/edit", { stopIdOrName: stop, routes: jsonArray(f.routes), causes: jsonArray(f.causes), minSeverity: f.minSeverity, notifyCancellations: f.notifyCancellations ? "true" : "false" }),
        unsubscribeFromStop: (stop: string) => post<null>("notifications/remove", { stopIdOrName: stop }),
        stopSubscription: (stop: string) => post<StopSubscriptionState>("notifications/find-client", { stopIdOrName: stop }),
        subscribeToRoute: (routeId: string, f: { causes?: string[]; minSeverity?: string; notifyCancellations?: boolean } = {}) =>
            post<null>("notifications/route/add", { routeId, causes: jsonArray(f.causes), minSeverity: f.minSeverity ?? "", notifyCancellations: f.notifyCancellations === false ? "false" : "true" }),
        updateRouteSubscription: (routeId: string, f: { causes: string[]; minSeverity: string; notifyCancellations: boolean }) =>
            post<null>("notifications/route/edit", { routeId, causes: jsonArray(f.causes), minSeverity: f.minSeverity, notifyCancellations: f.notifyCancellations ? "true" : "false" }),
        unsubscribeFromRoute: (routeId: string) => post<null>("notifications/route/remove", { routeId }),

        // feed
        mySubscriptions: () => post<MySubscriptions>("notifications/mine"),
        dismissNotification: (id: string) => post<null>("notifications/history/dismiss", { id }),
        clearNotificationHistory: () => post<null>("notifications/history/clear"),
        sendTestNotification: () => post<PushTestResult>("notifications/test"),

        // one-shot trip reminders: "get_off" | "arrival" | "n_stops_away" (with offset)
        addTripReminder: (tripId: string, stopId: string, type: string, offset?: number) =>
            post<null>("notifications/reminder", { tripId, stopId, type, ...(offset !== undefined ? { offset: String(offset) } : {}) }),
        removeTripReminder: (type: string) => post<null>("notifications/reminder/remove", { type }),

        // leave-by reminders
        journeyReminders: () => post<JourneyReminderDTO[]>("notifications/journey-reminders"),
        removeJourneyReminder: (id: number) => post<null>("notifications/journey-reminder/remove", { id: String(id) }),
        addJourneyReminder: (form: Record<string, string>) => post<JourneyReminderCreated>("notifications/journey-reminder", form),

        // Live Activities (iOS)
        startLiveActivity: (planId: string, activityId: string, pushToken: string, region: string, env = "") =>
            post<{ id: number }>("live-activities", { planId, activityId, pushToken, region, env }),
        updateLiveActivityToken: (activityId: string, pushToken: string) => post<null>("live-activities/update-token", { activityId, pushToken }),
        reportLiveActivityLeg: (activityId: string, legIndex: number, phase: string, headphones = false, leftAt?: number) =>
            post<null>("live-activities/leg", { activityId, legIndex: String(legIndex), phase, headphones: headphones ? "1" : "0", ...(leftAt !== undefined ? { leftAt: String(leftAt) } : {}) }),
        endLiveActivity: (activityId: string) => post<null>("live-activities/end", { activityId }),
        // Trip Live Activities (one vehicle, counted down to your stop)
        startTripLiveActivity: (f: { activityId: string; pushToken: string; region: string; env: string; tripId: string; stopId: string; stopSequence: number; scheduledUnix: number; kind: string }) =>
            post<null>("live-activities/trip", { ...f, stopSequence: String(f.stopSequence), scheduledUnix: String(Math.round(f.scheduledUnix)) }),
        reportTripLiveActivity: (activityId: string) => post<null>("live-activities/trip/report", { activityId }),
        endTripLiveActivity: (activityId: string) => post<null>("live-activities/trip/end", { activityId }),
    }
}

export type Endpoints = ReturnType<typeof createEndpoints>

/** A plan's leave-by reminder form, as iOS `addLeaveByReminder(for:)`. Null when it has no ride to board. */
export function leaveByReminderForm(plan: JourneyType, offsets: number[] = [30, 15, 5, 0], accessSeconds?: number): Record<string, string> | null {
    const board = plan.Legs.find((l) => l.Mode === "transit")
    if (!board || !board.FromStop) return null
    const toDate = (d: Date | string | null | undefined) => {
        if (!d) return null
        const s = typeof d === "string" ? d : d.toISOString()
        if (s.startsWith("0001-01-01")) return null
        const x = new Date(s)
        return isNaN(x.getTime()) ? null : x
    }
    const scheduled = toDate(board.scheduled_departure_time) ?? toDate(board.DepartureTime)
    if (!scheduled) return null
    const boardDep = toDate(board.DepartureTime)
    const planDep = toDate(plan.DepartureTime) ?? boardDep
    const access = accessSeconds ?? (boardDep && planDep ? Math.round((boardDep.getTime() - planDep.getTime()) / 1000) : 0)
    return {
        kind: "fixed_trip",
        startLat: String(plan.StartLat), startLon: String(plan.StartLon), startLabel: "Start",
        endLat: String(plan.EndLat), endLon: String(plan.EndLon), endLabel: "Destination",
        timeType: "arriveat",
        boardTripId: board.TripID,
        boardStopId: board.FromStop.stop_id,
        scheduledDepartureIso: scheduled.toISOString(),
        accessSeconds: String(Math.max(0, access)),
        routeShortName: board.Route?.route_short_name || board.RouteID,
        boardStopName: board.FromStop.stop_name,
        offsets: JSON.stringify(offsets),
        deeplink: `transit://journey?id=${plan.ID}`,
    }
}

/** Unwraps an ApiResult to its data or null - for screens that just show "nothing" on failure. */
export function dataOrNull<T>(res: ApiResult<T>): T | null {
    return res.ok ? (res.data ?? null) : null
}
