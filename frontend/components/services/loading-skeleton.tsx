import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function ServicesLoadingSkeleton() {
    return (
        <div className="space-y-4">
            {/* Platform chip filter skeleton */}
            <div className="flex gap-1.5">
                <Skeleton className="h-7 w-16 rounded-full" />
                <Skeleton className="h-7 w-24 rounded-full" />
                <Skeleton className="h-7 w-24 rounded-full" />
                <Skeleton className="h-7 w-24 rounded-full" />
            </div>

            {/* Services grid skeleton */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, index) => (
                    <Card key={index} className="overflow-hidden">
                        <CardHeader className="p-4 pb-3">
                            <div className="flex items-start gap-2.5">
                                <Skeleton className="h-5 w-10 rounded shrink-0 mt-0.5" />
                                <div className="flex-1 space-y-1.5">
                                    <Skeleton className="h-4 w-3/4" />
                                    <Skeleton className="h-3 w-1/3" />
                                </div>
                                <Skeleton className="h-8 w-12 rounded-lg shrink-0" />
                            </div>
                        </CardHeader>
                        <CardContent className="px-4 pb-4 pt-0">
                            <div className="flex items-end justify-between mb-3">
                                <div className="space-y-1.5">
                                    <Skeleton className="h-3.5 w-28" />
                                    <Skeleton className="h-3.5 w-20" />
                                </div>
                                <Skeleton className="h-7 w-8" />
                            </div>
                            <div className="flex items-center gap-2">
                                <Skeleton className="h-9 flex-1 rounded-md" />
                                <Skeleton className="h-4 w-4 rounded shrink-0" />
                                <Skeleton className="h-4 w-4 rounded shrink-0" />
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}
