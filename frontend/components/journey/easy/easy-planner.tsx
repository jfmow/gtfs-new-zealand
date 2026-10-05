"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import {
    AlarmClock, ArrowLeft, Bus, Check, ChevronDown, ChevronUp, Clock, Footprints, Info, Loader2,
    LocateFixed, Map as MapIcon, MapPin, Navigation, RotateCcw, Route as RouteIcon, Search, Ship, Star,
    TrainFront, TriangleAlert, Undo2,
} from "lucide-react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { LocationSearchInput } from "@/components/map/search"
import { placeLocation, useSavedPlaces } from "@/components/places/use-saved-places"
import { useSavedTrips } from "@/components/journey/use-saved-trips"
import { RouteDetailSheet } from "@/components/journey/route-detail-sheet"
import { JourneyErrorBoundary } from "@/components/journey/journey-error-boundary"
import { LeaveReminderDialog } from "@/components/journey/leave-reminder-dialog"
import { getFirstTransitLeg, pruneDominatedPlans } from "@/components/journey/helpers"
import type { JourneyType, Location } from "@/components/journey/types"
import { ApiFetch, useUrl } from "@/lib/url-context"
import { getRegionSlug } from "@/lib/url-store"
import { getUserLocation } from "@/lib/userLocation"
import { cn } from "@/lib/utils"
import { inRegion, regionDayAsLocal, wallClock, withRegionDay, withRegionTime } from "@/lib/region-time"
import {
    clock, defaultArriveBy, easyAttempts, easySteps, rankedPlans, STANDARD,
    type EasyAttempt, type EasyStep, type EasyTravelMode,
} from "@/lib/easy-planner"

type Question = 0 | 1 | 2 | 3
type Status = { kind: "planning" } | { kind: "found" } | { kind: "failed"; message: string }

const REMEMBER = { modes: "easyPlanner.modes", walkLess: "easyPlanner.walkLess", startHere: "easyPlanner.startHere" }

function recall<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key)
        return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
        return fallback
    }
}
function remember(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
}

const MODE_CHOICES: { value: EasyTravelMode; label: string; icon: typeof Bus }[] = [
    { value: "bus", label: "Bus", icon: Bus },
    { value: "train", label: "Train", icon: TrainFront },
    { value: "ferry", label: "Ferry", icon: Ship },
]

/**
 * The step-by-step planner - the iOS `EasyPlannerFlow`, for riders who find
 * the full planner a lot to take in: four questions, one per screen, then one
 * recommended journey in plain words. It's the whole Planner tab when
 * Settings -> Planner is "Step by step".
 *
 * Type stays at normal sizes: it's easier because it asks one thing at a
 * time, not because the text is big.
 */
