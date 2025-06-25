import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function ServicesLoadingSkeleton() {
    return (
        <div className="space-y-4">
            {/* Platform filter skeleton */}
            <div className="flex mb-2 gap-2 items-center">
                <div className="w-full">
                    <Skeleton className="h-8 w-full" />
                </div>
                <div className="w-full">
                    <Skeleton className="h-8 w-full" />
                </div>
                <div className="w-full">
                    <Skeleton className="h-8 w-full" />
                </div>
            </div>

            {/* Services grid skeleton */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4 bg-secondary rounded-md">
                {Array.from({ length: 8 }).map((_, index) => (
                    <Card key={index} className="transition-all duration-300 relative">
                        <CardHeader>
                            <CardTitle>
                                <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                        <Skeleton className="h-5 w-3/4" />
                                    </div>
                                    <div className="flex gap-1 items-center mr-2">
                                        <Skeleton className="h-4 w-4 rounded" />
                                        <Skeleton className="h-4 w-4 rounded" />
                                    </div>
                                    <Skeleton className="h-6 w-12 rounded" />
                                </div>
                            </CardTitle>
                            <CardDescription>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-24" />
                                        <Skeleton className="h-4 w-20" />
                                        <div className="flex items-center gap-1">
                                            <Skeleton className="h-4 w-16" />
                                            <Skeleton className="h-4 w-4 rounded-full" />
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <Skeleton className="h-4 w-20 ml-auto" />
                                    </div>
                                </div>
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 items-center gap-2">
                                <Skeleton className="h-9 w-full" />
                                <Skeleton className="h-9 w-full" />
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Legend skeleton */}
            <div className="py-4 mt-2 space-y-2">
                <div className="flex items-center gap-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-36" />
                </div>
                <div className="flex items-center gap-4">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-38" />
                </div>
            </div>
        </div>
    )
}
