import { useEffect, useState } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { ApiFetch } from "@/lib/url-context"
import { cn, fullyEncodeURIComponent } from "@/lib/utils"
import { timeTillArrivalString } from "@/lib/formating"
import type { Service } from "@/components/services"

interface StopPreviewCardProps {
    /** The "name code" composite identifier used by /?s= and /services/{id} */
    stopId: string
    label: string
    /** Stop code - shown alongside the name since several distinct stops can share the same name. */
    code?: string
    meta?: string
    className?: string
}

export function StopPreviewCard({ stopId, label, code, meta, className }: StopPreviewCardProps) {
    const [services, setServices] = useState<Service[] | null>(null)
    const [error, setError] = useState(false)

    useEffect(() => {
        let cancelled = false
        setServices(null)
        setError(false)

        ApiFetch<Service[]>(`services/${fullyEncodeURIComponent(stopId)}?limit=8`).then((res) => {
            if (cancelled) return
            if (res.ok) {
                const upcoming = res.data
                    .filter((service) => service.time_till_arrival >= 0)
                    .sort((a, b) => a.time_till_arrival - b.time_till_arrival)
                    .slice(0, 2)
                setServices(upcoming)
            }
            else if (res.status_code === 404) setServices([])
            else setError(true)
        })

        return () => {
            cancelled = true
        }
    }, [stopId])

    return (
        <Link
            href={`/?s=${encodeURIComponent(stopId)}`}
            className={cn(
                "flex flex-col gap-2 rounded-md border border-border bg-card p-3 hover:border-primary/50 transition-colors min-w-0",
                className
            )}
        >
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">
                    {label}
                    {code && <span className="ml-1 font-normal text-muted-foreground">· Stop {code}</span>}
                </span>
                {meta && <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">{meta}</span>}
            </div>

            {services === null && !error && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Loading departures...
                </div>
            )}

            {error && <p className="text-xs text-muted-foreground">Couldn&apos;t load departures</p>}

            {services && services.length === 0 && (
                <p className="text-xs text-muted-foreground">No upcoming services</p>
            )}

            {services && services.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    {services.map((service) => (
                        <div key={service.trip_id} className="flex items-center gap-2 text-xs min-w-0">
                            <span
                                className="shrink-0 px-1.5 py-0.5 rounded text-white dark:text-gray-100 font-display font-medium"
                                style={{
                                    background: "#" + (service.route.color !== "" ? service.route.color : "000000"),
                                    filter: "brightness(0.9) contrast(1.1)",
                                }}
                            >
                                {service.route.name}
                            </span>
                            <span className="truncate text-foreground">{service.headsign}</span>
                            <span className="ml-auto flex items-center gap-2 shrink-0">
                                {service.platform && service.platform !== "no platform" && (
                                    <span className="text-muted-foreground">Pl {service.platform}</span>
                                )}
                                <span className="font-mono tabular-nums text-muted-foreground">
                                    {timeTillArrivalString(service.arrival_time)}
                                </span>
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </Link>
    )
}
