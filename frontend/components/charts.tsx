import { useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Small charts for the reliability pages - plain HTML/SVG, no chart library.
 * Colours are the dataviz palette's first categorical slots (validated light
 * and dark); marks are thin, bars have 2px gaps and rounded data ends, axes
 * and grid stay recessive, and every chart has a hover tooltip.
 */

export const SERIES = [
    { fill: "bg-[#2a78d6] dark:bg-[#3987e5]", stroke: "stroke-[#2a78d6] dark:stroke-[#3987e5]", dot: "fill-[#2a78d6] dark:fill-[#3987e5]" },
    { fill: "bg-[#eb6834] dark:bg-[#d95926]", stroke: "stroke-[#eb6834] dark:stroke-[#d95926]", dot: "fill-[#eb6834] dark:fill-[#d95926]" },
] as const

export interface BarDatum {
    /** Axis label (shown for a few bars only, to stay legible). */
    label: string
    /** One value per series; null = no data. */
    values: (number | null)[]
}

/** Legend for two or more series - identity never rests on colour alone. */
export function Legend({ names }: { names: string[] }) {
    if (names.length < 2) return null
    return (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
            {names.map((n, i) => (
                <li key={n} className="flex items-center gap-1.5">
                    <span aria-hidden className={cn("h-2.5 w-2.5 rounded-sm", SERIES[i % SERIES.length].fill)} />
                    {n}
                </li>
            ))}
        </ul>
    )
}

