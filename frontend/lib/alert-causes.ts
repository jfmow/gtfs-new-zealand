import { AlertCircle, AlertTriangle, CalendarDays, CloudRain, Construction, Hammer, HeartPulse, ShieldAlert, Users, Wrench, Clock3, type LucideIcon } from "lucide-react"
import {
    ALERT_CAUSE_GROUP_INFO,
    ALERT_CAUSE_INFO,
    type AlertCause,
    type AlertCauseGroupKey,
    type AlertCauseVariant,
} from "@transit/shared/alerts"

// The alert types and cause vocabulary live in the shared package
// (packages/shared/src/alerts.ts). Only the icons are web-specific.
export {
    ALERT_CAUSES,
    ALERT_SEVERITIES,
    severityLabels,
    type AlertResponseData,
    type AlertCause,
    type AlertSeverity,
} from "@transit/shared/alerts"

const CAUSE_ICONS: Record<AlertCause, LucideIcon> = {
    UNKNOWN_CAUSE: AlertCircle,
    OTHER_CAUSE: AlertCircle,
    TECHNICAL_PROBLEM: Wrench,
    STRIKE: Users,
    DEMONSTRATION: Users,
    ACCIDENT: AlertTriangle,
    HOLIDAY: CalendarDays,
    WEATHER: CloudRain,
    MAINTENANCE: Hammer,
    CONSTRUCTION: Construction,
    POLICE_ACTIVITY: ShieldAlert,
    MEDICAL_EMERGENCY: HeartPulse,
}

export const causeSeverityMap = Object.fromEntries(
    (Object.keys(ALERT_CAUSE_INFO) as AlertCause[]).map((cause) => [cause, { ...ALERT_CAUSE_INFO[cause], icon: CAUSE_ICONS[cause] }])
) as Record<AlertCause, { variant: AlertCauseVariant; label: string; icon: LucideIcon }>

export interface AlertCauseGroup {
    key: string
    label: string
    icon: LucideIcon
    /** The raw GTFS-RT causes this group expands to when saved - the backend only ever filters on raw causes, grouping is purely a frontend picker concern. */
    causes: AlertCause[]
}

const GROUP_ICONS: Record<AlertCauseGroupKey, LucideIcon> = {
    delays_cancellations: Clock3,
    safety_incidents: ShieldAlert,
    weather: CloudRain,
    planned_works: Hammer,
}

/** The subscription picker's cause buckets (see `ALERT_CAUSE_GROUP_INFO`), with icons. */
export const ALERT_CAUSE_GROUPS: AlertCauseGroup[] = ALERT_CAUSE_GROUP_INFO.map((g) => ({ ...g, icon: GROUP_ICONS[g.key] }))
