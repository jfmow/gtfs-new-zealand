/**
 * Service alert types and the cause/severity vocabulary. Icons are a UI
 * concern, so each app maps `AlertCause` / group `key` to its own icon set.
 */

/** Matches the real backend/providers.AlertResponseData JSON shape exactly - the one type every alert-fetching site should use instead of re-declaring its own. */
export interface AlertResponseData {
    route_id?: string
    start_date: number
    end_date: number
    cause: AlertCause
    effect: string
    title: string
    description: string
    severity: string
}

export type AlertCause =
    | "UNKNOWN_CAUSE"
    | "OTHER_CAUSE"
    | "TECHNICAL_PROBLEM"
    | "STRIKE"
    | "DEMONSTRATION"
    | "ACCIDENT"
    | "HOLIDAY"
    | "WEATHER"
    | "MAINTENANCE"
    | "CONSTRUCTION"
    | "POLICE_ACTIVITY"
    | "MEDICAL_EMERGENCY"

/** Every cause the backend can report, in the same order the filter picker should show them. */
export const ALERT_CAUSES: AlertCause[] = [
    "ACCIDENT",
    "POLICE_ACTIVITY",
    "MEDICAL_EMERGENCY",
    "STRIKE",
    "DEMONSTRATION",
    "WEATHER",
    "TECHNICAL_PROBLEM",
    "MAINTENANCE",
    "CONSTRUCTION",
    "HOLIDAY",
    "OTHER_CAUSE",
    "UNKNOWN_CAUSE",
]

export type AlertCauseVariant = "destructive" | "default" | "secondary"

/** How each cause reads and how loud its badge is. */
export const ALERT_CAUSE_INFO: Record<AlertCause, { variant: AlertCauseVariant; label: string }> = {
    UNKNOWN_CAUSE: { variant: "secondary", label: "Unknown cause" },
    OTHER_CAUSE: { variant: "secondary", label: "Other" },
    TECHNICAL_PROBLEM: { variant: "default", label: "Technical issue" },
    STRIKE: { variant: "destructive", label: "Strike" },
    DEMONSTRATION: { variant: "destructive", label: "Demonstration" },
    ACCIDENT: { variant: "destructive", label: "Accident" },
    HOLIDAY: { variant: "secondary", label: "Holiday schedule" },
    WEATHER: { variant: "default", label: "Weather" },
    MAINTENANCE: { variant: "secondary", label: "Maintenance" },
    CONSTRUCTION: { variant: "default", label: "Construction" },
    POLICE_ACTIVITY: { variant: "destructive", label: "Police activity" },
    MEDICAL_EMERGENCY: { variant: "destructive", label: "Medical emergency" },
}

export type AlertCauseGroupKey = "delays_cancellations" | "safety_incidents" | "weather" | "planned_works"

export interface AlertCauseGroupInfo {
    key: AlertCauseGroupKey
    label: string
    /** The raw GTFS-RT causes this group expands to when saved - the backend only ever filters on raw causes, grouping is purely a picker concern. */
    causes: AlertCause[]
}

/**
 * A dozen raw GTFS-RT causes is too many individual toggles for a picker to
 * be usable, so the subscription UI groups them into a handful of buckets a
 * rider actually thinks in terms of. Selecting a group expands to (and a
 * saved subscription is matched back against) its full `causes` list -
 * nothing new on the backend, which still only ever filters on raw causes.
 */
export const ALERT_CAUSE_GROUP_INFO: AlertCauseGroupInfo[] = [
    { key: "delays_cancellations", label: "Delays & cancellations", causes: ["TECHNICAL_PROBLEM", "MEDICAL_EMERGENCY", "OTHER_CAUSE", "UNKNOWN_CAUSE"] },
    { key: "safety_incidents", label: "Safety & incidents", causes: ["ACCIDENT", "POLICE_ACTIVITY", "STRIKE", "DEMONSTRATION"] },
    { key: "weather", label: "Weather", causes: ["WEATHER"] },
    { key: "planned_works", label: "Planned works", causes: ["MAINTENANCE", "CONSTRUCTION", "HOLIDAY"] },
]

export const ALERT_SEVERITIES = ["INFO", "WARNING", "SEVERE"] as const
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]

export const severityLabels: Record<AlertSeverity, string> = {
    INFO: "Info",
    WARNING: "Warning",
    SEVERE: "Severe",
}
