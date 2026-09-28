import { useState, type ReactNode } from "react"
import { ChevronDownIcon } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Bus, ChevronRight, Ship, SlidersHorizontal, TrainFront } from "lucide-react"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn, useIsMobile } from "@/lib/utils"
import { RouteMultiSelect, type RouteOption } from "./route-filter"

export type TravelMode = "bus" | "train" | "ferry"
export type TimeType = "now" | "leaveat" | "arriveat"

export const TRAVEL_MODES: { value: TravelMode; label: string; icon: typeof Bus }[] = [
    { value: "bus", label: "Bus", icon: Bus },
    { value: "train", label: "Train", icon: TrainFront },
    { value: "ferry", label: "Ferry", icon: Ship },
]

const WALK_SPEEDS: Record<string, string> = { "3": "Slow", "4.8": "Normal", "5.5": "Brisk" }

export interface PlannerOptions {
    timeType: TimeType
    selectedDate: Date
    maxWalkKm: string
    walkSpeed: string
    maxTransfers: string
    minResults: string
    onlyRoutes: RouteOption[]
    modes: TravelMode[]
}

export interface PlannerOptionsHandlers {
    onTimeTypeChange: (v: TimeType) => void
    onDateChange: (d: Date) => void
    onMaxWalkKmChange: (v: string) => void
    onWalkSpeedChange: (v: string) => void
    onMaxTransfersChange: (v: string) => void
    onMinResultsChange: (v: string) => void
    onOnlyRoutesChange: (routes: RouteOption[]) => void
    onModesChange: (modes: TravelMode[]) => void
}

/** Every option in a few words - "Leave now · 1 km walk · Normal · up to 5 transfers". */
export function optionsSummary(o: PlannerOptions): string {
    const parts: string[] = []
    const when = format(o.selectedDate, "EEE h:mma").replace("AM", "am").replace("PM", "pm")
    parts.push(o.timeType === "now" ? "Leave now" : o.timeType === "leaveat" ? `Leave ${when}` : `Arrive by ${when}`)
    parts.push(`${o.maxWalkKm} km walk`)
    parts.push(WALK_SPEEDS[o.walkSpeed] ?? `${o.walkSpeed} km/h`)
    parts.push(o.maxTransfers === "0" ? "Direct only" : `up to ${o.maxTransfers} transfer${o.maxTransfers === "1" ? "" : "s"}`)
    if (o.onlyRoutes.length > 0) parts.push(`${o.onlyRoutes.length} route${o.onlyRoutes.length === 1 ? "" : "s"} only`)
    if (o.modes.length > 0) parts.push(TRAVEL_MODES.filter((m) => o.modes.includes(m.value)).map((m) => m.label).join("/") + " only")
    return parts.join(" · ")
}

/**
 * One row that always says what the search will use and opens the options -
 * the iOS planner's options summary, rather than a wall of pickers.
 */
export function PlannerOptionsRow(props: PlannerOptions & PlannerOptionsHandlers) {
    const [open, setOpen] = useState(false)
    const summary = optionsSummary(props)
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={`Options: ${summary}`}
                className="flex w-full items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                <span className="line-clamp-2 flex-1">{summary}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            </button>
            <PlannerOptionsDialog open={open} onOpenChange={setOpen} {...props} />
        </>
    )
}