export function EasyPlanner({
    initialDestination,
    onUseFullPlanner,
}: {
    /** A saved place tapped on Schedule answers question 1. */
    initialDestination?: Location | null
    onUseFullPlanner: () => void
}) {
    const { currentUrl } = useUrl()
    const { places } = useSavedPlaces()
    const { trips, saveTrip } = useSavedTrips()

    const [question, setQuestion] = useState<Question | "results">(initialDestination ? 1 : 0)
    // 1
    const [destination, setDestination] = useState<Location | null>(initialDestination ?? null)
    const [changingDestination, setChangingDestination] = useState(false)
    // 2 - remembered for next time
    const [modes, setModes] = useState<EasyTravelMode[]>([])
    const [walkLess, setWalkLess] = useState(true)
    // 3
    const [when, setWhen] = useState<"soon" | "arriveBy">("soon")
    const [arriveBy, setArriveBy] = useState(() => defaultArriveBy())
    // 4 - "where I am now" is remembered
    const [startHere, setStartHere] = useState(true)
    const [otherStart, setOtherStart] = useState<Location | null>(null)
    const [changingStart, setChangingStart] = useState(false)
    const [locationDenied, setLocationDenied] = useState(false)
    // Results
    const [status, setStatus] = useState<Status>({ kind: "planning" })
    const [plans, setPlans] = useState<JourneyType[]>([])
    const [plannedStart, setPlannedStart] = useState<Location | null>(null)
    const [planned, setPlanned] = useState<EasyAttempt | null>(null)
    const [showOthers, setShowOthers] = useState(false)
    const [saved, setSaved] = useState(false)
    // Opened from the results
    const [detail, setDetail] = useState<{ route: JourneyType; track: boolean } | null>(null)
    const [reminderRoute, setReminderRoute] = useState<JourneyType | null>(null)

    useEffect(() => {
        setModes(recall<EasyTravelMode[]>(REMEMBER.modes, []))
        setWalkLess(recall(REMEMBER.walkLess, true))
        setStartHere(recall(REMEMBER.startHere, true))
    }, [])

    useEffect(() => {
        if (question !== 3 || !startHere || !navigator.permissions) return
        navigator.permissions.query({ name: "geolocation" }).then((r) => setLocationDenied(r.state === "denied"), () => { })
    }, [question, startHere])

    const chooseModes = (next: EasyTravelMode[]) => { setModes(next); remember(REMEMBER.modes, next) }
    const chooseWalkLess = (next: boolean) => { setWalkLess(next); remember(REMEMBER.walkLess, next) }
    const chooseStartHere = (next: boolean) => { setStartHere(next); remember(REMEMBER.startHere, next) }

    // ---- planning ----

    const plan = useCallback(async () => {
        if (!destination) return
        setQuestion("results")
        setStatus({ kind: "planning" })
        setPlans([])
        setShowOthers(false)
        setSaved(false)

        let start: Location
        if (startHere) {
            try {
                // Up to 12s, like iOS - an unanswered browser prompt would otherwise wait forever.
                const [lat, lon] = await Promise.race([
                    getUserLocation(),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 12_000)),
                ])
                const res = await ApiFetch<{ name: string }>(`/map/reverse?lat=${lat}&lon=${lon}`)
                start = { lat, lon, label: res.ok && res.data.name ? res.data.name : "Where you are now" }
            } catch {
                setStatus({ kind: "failed", message: "We couldn't find where you are. Check that this site is allowed to use your location, or choose \"Somewhere else\"." })
                return
            }
        } else if (otherStart) {
            start = otherStart
        } else {
            return
        }
        setPlannedStart(start)

        const arrive = when === "arriveBy"
        const date = arrive ? arriveBy : new Date()
        for (const attempt of easyAttempts(modes, walkLess)) {
            const o = attempt.options
            let url = `/services/plan?startLat=${start.lat}&startLon=${start.lon}&endLat=${destination.lat}&endLon=${destination.lon}` +
                `&date=${date.toISOString()}&timeType=${arrive ? "arriveat" : "now"}&maxWalkKm=${o.maxWalkKm}&walkSpeed=${o.walkSpeed}` +
                `&maxTransfers=${o.maxTransfers}&minResults=3&minTransferSec=${o.minTransferSec}`
            if (attempt.modes.length > 0) url += `&modes=${attempt.modes.join(",")}`
            if (!navigator.onLine) {
                setStatus({ kind: "failed", message: "We couldn't reach the journey planner. Check your internet connection and try again." })
                return
            }
            const res = await ApiFetch<JourneyType[]>(url)
            // The planner answers "no journey found" as an error with a reason -
            // try the next, looser search.
            if (!res.ok) continue
            const found = pruneDominatedPlans(res.data)
            if (found.length === 0) continue
            setPlans(rankedPlans(found, arrive ? arriveBy : null))
            setPlanned(attempt)
            setStatus({ kind: "found" })
            return
        }
        setStatus({ kind: "failed", message: "We couldn't find a way to get there at that time." })
    }, [destination, startHere, otherStart, when, arriveBy, modes, walkLess])

    const startOver = () => {
        setDestination(null)
        setChangingDestination(false)
        setWhen("soon")
        setArriveBy(defaultArriveBy())
        setOtherStart(null)
        setChangingStart(false)
        setPlans([])
        setQuestion(0)
    }

    const buildShareUrl = (route: JourneyType) => {
        const slug = getRegionSlug(currentUrl)
        return `${window.location.origin}/journey?id=${encodeURIComponent(route.ID)}${slug ? `&region=${slug}` : ""}`
    }

    const save = () => {
        if (!plannedStart || !destination) return
        const o = planned?.options ?? STANDARD
        saveTrip({
            name: destination.label,
            startLocation: plannedStart,
            endLocation: destination,
            maxWalkKm: String(o.maxWalkKm),
            walkSpeed: String(o.walkSpeed),
            maxTransfers: String(o.maxTransfers),
            onlyRoutes: [],
            modes: planned?.modes ?? [],
        })
        toast.success("Trip saved")
        setSaved(true)
    }

    // Saved places, then saved trips' ends (or starts), one per label.
    const savedChoices = (tripEnds: boolean): { icon: "place" | "trip"; location: Location }[] => {
        const seen = new Set<string>()
        return [
            ...places.map((p) => ({ icon: "place" as const, location: placeLocation(p) })),
            ...trips.map((t) => ({ icon: "trip" as const, location: tripEnds ? t.endLocation : t.startLocation })),
        ].filter((c) => !seen.has(c.location.label) && !!seen.add(c.location.label))
    }

    // ---- screens ----

    const back = () => {
        if (question === "results") setQuestion(3)
        else if (question > 0) setQuestion((question - 1) as Question)
    }

    const topBar = (
        <div className="mb-4 flex items-center justify-between">
            {question !== 0 ? (
                <button type="button" onClick={back} className="-ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                    <ArrowLeft className="h-4 w-4" /> Back
                </button>
            ) : <span />}
            <button type="button" onClick={onUseFullPlanner} className="rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                Full planner
            </button>
        </div>
    )

    let screen: ReactNode
    if (question === 0) {
        screen = (
            <QuestionScreen number={1} title="Where do you want to go?" buttonTitle="Next" canContinue={!!destination} onContinue={() => setQuestion(1)}>
                {destination && !changingDestination ? (
                    <SelectedPlace place={destination} onChange={() => setChangingDestination(true)} />
                ) : (
                    <PlaceSearch
                        storageKey="recentEndLocations"
                        saved={savedChoices(true)}
                        onSelect={(place) => { setDestination(place); setChangingDestination(false) }}
                    />
                )}
            </QuestionScreen>
        )
    } else if (question === 1) {
        screen = (
            <QuestionScreen number={2} title="How do you want to get there?" buttonTitle="Next" canContinue onContinue={() => setQuestion(2)}>
                <div className="space-y-3">
                    <ChoiceCard title="Any way is fine" subtitle="Bus, train or ferry" icon={<RouteIcon className="h-5 w-5" />} selected={modes.length === 0} onClick={() => chooseModes([])} />
                    {MODE_CHOICES.map(({ value, label, icon: Icon }) => {
                        const on = modes.includes(value)
                        return (
                            <ChoiceCard
                                key={value}
                                title={label}
                                subtitle={on ? "Tap again to remove" : undefined}
                                icon={<Icon className="h-5 w-5" />}
                                selected={on}
                                onClick={() => chooseModes(on ? modes.filter((m) => m !== value) : [...modes, value])}
                            />
                        )
                    })}
                </div>
                <p className="text-base text-muted-foreground">You can choose more than one.</p>
                <label className="mt-2 flex cursor-pointer items-center gap-4 rounded-2xl border border-border bg-card p-4">
                    <span className="flex-1">
                        <span className="block text-[17px] font-semibold">Walk less, fewer changes</span>
                        <span className="block text-base text-muted-foreground">Short walks at an easy pace, at most one change, and extra time to change.</span>
                    </span>
                    <Switch checked={walkLess} onCheckedChange={chooseWalkLess} aria-label="Walk less, fewer changes" />
                </label>
            </QuestionScreen>
        )
    } else if (question === 2) {
        screen = (
            <QuestionScreen
                number={3}
                title="What time do you want to get there?"
                buttonTitle="Next"
                canContinue={when === "soon" || arriveBy.getTime() > Date.now()}
                onContinue={() => setQuestion(3)}
            >
                <div className="space-y-3">
                    <ChoiceCard title="As soon as I can" subtitle="Leave now" icon={<Navigation className="h-5 w-5" />} selected={when === "soon"} onClick={() => setWhen("soon")} />
                    <ChoiceCard title="By a certain time" subtitle="Choose the time below" icon={<Clock className="h-5 w-5" />} selected={when === "arriveBy"} onClick={() => setWhen("arriveBy")} />
                </div>
                {when === "arriveBy" && <ArriveByPicker value={arriveBy} onChange={setArriveBy} />}
            </QuestionScreen>
        )
    } else if (question === 3) {
        screen = (
            <QuestionScreen
                number={4}
                title="Where are you starting from?"
                buttonTitle="Find my journey"
                canContinue={startHere || !!otherStart}
                onContinue={plan}
            >
                <div className="space-y-3">
                    <ChoiceCard title="Where I am now" subtitle="Uses your location" icon={<LocateFixed className="h-5 w-5" />} selected={startHere} onClick={() => chooseStartHere(true)} />
                    <ChoiceCard title="Somewhere else" subtitle="Search for a place" icon={<Search className="h-5 w-5" />} selected={!startHere} onClick={() => chooseStartHere(false)} />
                </div>
                {startHere && locationDenied && (
                    <p className="text-base text-destructive">This site isn&apos;t allowed to use your location. You can turn it on in your browser&apos;s settings, or choose &quot;Somewhere else&quot;.</p>
                )}
                {!startHere && (otherStart && !changingStart ? (
                    <SelectedPlace place={otherStart} onChange={() => setChangingStart(true)} />
                ) : (
                    <PlaceSearch
                        storageKey="recentStartLocations"
                        saved={savedChoices(false)}
                        onSelect={(place) => { setOtherStart(place); setChangingStart(false) }}
                    />
                ))}
            </QuestionScreen>
        )
    } else {
        const destinationName = destination?.label ?? "where you're going"
        const best = plans[0]
        const others = plans.slice(1)
        const canRemind = (route: JourneyType) =>
            !!getFirstTransitLeg(route) && new Date(route.DepartureTime).getTime() > Date.now() + 60_000
        screen = (
            <div className="space-y-5 pb-8">
                <h1 className="text-2xl font-semibold">Your journey</h1>
                {status.kind === "planning" && (
                    <div className="flex flex-col items-center gap-4 py-16 text-center" role="status">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="text-[17px] font-semibold">Finding the easiest way...</p>
                    </div>
                )}
                {status.kind === "failed" && (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-semibold">Sorry</h2>
                        <p className="text-base">{status.message}</p>
                        <p className="pt-2 text-base font-medium">You could try:</p>
                        <BigButton variant="secondary" icon={<RotateCcw className="h-5 w-5" />} onClick={plan}>Try again</BigButton>
                        <BigButton variant="secondary" icon={<Clock className="h-5 w-5" />} onClick={() => setQuestion(2)}>Change the time</BigButton>
                        <BigButton variant="secondary" icon={<Bus className="h-5 w-5" />} onClick={() => setQuestion(1)}>Change how you travel</BigButton>
                        <BigButton variant="secondary" icon={<LocateFixed className="h-5 w-5" />} onClick={() => setQuestion(3)}>Change where you start</BigButton>
                        <BigButton variant="secondary" icon={<MapPin className="h-5 w-5" />} onClick={() => { setChangingDestination(true); setQuestion(0) }}>Change where you&apos;re going</BigButton>
                    </div>
                )}
                {status.kind === "found" && best && (
                    <>
                        {planned?.note && (
                            <p className="flex gap-3 rounded-2xl bg-blue-500/10 p-4 text-base">
                                <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" /> {planned.note}
                            </p>
                        )}
                        <JourneyCard plan={best} destinationName={destinationName} recommended />
                        <div className="space-y-3">
                            <BigButton icon={<Navigation className="h-5 w-5" />} onClick={() => setDetail({ route: best, track: true })}>Start this journey</BigButton>
                            {canRemind(best) && (
                                <BigButton variant="secondary" icon={<AlarmClock className="h-5 w-5" />} onClick={() => setReminderRoute(best)}>Remind me when to leave</BigButton>
                            )}
                            <BigButton variant="secondary" icon={saved ? <Check className="h-5 w-5" /> : <Star className="h-5 w-5" />} onClick={save} disabled={saved}>
                                {saved ? "Trip saved" : "Save this trip"}
                            </BigButton>
                            <BigButton variant="secondary" icon={<MapIcon className="h-5 w-5" />} onClick={() => setDetail({ route: best, track: false })}>See it on a map</BigButton>
                        </div>
                        {others.length > 0 && (
                            <>
                                <BigButton variant="secondary" icon={showOthers ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />} onClick={() => setShowOthers(!showOthers)}>
                                    {showOthers ? "Hide other ways" : `See ${others.length} other way${others.length === 1 ? "" : "s"}`}
                                </BigButton>
                                {showOthers && others.map((other) => (
                                    <div key={other.ID} className="space-y-3">
                                        <JourneyCard plan={other} destinationName={destinationName} />
                                        <BigButton variant="secondary" icon={<Navigation className="h-5 w-5" />} onClick={() => setDetail({ route: other, track: true })}>Use this one</BigButton>
                                    </div>
                                ))}
                            </>
                        )}
                        <BigButton variant="secondary" icon={<Undo2 className="h-5 w-5" />} onClick={startOver}>Plan another journey</BigButton>
                    </>
                )}
            </div>
        )
    }

    return (
        <div className="mx-auto w-full max-w-xl px-4 pt-2">
            {topBar}
            {screen}

            {detail && (
                <JourneyErrorBoundary resetKey={detail.route.ID}>
                    <RouteDetailSheet
                        open
                        onOpenChange={(open) => { if (!open) setDetail(null) }}
                        route={detail.route}
                        startLocation={plannedStart}
                        endLocation={destination}
                        buildShareUrl={buildShareUrl}
                        onShowAlternates={() => setDetail(null)}
                        autoTrack={detail.track}
                        onRemindToLeave={setReminderRoute}
                    />
                </JourneyErrorBoundary>
            )}
            <LeaveReminderDialog
                open={!!reminderRoute}
                onOpenChange={(open) => { if (!open) setReminderRoute(null) }}
                route={reminderRoute}
                deeplink={reminderRoute ? new URL(buildShareUrl(reminderRoute)).pathname + new URL(buildShareUrl(reminderRoute)).search : undefined}
                requestContext={{
                    startLocation: plannedStart,
                    endLocation: destination,
                    maxWalkKm: String((planned?.options ?? STANDARD).maxWalkKm),
                    walkSpeed: String((planned?.options ?? STANDARD).walkSpeed),
                    maxTransfers: String((planned?.options ?? STANDARD).maxTransfers),
                    onlyRoutes: [],
                    modes: planned?.modes ?? [],
                    timeType: when === "arriveBy" ? "arriveat" : "now",
                    selectedDate: when === "arriveBy" ? arriveBy : new Date(),
                }}
            />
        </div>
    )
}

