import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { Plus, Route, ScanLine } from "lucide-react"
import { useUrl } from "@/lib/url-context"
import { hasRealtime } from "@/lib/url-store"
import { cn } from "@/lib/utils"
import { placeIcon, useSavedPlaces, type PlaceIconKey } from "@/components/places/use-saved-places"
import { ManagePlacesDialog, PlaceEditorDialog, planToPlaceHref, type PlaceEditorTarget } from "@/components/places/places"
import { useSavedTrips } from "@/components/journey/use-saved-trips"
import { planSavedTripHref } from "./saved-trips-section"
import { ManageTripsSheet } from "@/components/trips/manage-trips-sheet"
import FindCurrentVehicle from "@/components/services/assistance/find-closest-vehicle"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { useRouter } from "next/router"

/** "Good afternoon", then the date and region - iOS `HomeGreeting`. */
export function HomeGreeting() {
    const { currentUrl } = useUrl()
    const [now, setNow] = useState<Date | null>(null)
    useEffect(() => {
        setNow(new Date())
        const id = setInterval(() => setNow(new Date()), 60_000)
        return () => clearInterval(id)
    }, [])
    if (!now) return <div className="h-[52px]" />
    const hour = now.getHours()
    const greeting = hour >= 5 && hour < 12 ? "Good morning" : hour < 17 && hour >= 12 ? "Good afternoon" : hour >= 17 && hour < 22 ? "Good evening" : "Late one?"
    const region = currentUrl.displayName.replace(/ Transport$| Metlink$/, "")
    return (
        <div>
            <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
            <p className="text-[13px] text-muted-foreground">
                {now.toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "long" })} · {region}
            </p>
        </div>
    )
}

/**
 * Shortcuts as round icon buttons with a label underneath, like a dock -
 * iOS `HomeShortcutsRow`: Find my vehicle (realtime regions), your places
 * and saved trips (one tap plans the journey), then add. Right-click (or
 * long-press) a place or trip for its options.
 */
export function HomeLauncher() {
    const router = useRouter()
    const { currentUrl } = useUrl()
    const realtime = hasRealtime(currentUrl)
    const { places, deletePlace } = useSavedPlaces()
    const { trips, deleteTrip, updateTrip, reorderTrips } = useSavedTrips()
    const [editor, setEditor] = useState<PlaceEditorTarget | null>(null)
    const [managingPlaces, setManagingPlaces] = useState(false)
    const [managingTrips, setManagingTrips] = useState(false)
    const [findingVehicle, setFindingVehicle] = useState(false)

    const hasIcon = (key: PlaceIconKey) => places.some((p) => p.icon === key)

    return (
        <div className="-mx-4 flex gap-1 overflow-x-auto px-3 pb-1 scrollbar-hide">
            {realtime && (
                <LauncherItem label="Find vehicle" onClick={() => setFindingVehicle(true)} ariaLabel="Find my vehicle">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <ScanLine className="h-6 w-6" />
                    </span>
                </LauncherItem>
            )}
            {places.map((place) => {
                const meta = placeIcon(place.icon)
                return (
                    <ContextMenu key={place.id}>
                        <ContextMenuTrigger asChild>
                            <div>
                                <LauncherItem label={place.name} href={planToPlaceHref(place)} ariaLabel={`${place.name} - plans a trip to ${place.address}`}>
                                    <Tinted color={meta.color}><meta.icon className="h-6 w-6" /></Tinted>
                                </LauncherItem>
                            </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                            <ContextMenuItem onSelect={() => setEditor({ place })}>Edit</ContextMenuItem>
                            <ContextMenuItem onSelect={() => setManagingPlaces(true)}>Manage places</ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem className="text-destructive" onSelect={() => deletePlace(place.id)}>Delete</ContextMenuItem>
                        </ContextMenuContent>
                    </ContextMenu>
                )
            })}
            {trips.map((trip) => (
                <ContextMenu key={trip.id}>
                    <ContextMenuTrigger asChild>
                        <div>
                            <LauncherItem label={trip.name} href={planSavedTripHref(trip)} ariaLabel={`${trip.name}, from ${trip.startLocation.label} to ${trip.endLocation.label}`}>
                                <Tinted color={trip.color}><Route className="h-5 w-5" /></Tinted>
                            </LauncherItem>
                        </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                        <ContextMenuItem onSelect={() => setManagingTrips(true)}>Manage trips</ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="text-destructive" onSelect={() => deleteTrip(trip.id)}>Delete</ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu>
            ))}
            {places.length < 2 && !hasIcon("home") && <AddItem label="Add home" onClick={() => setEditor({ preset: { name: "Home", icon: "home" } })} />}
            {places.length < 2 && !hasIcon("work") && <AddItem label="Add work" onClick={() => setEditor({ preset: { name: "Work", icon: "work" } })} />}
            <AddItem label="Add" ariaLabel="Add place" onClick={() => setEditor({ preset: { name: "", icon: "pin" } })} />

            <PlaceEditorDialog target={editor} onOpenChange={(open) => !open && setEditor(null)} />
            <ManagePlacesDialog
                open={managingPlaces}
                onOpenChange={setManagingPlaces}
                onEdit={(place) => { setManagingPlaces(false); setEditor({ place }) }}
                onAdd={() => { setManagingPlaces(false); setEditor({ preset: { name: "", icon: "pin" } }) }}
            />
            <ManageTripsSheet
                open={managingTrips}
                onOpenChange={setManagingTrips}
                savedTrips={trips}
                onLoadTrip={(trip) => { setManagingTrips(false); router.push(planSavedTripHref(trip)) }}
                onDeleteTrip={deleteTrip}
                onUpdateTrip={updateTrip}
                onReorderTrips={reorderTrips}
            />
            {realtime && <FindCurrentVehicle open={findingVehicle} onOpenChange={setFindingVehicle} />}
        </div>
    )
}

function Tinted({ color, children }: { color: string; children: ReactNode }) {
    return (
        <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: `${color}29`, color }}>
            {children}
        </span>
    )
}

function LauncherItem({ label, href, onClick, ariaLabel, children }: { label: string; href?: string; onClick?: () => void; ariaLabel?: string; children: ReactNode }) {
    const body = (
        <>
            {children}
            <span className="w-full truncate text-center text-xs font-medium text-foreground">{label}</span>
        </>
    )
    const className = "flex w-[72px] shrink-0 flex-col items-center gap-1.5 rounded-xl py-1 transition-opacity hover:opacity-80"
    return href ? (
        <Link href={href} aria-label={ariaLabel ?? label} className={className}>{body}</Link>
    ) : (
        <button type="button" onClick={onClick} aria-label={ariaLabel ?? label} className={className}>{body}</button>
    )
}

function AddItem({ label, ariaLabel, onClick }: { label: string; ariaLabel?: string; onClick: () => void }) {
    return (
        <LauncherItem label={label} onClick={onClick} ariaLabel={ariaLabel}>
            <span className={cn("flex h-14 w-14 items-center justify-center rounded-full border-[1.5px] border-dashed border-border text-muted-foreground")}>
                <Plus className="h-5 w-5" />
            </span>
        </LauncherItem>
    )
}