function PlannerOptionsDialog({ open, onOpenChange, ...o }: PlannerOptions & PlannerOptionsHandlers & { open: boolean; onOpenChange: (open: boolean) => void }) {
    const isMobile = useIsMobile()

    const reset = () => {
        o.onTimeTypeChange("now")
        o.onDateChange(new Date())
        o.onMaxWalkKmChange("1")
        o.onWalkSpeedChange("4.8")
        o.onMaxTransfersChange("5")
        o.onMinResultsChange("3")
        o.onOnlyRoutesChange([])
        o.onModesChange([])
    }

    const body = (
        <div className="space-y-5">
            <Section title="When">
                <Segmented
                    value={o.timeType}
                    onChange={(v) => o.onTimeTypeChange(v as TimeType)}
                    options={[
                        { value: "now", label: "Leave now" },
                        { value: "leaveat", label: "Leave at" },
                        { value: "arriveat", label: "Arrive by" },
                    ]}
                />
                {o.timeType !== "now" && <PlannerDatePicker date={o.selectedDate} onDateChange={o.onDateChange} />}
            </Section>

            <Section title="Walking">
                <Row label="Max walk">
                    <Select value={o.maxWalkKm} onValueChange={o.onMaxWalkKmChange}>
                        <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {["0.5", "1", "2", "5"].map((v) => <SelectItem key={v} value={v}>{v} km</SelectItem>)}
                        </SelectContent>
                    </Select>
                </Row>
                <Segmented
                    value={o.walkSpeed}
                    onChange={o.onWalkSpeedChange}
                    options={Object.entries(WALK_SPEEDS).map(([value, label]) => ({ value, label }))}
                />
            </Section>

            <Section title="Results">
                <Row label="Transfers">
                    <Select value={o.maxTransfers} onValueChange={o.onMaxTransfersChange}>
                        <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="0">Direct only</SelectItem>
                            {["1", "2", "3", "4", "5"].map((v) => <SelectItem key={v} value={v}>Up to {v}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </Row>
                <Row label="Show">
                    <Select value={o.minResults} onValueChange={o.onMinResultsChange}>
                        <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {["3", "5", "8"].map((v) => <SelectItem key={v} value={v}>{v} journeys</SelectItem>)}
                        </SelectContent>
                    </Select>
                </Row>
            </Section>

            <Section title="Transport" footer="Leave all off to use any transport.">
                <div className="flex flex-wrap gap-2">
                    {TRAVEL_MODES.map(({ value, label, icon: Icon }) => {
                        const on = o.modes.includes(value)
                        return (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={on}
                                onClick={() => o.onModesChange(on ? o.modes.filter((m) => m !== value) : [...o.modes, value])}
                                className={cn(
                                    "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                                    on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-accent",
                                )}
                            >
                                <Icon className="h-4 w-4" /> {label}
                            </button>
                        )
                    })}
                </div>
            </Section>

            <Section title="Only these routes" footer="Leave empty to use any route.">
                <RouteMultiSelect label="" placeholder="Search routes..." selected={o.onlyRoutes} onChange={o.onOnlyRoutesChange} />
            </Section>
        </div>
    )

    const footer = (
        <>
            <Button variant="ghost" onClick={reset}>Reset</Button>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
        </>
    )

    if (isMobile) {
        return (
            <Drawer open={open} onOpenChange={onOpenChange}>
                <DrawerContent className="max-h-[90vh]">
                    <DrawerHeader className="text-left">
                        <DrawerTitle>Options</DrawerTitle>
                    </DrawerHeader>
                    <div className="overflow-y-auto px-4 pb-2">{body}</div>
                    <DrawerFooter className="flex-row justify-end">{footer}</DrawerFooter>
                </DrawerContent>
            </Drawer>
        )
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Options</DialogTitle>
                </DialogHeader>
                {body}
                <DialogFooter className="gap-2">{footer}</DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function Section({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
    return (
        <section className="space-y-2">
            <h3 className="font-display text-xs uppercase tracking-wide text-muted-foreground">{title}</h3>
            <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">{children}</div>
            {footer && <p className="text-xs text-muted-foreground">{footer}</p>}
        </section>
    )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{label}</span>
            {children}
        </div>
    )
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
    return (
        <div className="flex rounded-lg bg-muted p-[3px]" role="radiogroup">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                        value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    )
}

function PlannerDatePicker({
    date,
    onDateChange,
    disabled,
}: {
    date: Date
    onDateChange: (date: Date) => void
    disabled?: boolean
}) {
    const [open, setOpen] = useState(false)

    const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (disabled) return
        const [hours, minutes] = e.target.value.split(":").map(Number)
        const updatedDate = new Date(date)
        updatedDate.setHours(hours, minutes, 0)
        onDateChange(updatedDate)
    }

    return (
        <div className="flex items-center gap-1.5">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        className="h-9 text-sm font-normal px-3"
                        disabled={disabled}
                    >
                        {date ? format(date, "d MMM") : "Date"}
                        <ChevronDownIcon className="h-3.5 w-3.5 ml-1" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                    <Calendar
                        mode="single"
                        selected={date}
                        captionLayout="dropdown"
                        defaultMonth={date}
                        onSelect={(selectedDate) => {
                            if (!selectedDate) return
                            const updatedDate = new Date(selectedDate)
                            updatedDate.setHours(date.getHours(), date.getMinutes(), date.getSeconds())
                            onDateChange(updatedDate)
                            setOpen(false)
                        }}
                    />
                </PopoverContent>
            </Popover>
            <Input
                type="time"
                step="60"
                value={date ? format(date, "HH:mm") : "00:00"}
                onChange={handleTimeChange}
                disabled={disabled}
                className="h-9 w-[100px] text-sm bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            />
        </div>
    )
}