// ---------------------------------------------------------------------------
// building blocks

/** One question: "Question 2 of 4", the question, the answers, and a full-width button pinned to the bottom. */
function QuestionScreen({
    number, title, buttonTitle, canContinue, onContinue, children,
}: {
    number: number
    title: string
    buttonTitle: string
    canContinue: boolean
    onContinue: () => void
    children: ReactNode
}) {
    return (
        <section aria-labelledby="easy-question" className="flex min-h-[calc(100svh-10rem-var(--tabbar-h))] flex-col">
            <div className="flex-1 space-y-4">
                <div>
                    <p className="text-base font-medium text-muted-foreground">Question {number} of 4</p>
                    <h1 id="easy-question" className="text-2xl font-semibold">{title}</h1>
                </div>
                {children}
            </div>
            <div className="sticky bottom-[var(--tabbar-h)] -mx-4 mt-6 bg-background px-4 py-3">
                <BigButton onClick={onContinue} disabled={!canContinue}>{buttonTitle}</BigButton>
            </div>
        </section>
    )
}

function BigButton({
    children, icon, onClick, disabled, variant = "primary",
}: {
    children: ReactNode
    icon?: ReactNode
    onClick: () => void
    disabled?: boolean
    variant?: "primary" | "secondary"
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-2xl px-3 text-center text-[17px] font-semibold transition-colors disabled:cursor-not-allowed",
                variant === "primary"
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-35"
                    : "border border-border bg-card text-foreground hover:bg-accent disabled:opacity-60",
            )}
        >
            {icon}
            {children}
        </button>
    )
}

