import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useRouter } from "next/router"
import { Activity, ChevronRight, Loader2 } from "lucide-react"
import { Header } from "@/components/nav"
import { SearchInput } from "@/components/ui/input"
import { ApiFetch, useUrl } from "@/lib/url-context"
import { hasRealtime } from "@/lib/url-store"
import { cn } from "@/lib/utils"
import { reliabilityTone, useLeague, useRouteReliability, type DayType, type LeagueRow, type ReliabilityBand, type ReliabilityStat, type RouteReliabilityReport } from "@/lib/reliability"
import { BarChart, LineChart } from "@/components/charts"

const MapComp = dynamic(() => import("@/components/map/map"), { ssr: false })

/**
 * Route reliability - how a route has been running over the last few
 * weeks: overall, by time of week (an early / on time / late split), and
 * the stops where it's usually latest. `?route=<route id>`.
 */
export default function ReliabilityPage() {
    const router = useRouter()
    const routeId = typeof router.query.route === "string" ? router.query.route : ""
    const { currentUrl } = useUrl()

    const choose = (id: string) => router.push({ pathname: "/reliability", query: id ? { route: id } : {} }, undefined, { shallow: true })

    return (
        <>
            <Header title="Route reliability" />
            <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pb-10">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Route reliability</h1>
                    <p className="mt-1 text-sm text-muted-foreground">How a route has been running over the last few weeks, from live data.</p>
                </div>

                <RoutePicker onPick={choose} />

                {!hasRealtime(currentUrl) ? (
                    <EmptyState title="No live data here" text={`${currentUrl.displayName} doesn't publish live running, so there's nothing to measure.`} />
                ) : routeId ? (
                    <RouteReport key={routeId} routeId={routeId} />
                ) : (
                    <League onPick={choose} />
                )}
            </div>
        </>
    )
}

interface RouteSearch {
    name: string
    route_id: string
}