/** Vertical bars, grouped when there's more than one series. */
export function BarChart({
    data,
    series,
    format = (v) => String(v),
    labelEvery = 3,
    height = 120,
    ariaLabel,
}: {
    data: BarDatum[]
    series: string[]
    format?: (v: number) => string
    labelEvery?: number
    height?: number
    ariaLabel: string
}) {
    const [hover, setHover] = useState<number | null>(null)
    const max = Math.max(1, ...data.flatMap((d) => d.values.map((v) => v ?? 0)))
    return (
        <div className="space-y-2">
            <Legend names={series} />
            <div className="relative" role="img" aria-label={ariaLabel}>
                <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" style={{ top: 0 }} />
                <span className="pointer-events-none absolute -top-2 right-0 bg-card pl-1 text-[10px] tabular-nums text-muted-foreground">{format(max)}</span>
                <div className="flex items-end gap-[2px] border-b border-border" style={{ height }}>
                    {data.map((d, i) => (
                        <div
                            key={i}
                            className="relative flex h-full flex-1 items-end gap-[2px]"
                            onMouseEnter={() => setHover(i)}
                            onMouseLeave={() => setHover(null)}
                        >
                            {d.values.map((v, s) => (
                                <div
                                    key={s}
                                    className={cn(
                                        "flex-1 rounded-t-[4px] transition-opacity",
                                        SERIES[s % SERIES.length].fill,
                                        hover !== null && hover !== i && "opacity-40",
                                    )}
                                    style={{ height: v ? `${(v / max) * 100}%` : 0 }}
                                />
                            ))}
                            {hover === i && (
                                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm">
                                    <p className="font-medium">{d.label}</p>
                                    {d.values.map((v, s) => (
                                        <p key={s} className="tabular-nums text-muted-foreground">
                                            {series.length > 1 && `${series[s]}: `}
                                            <span className="text-foreground">{v === null ? "no data" : format(v)}</span>
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <AxisLabels labels={data.map((d) => d.label)} every={labelEvery} at={(i) => ((i + 0.5) / data.length) * 100} />
            </div>
        </div>
    )
}

/** One series as a 2px line over evenly spaced points; gaps where there's no data. */
export function LineChart({
    points,
    format = (v) => String(v),
    domain,
    labelEvery = 4,
    height = 120,
    ariaLabel,
    baseline,
}: {
    points: { label: string; value: number | null }[]
    format?: (v: number) => string
    /** Fixed y range, e.g. [0, 100] for a percentage. */
    domain?: [number, number]
    labelEvery?: number
    height?: number
    ariaLabel: string
    /** A reference line (e.g. 0 min late). */
    baseline?: number
}) {
    const [hover, setHover] = useState<number | null>(null)
    const values = points.map((p) => p.value).filter((v): v is number => v !== null)
    if (values.length === 0) return null
    let [lo, hi] = domain ?? [Math.min(...values, baseline ?? Infinity), Math.max(...values, baseline ?? -Infinity)]
    if (hi === lo) hi = lo + 1
    const pad = domain ? 0 : (hi - lo) * 0.1
    lo -= pad
    hi += pad
    const w = 100
    const x = (i: number) => (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w)
    const y = (v: number) => (1 - (v - lo) / (hi - lo)) * 100

    // Split into runs so missing points leave a gap rather than a false line.
    const runs: string[] = []
    let cur: string[] = []
    points.forEach((p, i) => {
        if (p.value === null) {
            if (cur.length) runs.push(cur.join(" "))
            cur = []
        } else cur.push(`${x(i)},${y(p.value)}`)
    })
    if (cur.length) runs.push(cur.join(" "))

    const h = hover !== null ? points[hover] : null
    return (
        <div className="relative" role="img" aria-label={ariaLabel}>
            <div className="relative" style={{ height }}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
                    {baseline !== undefined && baseline >= lo && baseline <= hi && (
                        <line x1={0} x2={w} y1={y(baseline)} y2={y(baseline)} className="stroke-border" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
                    )}
                    {runs.map((r, i) =>
                        r.includes(" ") ? (
                            <polyline key={i} points={r} fill="none" className={SERIES[0].stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                        ) : null,
                    )}
                    {hover !== null && h?.value != null && (
                        <line x1={x(hover)} x2={x(hover)} y1={0} y2={100} className="stroke-muted-foreground/40" vectorEffect="non-scaling-stroke" />
                    )}
                </svg>
                {/* Points as HTML so they stay round on a stretched SVG. */}
                {points.map((p, i) =>
                    p.value === null ? null : (
                        <span
                            key={i}
                            className={cn(
                                "pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
                                SERIES[0].fill,
                                hover === i || values.length <= 12 ? "opacity-100" : "opacity-0",
                            )}
                            style={{ left: `${x(i)}%`, top: `${y(p.value)}%` }}
                        />
                    ),
                )}
                <div className="absolute inset-0 flex">
                    {points.map((_, i) => (
                        <div key={i} className="h-full flex-1" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
                    ))}
                </div>
                {h && (
                    <div
                        className="pointer-events-none absolute -top-8 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm"
                        style={{ left: `${x(hover!)}%` }}
                    >
                        {h.label}: <span className="font-medium tabular-nums">{h.value === null ? "no data" : format(h.value)}</span>
                    </div>
                )}
                <span className="pointer-events-none absolute right-0 top-0 -translate-y-full text-[10px] tabular-nums text-muted-foreground">{format(Math.round(hi))}</span>
                <span className="pointer-events-none absolute bottom-0 right-0 translate-y-full text-[10px] tabular-nums text-muted-foreground">{format(Math.round(lo))}</span>
            </div>
            <div className="mt-3">
                <AxisLabels labels={points.map((p) => p.label)} every={labelEvery} at={x} />
            </div>
        </div>
    )
}

/** Every `every`th label, centred under its point (at: index -> % across). */
function AxisLabels({ labels, every, at }: { labels: string[]; every: number; at: (i: number) => number }) {
    return (
        <div className="relative mt-1 h-3 text-[10px] text-muted-foreground" aria-hidden>
            {labels.map((l, i) =>
                i % every === 0 ? (
                    <span key={i} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${at(i)}%` }}>
                        {l}
                    </span>
                ) : null,
            )}
        </div>
    )
}