/** A large answer card - an icon, words, and a tick when chosen. */
function ChoiceCard({ title, subtitle, icon, selected, onClick }: { title: string; subtitle?: string; icon: ReactNode; selected: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            onClick={onClick}
            className={cn(
                "flex min-h-[60px] w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition-colors",
                selected ? "border-2 border-primary bg-accent" : "border border-border bg-card hover:bg-accent/60",
            )}
        >
            <span className="flex w-7 justify-center" aria-hidden>{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold">{title}</span>
                {subtitle && <span className="block text-base text-muted-foreground">{subtitle}</span>}
            </span>
            <span
                className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", selected ? "bg-primary text-primary-foreground" : "border-2 border-border")}
                aria-hidden
            >
                {selected && <Check className="h-4 w-4" strokeWidth={3} />}
            </span>
        </button>
    )
}

/** The chosen place, with a way to change it. */
function SelectedPlace({ place, onChange }: { place: Location; onChange: () => void }) {
    return (
        <div className="space-y-3.5 rounded-2xl border-2 border-primary bg-accent p-4" aria-label={`Chosen: ${place.label}`}>
            <div className="flex items-start gap-3.5">
                <MapPin className="mt-0.5 h-6 w-6 shrink-0 fill-red-500 text-red-600" aria-hidden />
                <p className="text-[17px] font-semibold">{place.label}</p>
            </div>
            <BigButton variant="secondary" icon={<Undo2 className="h-5 w-5" />} onClick={onChange}>Choose a different place</BigButton>
        </div>
    )
}

/** Search for a place, with saved places underneath - the planner's search, laid out as a page. */
function PlaceSearch({
    storageKey, saved, onSelect,
}: {
    storageKey: string
    saved: { icon: "place" | "trip"; location: Location }[]
    onSelect: (place: Location) => void
}) {
    return (
        <div className="space-y-4">
            <div className="[&_input]:h-12 [&_input]:text-base">
                <LocationSearchInput
                    placeholder="Type a place or address"
                    storageKey={storageKey}
                    showSavedPlaces={false}
                    onSelect={(loc) => { if (loc) onSelect(loc) }}
                />
            </div>
            {saved.length > 0 && (
                <div className="space-y-2">
                    <p className="text-base font-medium text-muted-foreground">Your saved places</p>
                    {saved.map(({ icon, location }) => (
                        <button
                            key={location.label}
                            type="button"
                            onClick={() => onSelect(location)}
                            className="flex min-h-[56px] w-full items-center gap-3.5 rounded-2xl border border-border bg-card px-4 py-3 text-left text-[17px] font-semibold hover:bg-accent/60"
                        >
                            {icon === "place" ? <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" /> : <Star className="h-5 w-5 shrink-0 text-muted-foreground" />}
                            <span className="line-clamp-2">{location.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

/** Today / Tomorrow, a time, a sentence saying it back, and another day. */
function ArriveByPicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
    // Days and times are on the region's clock; `today`/`tomorrow`/`valueDay`
    // are browser-local midnights standing in for those region days.
    const today = regionDayAsLocal(new Date())
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    const valueDay = regionDayAsLocal(value)
    const valueClock = wallClock(value)
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
    const setDay = (day: Date) => onChange(withRegionDay(value, day))
    const pad = (n: number) => String(n).padStart(2, "0")
    const dayWord = sameDay(valueDay, today)
        ? "today"
        : sameDay(valueDay, tomorrow)
            ? "tomorrow"
            : "on " + value.toLocaleDateString("en-NZ", inRegion({ weekday: "long", day: "numeric", month: "long" }))

    return (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
            <div className="flex gap-2.5">
                {[{ label: "Today", day: today }, { label: "Tomorrow", day: tomorrow }].map(({ label, day }) => (
                    <button
                        key={label}
                        type="button"
                        aria-pressed={sameDay(valueDay, day)}
                        onClick={() => setDay(day)}
                        className={cn(
                            "min-h-12 flex-1 rounded-xl text-[17px] font-semibold transition-colors",
                            sameDay(valueDay, day) ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-accent",
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <label className="block">
                <span className="sr-only">Arrive by</span>
                <input
                    type="time"
                    value={`${pad(valueClock.hour)}:${pad(valueClock.minute)}`}
                    onChange={(e) => {
                        const [h, m] = e.target.value.split(":").map(Number)
                        if (Number.isNaN(h) || Number.isNaN(m)) return
                        onChange(withRegionTime(value, h, m))
                    }}
                    className="h-14 w-full rounded-xl border border-input bg-background px-4 text-center text-2xl font-semibold tabular-nums"
                />
            </label>
            <p className="text-base font-medium">You want to arrive by {clock(value)} {dayWord}.</p>
            {value.getTime() <= Date.now() && <p className="text-base text-destructive">That time has already passed - choose a later one.</p>}
            <label className="flex items-center justify-between gap-3 text-base">
                Another day
                <input
                    type="date"
                    value={`${valueDay.getFullYear()}-${pad(valueDay.getMonth() + 1)}-${pad(valueDay.getDate())}`}
                    min={`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`}
                    onChange={(e) => {
                        const [y, mo, d] = e.target.value.split("-").map(Number)
                        if (!y || !mo || !d) return
                        setDay(new Date(y, mo - 1, d))
                    }}
                    className="h-10 rounded-lg border border-input bg-background px-3"
                />
            </label>
        </div>
    )
}

/** One journey in plain words: when to leave, numbered steps, when you'll arrive. */
function JourneyCard({ plan, destinationName, recommended }: { plan: JourneyType; destinationName: string; recommended?: boolean }) {
    const steps = easySteps(plan, destinationName)
    const disrupted = plan.Legs.some((l) => l.Mode === "transit" && l.trip_usable === false)
    return (
        <div className={cn("space-y-3.5 rounded-[18px] bg-card p-5", recommended ? "border-2 border-primary" : "border border-border")}>
            {recommended && <p className="text-base font-medium text-green-700 dark:text-green-400">The easiest way</p>}
            <p className="text-[17px] font-semibold text-muted-foreground">
                Leave at <span className="text-[22px] font-bold text-foreground">{clock(plan.DepartureTime)}</span>
            </p>
            <ol className="space-y-3">
                {steps.map((step, i) => <StepRow key={i} number={i + 1} step={step} />)}
            </ol>
            <p className="text-[17px] font-semibold text-muted-foreground">
                You&apos;ll arrive at <span className="text-[22px] font-bold text-foreground">{clock(plan.ArrivalTime)}</span>
            </p>
            {disrupted && (
                <p className="flex items-center gap-2 text-base font-medium text-destructive">
                    <TriangleAlert className="h-5 w-5 shrink-0" /> One of these services has a problem today. It may not run.
                </p>
            )}
        </div>
    )
}

function StepRow({ number, step }: { number: number; step: EasyStep }) {
    const Icon = step.kind === "walk" ? Footprints : step.mode === "train" ? TrainFront : step.mode === "ferry" ? Ship : Bus
    return (
        <li className="flex items-start gap-3.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted" aria-hidden>
                <Icon className="h-4 w-4" />
            </span>
            <span>
                <span className="block text-[17px] font-semibold">{number}. {step.headline}</span>
                {step.detail && <span className="block text-base text-muted-foreground">{step.detail}</span>}
            </span>
        </li>
    )
}