function RoutePicker({ onPick }: { onPick: (routeId: string) => void }) {
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<RouteSearch[]>([])
    const [loading, setLoading] = useState(false)
    const [open, setOpen] = useState(false)
    const box = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (query.trim().length < 1) {
            setResults([])
            return
        }
        let cancelled = false
        setLoading(true)
        const t = setTimeout(async () => {
            const res = await ApiFetch<RouteSearch[]>(`routes/find-route/${encodeURIComponent(query.trim())}`)
            if (cancelled) return
            setResults(res.ok ? res.data.slice(0, 8) : [])
            setLoading(false)
            setOpen(true)
        }, 250)
        return () => { cancelled = true; clearTimeout(t) }
    }, [query])

    useEffect(() => {
        const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
        document.addEventListener("mousedown", close)
        return () => document.removeEventListener("mousedown", close)
    }, [])

    return (
        <div ref={box} className="relative">
            <SearchInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => results.length > 0 && setOpen(true)}
                placeholder="Search for a route - 70, NX1, Eastern Line…"
                aria-label="Search for a route"
            />
            {open && query.trim() !== "" && (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                    {loading && results.length === 0 ? (
                        <li className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</li>
                    ) : results.length === 0 ? (
                        <li className="px-3 py-2.5 text-sm text-muted-foreground">No routes match</li>
                    ) : results.map((r) => (
                        <li key={r.route_id}>
                            <button
                                type="button"
                                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent"
                                onClick={() => { onPick(r.route_id); setQuery(""); setOpen(false) }}
                            >
                                <span className="font-medium">{r.name}</span>
                                <span className="text-xs text-muted-foreground">{r.route_id}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

function RouteReport({ routeId }: { routeId: string }) {
    const [day, setDay] = useState<DayType | undefined>()
    const fresh = useRouteReliability(routeId, day)
    // Keep the last report up while another day type loads.
    const last = useRef<RouteReliabilityReport | null | undefined>(undefined)
    if (fresh !== undefined) last.current = fresh
    const data = fresh ?? last.current

    if (data === undefined) {
        return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    }
    if (data === null) {
        return <EmptyState title="Route not found" text="It may not run in this region any more. Try searching again." />
    }

    const { route, report } = data
    const color = route.route_color ? `#${route.route_color}` : "#424242"
    const anyBand = report.bands.some((b) => b.stat)

    return (
        <div className="space-y-5">
            <section className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                    <span className="rounded px-2 py-0.5 text-sm font-bold text-white" style={{ background: color }}>
                        {route.route_short_name || route.route_id}
                    </span>
                    {route.route_long_name && route.route_long_name !== route.route_short_name && (
                        <span className="truncate text-sm text-muted-foreground">{route.route_long_name}</span>
                    )}
                </div>
                {report.overall ? (
                    <div className="mt-3">
                        <p className={cn("text-2xl font-semibold tracking-tight", reliabilityTone(report.overall.level))}>{report.overall.summary}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {report.overall.detail} · from {report.overall.samples.toLocaleString()} recent observations
                        </p>
                    </div>
                ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                        Not enough data yet. Figures build up as the route runs - check back in a few days.
                    </p>
                )}
            </section>

            <RouteMap map={data.map} color={color} />

            {anyBand && <BandChart bands={report.bands} />}

            <ThroughTheDay hours={data.hours} onDay={setDay} />

            <Trend trend={data.trend} />

            {report.late_stops.length > 0 && (
                <section aria-labelledby="late-stops" className="space-y-2">
                    <h2 id="late-stops" className="text-sm font-semibold">Where it runs latest</h2>
                    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                        {report.late_stops.map((s) => (
                            <li key={s.stop_id}>
                                <Link
                                    href={`/?s=${encodeURIComponent(s.stop_name)}`}
                                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50"
                                >
                                    <span className="w-14 shrink-0 text-right font-mono text-sm tabular-nums">
                                        {s.stat.typical_min > 0 ? `+${s.stat.typical_min}` : s.stat.typical_min} min
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{s.stop_name}</span>
                                        <span className="block text-xs text-muted-foreground">
                                            <span className={reliabilityTone(s.stat.level)}>{s.stat.summary}</span> · {s.stat.detail}
                                        </span>
                                    </span>
                                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">Typical delay when it reaches each stop, across the week.</p>
                </section>
            )}

            <Alerts alerts={data.alerts} />

            <p className="text-xs text-muted-foreground">
                On time means between 1 minute early and 5 minutes late. Based on live running over the last few weeks, with recent days counting most.
            </p>
        </div>
    )
}

// The diverging split: early (cool) / on time (neutral) / late (warm) -
// validated with the dataviz palette checks in light and dark.
const SEGMENTS = [
    { key: "early", label: "Early", hint: "more than 1 min early", className: "bg-[#2a78d6] dark:bg-[#3987e5]" },
    { key: "on_time", label: "On time", hint: "1 min early to 5 min late", className: "bg-[#f0efec] dark:bg-[#383835] ring-1 ring-inset ring-border" },
    { key: "late", label: "Late", hint: "5+ min late", className: "bg-[#e34948] dark:bg-[#e66767]" },
] as const

type SegmentKey = (typeof SEGMENTS)[number]["key"]

function share(stat: ReliabilityStat, key: SegmentKey): number {
    return key === "early" ? stat.early_pct : key === "late" ? stat.late_pct : stat.on_time_pct
}

function BandChart({ bands }: { bands: ReliabilityBand[] }) {
    const [hover, setHover] = useState<{ band: string; key: SegmentKey } | null>(null)
    const [asTable, setAsTable] = useState(false)

    return (
        <section aria-labelledby="by-time" className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="by-time" className="text-sm font-semibold">By time of week</h2>
                <button type="button" onClick={() => setAsTable((v) => !v)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                    {asTable ? "Show as chart" : "Show as table"}
                </button>
            </div>

            {asTable ? (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                            <th className="py-1 font-medium">When</th>
                            <th className="py-1 text-right font-medium">Early</th>
                            <th className="py-1 text-right font-medium">On time</th>
                            <th className="py-1 text-right font-medium">Late</th>
                            <th className="py-1 text-right font-medium">Cancelled</th>
                        </tr>
                    </thead>
                    <tbody className="tabular-nums">
                        {bands.map((b) => (
                            <tr key={b.band} className="border-t border-border">
                                <td className="py-1.5">{b.label}</td>
                                {b.stat ? (
                                    <>
                                        <td className="py-1.5 text-right">{b.stat.early_pct}%</td>
                                        <td className="py-1.5 text-right">{b.stat.on_time_pct}%</td>
                                        <td className="py-1.5 text-right">{b.stat.late_pct}%</td>
                                        <td className="py-1.5 text-right">{b.stat.cancelled_pct != null ? `${b.stat.cancelled_pct}%` : "–"}</td>
                                    </>
                                ) : (
                                    <td colSpan={4} className="py-1.5 text-right text-muted-foreground">Not enough data</td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                <>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
                        {SEGMENTS.map((s) => (
                            <li key={s.key} className="flex items-center gap-1.5">
                                <span aria-hidden className={cn("h-2.5 w-2.5 rounded-sm", s.className)} />
                                {s.label} <span className="hidden sm:inline">({s.hint})</span>
                            </li>
                        ))}
                    </ul>
                    <ul className="space-y-3">
                        {bands.map((b) => (
                            <li key={b.band} className="space-y-1">
                                <div className="flex items-baseline justify-between gap-3 text-sm">
                                    <span className="font-medium">{b.label}</span>
                                    {b.stat ? (
                                        <span className={cn("text-xs", reliabilityTone(b.stat.level))}>{b.stat.summary}</span>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">Not enough data</span>
                                    )}
                                </div>
                                {b.stat && (
                                    <div className="relative">
                                        <div
                                            className="flex h-3 w-full gap-[2px]"
                                            role="img"
                                            aria-label={`${b.label}: ${b.stat.early_pct}% early, ${b.stat.on_time_pct}% on time, ${b.stat.late_pct}% late`}
                                        >
                                            {SEGMENTS.map((s, i) => {
                                                const pct = share(b.stat!, s.key)
                                                if (pct <= 0) return null
                                                return (
                                                    <div
                                                        key={s.key}
                                                        className={cn(
                                                            "h-full transition-opacity",
                                                            s.className,
                                                            i === 0 && "rounded-l",
                                                            i === SEGMENTS.length - 1 && "rounded-r",
                                                            hover && hover.band === b.band && hover.key !== s.key && "opacity-50",
                                                        )}
                                                        style={{ width: `${pct}%` }}
                                                        onMouseEnter={() => setHover({ band: b.band, key: s.key })}
                                                        onMouseLeave={() => setHover(null)}
                                                    />
                                                )
                                            })}
                                        </div>
                                        {hover?.band === b.band && (
                                            <div className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm">
                                                {SEGMENTS.find((s) => s.key === hover.key)!.label}: <span className="font-medium tabular-nums">{share(b.stat, hover.key)}%</span>
                                            </div>
                                        )}
                                        <p className="mt-1 text-xs text-muted-foreground">{b.stat.detail}</p>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </section>
    )
}

function EmptyState({ title, text }: { title: string; text: string }) {
    return (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-14 text-center text-sm text-muted-foreground">
            <Activity className="h-6 w-6" />
            <p className="font-medium text-foreground">{title}</p>
            <p className="max-w-sm">{text}</p>
        </div>
    )
}


// ── Map: the route coloured by how late it usually is ───────────────────────

const HEAT_LEGEND = [
    { color: "#0ca30c", label: "On time" },
    { color: "#fab219", label: "1–3 min late" },
    { color: "#ec835a", label: "3–5 min late" },
    { color: "#d03b3b", label: "5+ min late" },
    { color: "#2a78d6", label: "Early" },
    { color: "#9ca3af", label: "No data" },
]

function RouteMap({ map, color }: { map: RouteReliabilityReport["map"]; color: string }) {
    if (!map.line || map.stops.length < 2) return null
    const lats = map.stops.map((s) => s.lat)
    const lons = map.stops.map((s) => s.lon)
    const bounds: [[number, number], [number, number]] = [
        [Math.min(...lats), Math.min(...lons)],
        [Math.max(...lats), Math.max(...lons)],
    ]
    return (
        <section aria-labelledby="route-map" className="space-y-2">
            <h2 id="route-map" className="text-sm font-semibold">Where it runs late</h2>
            <div className="relative h-[300px] overflow-hidden rounded-xl border border-border">
                <MapComp
                    map_id="reliability-route-map"
                    height="100%"
                    defaultZoom={bounds}
                    line={{ GeoJson: map.line, color }}
                    mapItems={[]}
                />
            </div>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Map key">
                {HEAT_LEGEND.map((l) => (
                    <li key={l.label} className="flex items-center gap-1.5">
                        <span aria-hidden className="h-1 w-4 rounded-full" style={{ background: l.color }} />
                        {l.label}
                    </li>
                ))}
            </ul>
            <p className="text-xs text-muted-foreground">Each stretch is coloured by how late it usually is at the stop it leads to.</p>
        </section>
    )
}

// ── Through the day ─────────────────────────────────────────────────────────

const DAYS: { value: DayType; label: string }[] = [
    { value: "wd", label: "Weekdays" },
    { value: "sat", label: "Saturdays" },
    { value: "sun", label: "Sundays" },
]

function hourLabel(h: number): string {
    const hh = h % 24
    return hh === 0 ? "12am" : hh < 12 ? `${hh}am` : hh === 12 ? "12pm" : `${hh - 12}pm`
}

function ThroughTheDay({ hours, onDay }: { hours: RouteReliabilityReport["hours"]; onDay: (d: DayType) => void }) {
    // The service day's hours with anything on: first to last scheduled or seen.
    const busy = Array.from({ length: 24 }, (_, h) => h).filter(
        (h) => (hours.scheduled[h] ?? 0) > 0 || (hours.live[h]?.trips_per_day ?? 0) > 0 || (hours.live[h]?.samples ?? 0) > 0,
    )
    const from = busy.length ? Math.min(...busy) : 6
    const to = busy.length ? Math.max(...busy) : 22
    const range = Array.from({ length: to - from + 1 }, (_, i) => from + i)
    const anyLive = range.some((h) => hours.live[h]?.trips_per_day != null)
    const delays = range.map((h) => ({ label: hourLabel(h), value: hours.live[h]?.typical_min ?? null }))

    return (
        <section aria-labelledby="through-day" className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="through-day" className="text-sm font-semibold">Through the day</h2>
                <div className="flex rounded-md bg-muted p-0.5" role="radiogroup" aria-label="Day">
                    {DAYS.map((d) => (
                        <button
                            key={d.value}
                            type="button"
                            role="radio"
                            aria-checked={hours.day === d.value}
                            onClick={() => onDay(d.value)}
                            className={cn("rounded px-2 py-1 text-xs font-medium", hours.day === d.value ? "bg-card shadow-sm" : "text-muted-foreground")}
                        >
                            {d.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="space-y-1">
                <p className="text-xs font-medium">Services per hour</p>
                <BarChart
                    ariaLabel="Services per hour"
                    series={anyLive ? ["Timetable", "Actually ran (average)"] : ["Timetable"]}
                    data={range.map((h) => ({
                        label: hourLabel(h),
                        values: anyLive ? [hours.scheduled[h] ?? 0, hours.live[h]?.trips_per_day ?? null] : [hours.scheduled[h] ?? 0],
                    }))}
                    format={(v) => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
                />
            </div>

            {delays.some((d) => d.value !== null) ? (
                <div className="space-y-1">
                    <p className="text-xs font-medium">Typical delay (minutes)</p>
                    <LineChart ariaLabel="Typical delay by hour" points={delays} baseline={0} format={(v) => `${v > 0 ? "+" : ""}${v}`} />
                </div>
            ) : (
                <p className="text-xs text-muted-foreground">Delays by hour show up once there&apos;s a few days of live data.</p>
            )}
        </section>
    )
}

// ── Trend ───────────────────────────────────────────────────────────────────

function shortDate(iso: string): string {
    const d = new Date(`${iso}T12:00:00`)
    return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" })
}

function Trend({ trend }: { trend: RouteReliabilityReport["trend"] }) {
    const weeks = trend.weeks.filter((w) => w.on_time_pct != null)
    const useWeeks = weeks.length >= 3
    const points = (useWeeks ? trend.weeks : trend.days).map((p) => ({ label: shortDate(p.start), value: p.on_time_pct ?? null }))
    if (points.filter((p) => p.value !== null).length < 2) {
        return (
            <section className="rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold">Over time</h2>
                <p className="mt-1 text-xs text-muted-foreground">The trend fills in day by day - check back after a few days.</p>
            </section>
        )
    }
    const first = points.find((p) => p.value !== null)!.value!
    const lastPoint = [...points].reverse().find((p) => p.value !== null)!.value!
    return (
        <section aria-labelledby="trend" className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div>
                <h2 id="trend" className="text-sm font-semibold">Over time</h2>
                <p className="text-xs text-muted-foreground">
                    On time {useWeeks ? "week by week" : "day by day"}: {first}% → {lastPoint}%
                </p>
            </div>
            <LineChart ariaLabel="On-time share over time" points={points} domain={[0, 100]} format={(v) => `${v}%`} labelEvery={Math.max(1, Math.ceil(points.length / 6))} />
        </section>
    )
}

// ── Alerts ──────────────────────────────────────────────────────────────────

function Alerts({ alerts }: { alerts: RouteReliabilityReport["alerts"] }) {
    if (alerts.recent.length === 0 && alerts.weeks.length === 0) return null
    const fmt = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })
    // Every week from the first to this one, so quiet weeks show as gaps.
    const counts = new Map(alerts.weeks.map((w) => [w.week, w.alerts]))
    const weeks: { week: string; alerts: number }[] = []
    if (alerts.weeks.length > 0) {
        const cur = new Date(`${alerts.weeks[0].week}T12:00:00Z`)
        const end = new Date()
        while (cur <= end) {
            const key = cur.toISOString().slice(0, 10)
            weeks.push({ week: key, alerts: counts.get(key) ?? 0 })
            cur.setUTCDate(cur.getUTCDate() + 7)
        }
    }
    return (
        <section aria-labelledby="alerts-history" className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 id="alerts-history" className="text-sm font-semibold">Service alerts</h2>
            {weeks.length >= 2 && (
                <BarChart
                    ariaLabel="Service alerts per week"
                    series={["Alerts"]}
                    data={weeks.map((w) => ({ label: shortDate(w.week), values: [w.alerts] }))}
                    labelEvery={Math.max(1, Math.ceil(weeks.length / 6))}
                    height={70}
                />
            )}
            {alerts.recent.length > 0 && (
                <ul className="divide-y divide-border text-sm">
                    {alerts.recent.slice(0, 6).map((a) => (
                        <li key={a.id} className="py-2">
                            <p className="font-medium">{a.header || "Service alert"}</p>
                            <p className="text-xs text-muted-foreground">
                                {fmt(a.first_seen)}
                                {a.last_seen - a.first_seen > 3600 && ` – ${fmt(a.last_seen)}`}
                            </p>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}

// ── League table ────────────────────────────────────────────────────────────

function League({ onPick }: { onPick: (routeId: string) => void }) {
    const rows = useLeague(true)
    if (rows === undefined) {
        return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    }
    if (rows.length === 0) {
        return <EmptyState title="Pick a route" text="Search for a route to see how often it runs on time, when it runs late, and where. A ranking of every route appears here after a few days of live data." />
    }
    const best = rows.slice(0, 8)
    const worst = [...rows].reverse().slice(0, 8)
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            <LeagueList title="Most on time" rows={best} onPick={onPick} />
            <LeagueList title="Least on time" rows={worst} onPick={onPick} />
            <p className="text-xs text-muted-foreground sm:col-span-2">Over the last 7 days, routes with enough live data ({rows.length} of them).</p>
        </div>
    )
}

function LeagueList({ title, rows, onPick }: { title: string; rows: LeagueRow[]; onPick: (routeId: string) => void }) {
    return (
        <section className="space-y-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {rows.map((r) => (
                    <li key={r.route_id}>
                        <button type="button" onClick={() => onPick(r.route_id)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent/50">
                            <span className="rounded px-1.5 py-0.5 text-xs font-bold text-white" style={{ background: r.color ? `#${r.color}` : "#424242" }}>
                                {r.short_name || r.route_id}
                            </span>
                            <span className="flex-1 text-xs text-muted-foreground">
                                {r.late_pct}% late{r.cancelled_pct >= 1 && ` · ${r.cancelled_pct}% cancelled`}
                            </span>
                            <span className="font-mono tabular-nums">{r.on_time_pct}%</span>
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    )
}
