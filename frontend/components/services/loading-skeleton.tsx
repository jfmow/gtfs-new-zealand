import { Skeleton } from "@/components/ui/skeleton"

export default function ServicesLoadingSkeleton() {
    return (
        <div className="space-y-3">
            {/* Platform filter chips */}
            <div className="flex gap-1.5">
                <Skeleton className="h-7 w-20 rounded-full" />
                <Skeleton className="h-7 w-24 rounded-full" />
                <Skeleton className="h-7 w-24 rounded-full" />
            </div>

            {/* Departure list */}
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="flex items-start gap-3 px-3 py-3">
                        <Skeleton className="h-12 w-1 shrink-0 rounded-full" />
                        <div className="flex-1 space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <Skeleton className="h-4 w-10 rounded" />
                                <Skeleton className="h-6 w-14 rounded" />
                            </div>
                            <Skeleton className="h-4 w-2/5" />
                            <Skeleton className="h-3 w-3/5" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
