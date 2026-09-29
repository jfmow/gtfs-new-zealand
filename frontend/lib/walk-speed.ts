/** Walking paces (km/h) the planner offers. Mirrors the backend's NormalizeWalkSpeed. */
export const WALK_SPEED_OPTIONS = [
    { value: "2.8", label: "Slow" },
    { value: "4", label: "Normal" },
    { value: "5", label: "Brisk" },
] as const

export const DEFAULT_WALK_SPEED = "4"

/** The old 3 / 4.8 / 5.5 choices proved too quick - move saved values onto the new scale. */
const LEGACY_WALK_SPEEDS: Record<string, string> = { "3": "2.8", "4.8": "4", "5.5": "5" }

export function normalizeWalkSpeed(value: string | number | undefined | null): string {
    if (value === undefined || value === null || value === "") return DEFAULT_WALK_SPEED
    const s = String(value)
    return LEGACY_WALK_SPEEDS[s] ?? s
}

export function walkSpeedLabel(value: string | number): string {
    const s = normalizeWalkSpeed(value)
    return WALK_SPEED_OPTIONS.find((o) => o.value === s)?.label ?? `${s} km/h`
}
