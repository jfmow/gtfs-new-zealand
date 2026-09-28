import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Bookmark, Route as RouteIcon } from "lucide-react"
import { useRouter } from "next/router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useSavedTrips, type SavedTrip } from "@/components/journey/use-saved-trips"
import { RenameTripDialog, TripMenu } from "@/components/journey/quick-trips-rail"
import { ManageTripsSheet } from "@/components/trips/manage-trips-sheet"
import { HomeHint, HomeSection } from "./home-section"

/** The planner link that plans a saved trip straight away (plan.tsx `?trip=`). */
export function planSavedTripHref(trip: SavedTrip) {
    return `/plan?trip=${encodeURIComponent(trip.id)}`
}

/**
 * Schedule's "Saved trips" - a swipeable row of cards (the iOS
 * `SavedTripsCarousel`). Tap one to plan it now; its menu renames,
 * recolours or deletes it.
 */
export function SavedTripsSection({ className }: { className?: string }) {
    const router = useRouter()
    const { trips, updateTrip, deleteTrip, reorderTrips } = useSavedTrips()
    const [managing, setManaging] = useState(false)
    const [renaming, setRenaming] = useState<SavedTrip | null>(null)

    return (
        <HomeSection
            title="Saved trips"
            count={trips.length}
            className={className}
            actions={trips.length > 0 && <button type="button" onClick={() => setManaging(true)}>Manage</button>}
        >
            {trips.length === 0 ? (
                <HomeHint
                    icon={Bookmark}
                    text="Plan a journey and tap the bookmark to plan it again in one tap."
                    action={<Button asChild variant="outline" size="sm" className="h-8"><Link href="/plan">Plan a journey</Link></Button>}
                />
            ) : (
                <div className="-mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1 scrollbar-hide">
                    {trips.map((trip) => (
                        <div
                            key={trip.id}
                            className={`relative shrink-0 snap-start rounded-xl border border-border bg-card shadow-sm transition-colors hover:bg-accent/40 ${trips.length === 1 ? "w-full" : "w-[236px]"}`}
                        >
                            <Link href={planSavedTripHref(trip)} className="absolute inset-0 z-0 rounded-xl" aria-label={`${trip.name}, from ${trip.startLocation.label} to ${trip.endLocation.label} - plan now`} />
                            <div className="pointer-events-none relative flex flex-col gap-3 p-3.5">
                                <div className="flex items-center gap-2.5 pr-7">
                                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg" style={{ background: `${trip.color}2e`, color: trip.color }} aria-hidden>
                                        <RouteIcon className="h-3.5 w-3.5" />
                                    </span>
                                    <span className="truncate text-sm font-medium">{trip.name}</span>
                                </div>
                                <div className="flex flex-col gap-1.5 text-xs">
                                    <span className="flex items-center gap-2 text-muted-foreground">
                                        <span className="h-2 w-2 shrink-0 rounded-full border-[1.5px] border-muted-foreground" aria-hidden />
                                        <span className="truncate">{trip.startLocation.label}</span>
                                    </span>
                                    <span className="flex items-center gap-2 text-foreground">
                                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: trip.color }} aria-hidden />
                                        <span className="truncate">{trip.endLocation.label}</span>
                                    </span>
                                </div>
                                <span className="flex items-center gap-1 text-xs font-medium" aria-hidden>
                                    Plan now <ArrowRight className="h-3 w-3" />
                                </span>
                            </div>
                            <div className="absolute right-2 top-2 z-10">
                                <TripMenu
                                    trip={trip}
                                    onRename={() => setRenaming(trip)}
                                    onSetColor={(color) => updateTrip({ ...trip, color })}
                                    onManage={() => setManaging(true)}
                                    onDelete={() => {
                                        deleteTrip(trip.id)
                                        toast.success("Trip deleted")
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <RenameTripDialog
                trip={renaming}
                onOpenChange={(open) => !open && setRenaming(null)}
                onSave={(name) => { if (renaming) updateTrip({ ...renaming, name }) }}
            />
            <ManageTripsSheet
                open={managing}
                onOpenChange={setManaging}
                savedTrips={trips}
                onLoadTrip={(trip) => router.push(planSavedTripHref(trip))}
                onDeleteTrip={deleteTrip}
                onUpdateTrip={updateTrip}
                onReorderTrips={reorderTrips}
            />
        </HomeSection>
    )
}
