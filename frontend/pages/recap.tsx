import { useEffect, useMemo, useState } from "react"
import { BarChart3 } from "lucide-react"
import { Header } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { BarChart } from "@/components/charts"
import { cn } from "@/lib/utils"
import { CO2_KG_PER_KM, clearTravel, readTravel, summarise, type TravelRecord } from "@/lib/travel-history"

type Period = "month" | "last" | "all"

const PERIODS: { value: Period; label: string }[] = [
    { value: "month", label: "This month" },
    { value: "last", label: "Last month" },
    { value: "all", label: "All time" },
]

function inPeriod(r: TravelRecord, p: Period, now: Date): boolean {
    if (p === "all") return true
    const d = new Date(r.at)
    const month = new Date(now.getFullYear(), now.getMonth() - (p === "last" ? 1 : 0), 1)
    return d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth()
}

function money(cents: number, currency?: string) {
    return new Intl.NumberFormat("en-NZ", { style: "currency", currency: currency ?? "NZD" }).format(cents / 100)
}

/**
 * Your travel - totals from the journeys you've tracked on this device:
 * trips, time on board, distance, spend and CO2 saved against driving.
 * Nothing leaves the device.
 */
export default function RecapPage() {
    const [records, setRecords] = useState<TravelRecord[] | null>(null)
    const [period, setPeriod] = useState<Period>("month")
    useEffect(() => setRecords(readTravel()), [])
    const now = useMemo(() => new Date(), [])

    const shown = (records ?? []).filter((r) => inPeriod(r, period, now))
    const s = summarise(shown)
    const rideKm = s.km.bus + s.km.train + s.km.ferry

    // Trips per week over the last 12 weeks, for a sense of habit.
    const weeks = useMemo(() => {
        const out: { label: string; values: (number | null)[] }[] = []
        const start = new Date(now)
        start.setHours(0, 0, 0, 0)
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * 11)
        for (let w = 0; w < 12; w++) {
            const from = new Date(start)
            from.setDate(start.getDate() + 7 * w)
            const to = new Date(from)
            to.setDate(from.getDate() + 7)
            out.push({
                label: from.toLocaleDateString("en-NZ", { day: "numeric", month: "short" }),
                values: [(records ?? []).filter((r) => r.at >= from.getTime() && r.at < to.getTime()).length],
            })
        }
        return out
    }, [records, now])

    return (
        <>
            <Header title="Your travel" />
            <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pb-10">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Your travel</h1>
                    <p className="mt-1 text-sm text-muted-foreground">From the journeys you&apos;ve tracked with Go on this device. It stays on this device.</p>
                </div>

                {records !== null && records.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-14 text-center text-sm text-muted-foreground">
                        <BarChart3 className="h-6 w-6" />
                        <p className="font-medium text-foreground">Nothing yet</p>
                        <p className="max-w-sm">Plan a journey and press Go to track it - it&apos;ll add up here.</p>
                    </div>
                ) : records !== null && (
                    <>
                        <div className="flex rounded-md bg-muted p-0.5" role="radiogroup" aria-label="Period">
                            {PERIODS.map((p) => (
                                <button
                                    key={p.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={period === p.value}
                                    onClick={() => setPeriod(p.value)}
                                    className={cn("flex-1 rounded px-2 py-1.5 text-sm font-medium", period === p.value ? "bg-card shadow-sm" : "text-muted-foreground")}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Tile label="Trips" value={String(s.trips)} />
                            <Tile label="On board" value={s.rideMinutes >= 120 ? `${Math.round(s.rideMinutes / 60)} h` : `${s.rideMinutes} min`} />
                            <Tile label="Travelled" value={`${Math.round(rideKm)} km`} detail={s.km.walk >= 1 ? `+ ${s.km.walk.toFixed(1)} km walked` : undefined} />
                            <Tile
                                label="Spent"
                                value={s.pricedTrips > 0 ? money(s.spentCents, s.currency) : "–"}
                                detail={s.pricedTrips < s.trips ? `${s.trips - s.pricedTrips} trip${s.trips - s.pricedTrips === 1 ? "" : "s"} not priced` : undefined}
                            />
                        </div>

                        <section className="rounded-xl border border-border bg-card p-4">
                            <p className="text-sm text-muted-foreground">CO₂ saved against driving</p>
                            <p className="mt-1 text-2xl font-semibold tracking-tight text-green-700 dark:text-green-400">about {s.co2SavedKg.toFixed(s.co2SavedKg < 10 ? 1 : 0)} kg</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                {Math.round(s.km.bus)} km by bus, {Math.round(s.km.train)} by train, {Math.round(s.km.ferry)} by ferry - rough figures per passenger-km: car {CO2_KG_PER_KM.car} kg, bus {CO2_KG_PER_KM.bus}, electric train {CO2_KG_PER_KM.train}, ferry {CO2_KG_PER_KM.ferry}.
                            </p>
                        </section>

                        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
                            <h2 className="text-sm font-semibold">Trips per week</h2>
                            <BarChart ariaLabel="Trips per week, last 12 weeks" series={["Trips"]} data={weeks} labelEvery={3} height={90} />
                        </section>

                        <div className="flex justify-end">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground"
                                onClick={() => { clearTravel(); setRecords([]) }}
                            >
                                Clear history
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </>
    )
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
            {detail && <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>}
        </div>
    )
}
