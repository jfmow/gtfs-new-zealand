import { AlertCircle, AlertTriangle, CalendarDays, CloudRain, Construction, Hammer, HeartPulse, ShieldAlert, Users, Wrench, Clock3, type LucideIcon } from "lucide-react"

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

export const causeSeverityMap: Record<
    AlertCause,
    {
        variant: "destructive" | "default" | "secondary"
        label: string
        icon: LucideIcon
    }
> = {
    UNKNOWN_CAUSE: { variant: "secondary", label: "Unknown cause", icon: AlertCircle },
    OTHER_CAUSE: { variant: "secondary", label: "Other", icon: AlertCircle },
    TECHNICAL_PROBLEM: { variant: "default", label: "Technical issue", icon: Wrench },
    STRIKE: { variant: "destructive", label: "Strike", icon: Users },
    DEMONSTRATION: { variant: "destructive", label: "Demonstration", icon: Users },
    ACCIDENT: { variant: "destructive", label: "Accident", icon: AlertTriangle },
    HOLIDAY: { variant: "secondary", label: "Holiday schedule", icon: CalendarDays },
    WEATHER: { variant: "default", label: "Weather", icon: CloudRain },
    MAINTENANCE: { variant: "secondary", label: "Maintenance", icon: Hammer },
    CONSTRUCTION: { variant: "default", label: "Construction", icon: Construction },
    POLICE_ACTIVITY: { variant: "destructive", label: "Police activity", icon: ShieldAlert },
    MEDICAL_EMERGENCY: { variant: "destructive", label: "Medical emergency", icon: HeartPulse },
}

export interface AlertCauseGroup {
    key: string
    label: string
    icon: LucideIcon
    /** The raw GTFS-RT causes this group expands to when saved - the backend only ever filters on raw causes, grouping is purely a frontend picker concern. */
    causes: AlertCause[]
}

/**
 * A dozen raw GTFS-RT causes is too many individual toggles for a picker to
 * be usable, so the subscription UI groups them into a handful of buckets a
 * rider actually thinks in terms of. Selecting a group expands to (and a
 * saved subscription is matched back against) its full `causes` list -
 * nothing new on the backend, which still only ever filters on raw causes.
 */
export const ALERT_CAUSE_GROUPS: AlertCauseGroup[] = [
    {
        key: "delays_cancellations",
        label: "Delays & cancellations",
        icon: Clock3,
        causes: ["TECHNICAL_PROBLEM", "MEDICAL_EMERGENCY", "OTHER_CAUSE", "UNKNOWN_CAUSE"],
    },
    {
        key: "safety_incidents",
        label: "Safety & incidents",
        icon: ShieldAlert,
        causes: ["ACCIDENT", "POLICE_ACTIVITY", "STRIKE", "DEMONSTRATION"],
    },
    {
        key: "weather",
        label: "Weather",
        icon: CloudRain,
        causes: ["WEATHER"],
    },
    {
        key: "planned_works",
        label: "Planned works",
        icon: Hammer,
        causes: ["MAINTENANCE", "CONSTRUCTION", "HOLIDAY"],
    },
]

export const ALERT_SEVERITIES = ["INFO", "WARNING", "SEVERE"] as const
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]

export const severityLabels: Record<AlertSeverity, string> = {
    INFO: "Info",
    WARNING: "Warning",
    SEVERE: "Severe",
}
