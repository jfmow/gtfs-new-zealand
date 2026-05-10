"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Pencil, Trash2 } from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Location {
  lat: number
  lon: number
  label: string
}

export interface SavedTrip {
  id: string
  name: string
  startLocation: Location
  endLocation: Location
  savedAt: string
  maxWalkKm: string
  walkSpeed: string
  maxTransfers: string
}

type OverrideKey = "maxWalkKm" | "walkSpeed" | "maxTransfers"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WALK_SPEED_LABELS: Record<string, string> = {
  "3": "Slow",
  "4.8": "Normal",
  "5.5": "Brisk",
}

// ─── SaveTripDialog ───────────────────────────────────────────────────────────

interface SaveTripDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  startLocation: Location | null
  endLocation: Location | null
  maxWalkKm: string
  walkSpeed: string
  maxTransfers: string
  onSave: (name: string) => void
}

export function SaveTripDialog({
  open,
  onOpenChange,
  startLocation,
  endLocation,
  onSave,
}: SaveTripDialogProps) {
  const defaultName =
    startLocation && endLocation
      ? `${startLocation.label} → ${endLocation.label}`
      : ""

  const [name, setName] = useState(defaultName)

  useEffect(() => {
    if (open) setName(defaultName)
  }, [open, defaultName])

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Save trip</DialogTitle>
        </DialogHeader>

        {startLocation && endLocation && (
          <p className="text-xs text-muted-foreground truncate -mt-1">
            {startLocation.label} → {endLocation.label}
          </p>
        )}

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
          placeholder="Trip name"
          autoFocus
          className="h-9"
        />

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── EditTripDialog (internal) ────────────────────────────────────────────────

function EditTripDialog({
  trip,
  open,
  onOpenChange,
  onSave,
}: {
  trip: SavedTrip
  open: boolean
  onOpenChange: (v: boolean) => void
  onSave: (updated: SavedTrip) => void
}) {
  const [name, setName] = useState(trip.name)
  const [maxWalkKm, setMaxWalkKm] = useState(trip.maxWalkKm)
  const [walkSpeed, setWalkSpeed] = useState(trip.walkSpeed)
  const [maxTransfers, setMaxTransfers] = useState(trip.maxTransfers)

  useEffect(() => {
    if (open) {
      setName(trip.name)
      setMaxWalkKm(trip.maxWalkKm)
      setWalkSpeed(trip.walkSpeed)
      setMaxTransfers(trip.maxTransfers)
    }
  }, [open, trip])

  const handleSave = () => {
    onSave({ ...trip, name: name.trim() || trip.name, maxWalkKm, walkSpeed, maxTransfers })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Edit trip</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
            placeholder="Trip name"
            className="h-9"
            autoFocus
          />

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Max walk</p>
              <Select value={maxWalkKm} onValueChange={setMaxWalkKm}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5">0.5 km</SelectItem>
                  <SelectItem value="1">1 km</SelectItem>
                  <SelectItem value="2">2 km</SelectItem>
                  <SelectItem value="5">5 km</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Speed</p>
              <Select value={walkSpeed} onValueChange={setWalkSpeed}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">Slow</SelectItem>
                  <SelectItem value="4.8">Normal</SelectItem>
                  <SelectItem value="5.5">Brisk</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Transfers</p>
              <Select value={maxTransfers} onValueChange={setMaxTransfers}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Direct</SelectItem>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="5">5+</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── ManageTripsSheet ─────────────────────────────────────────────────────────

interface ManageTripsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  savedTrips: SavedTrip[]
  onLoadTrip: (trip: SavedTrip) => void
  onDeleteTrip: (id: string) => void
  onUpdateTrip: (trip: SavedTrip) => void
}

export function ManageTripsSheet({
  open,
  onOpenChange,
  savedTrips,
  onLoadTrip,
  onDeleteTrip,
  onUpdateTrip,
}: ManageTripsSheetProps) {
  const [editingTrip, setEditingTrip] = useState<SavedTrip | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col p-0">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="text-sm font-medium">
              Saved trips
              {savedTrips.length > 0 && (
                <span className="ml-1.5 text-muted-foreground font-normal">
                  ({savedTrips.length})
                </span>
              )}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {savedTrips.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No saved trips.
              </p>
            ) : (
              <ul className="divide-y">
                {savedTrips.map((trip) => (
                  <li key={trip.id} className="group flex items-center gap-2 px-4 py-2.5">
                    <button
                      type="button"
                      className="flex-1 text-left min-w-0"
                      onClick={() => { onLoadTrip(trip); onOpenChange(false) }}
                    >
                      <p className="text-sm font-medium truncate">{trip.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {trip.startLocation.label} → {trip.endLocation.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground/60">
                        {trip.maxWalkKm} km &middot;{" "}
                        {WALK_SPEED_LABELS[trip.walkSpeed] ?? trip.walkSpeed} &middot;{" "}
                        {trip.maxTransfers === "0" ? "Direct" : `≤${trip.maxTransfers} transfers`}
                      </p>
                    </button>

                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() => setEditingTrip(trip)}
                        aria-label="Edit trip"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteId(trip.id)}
                        aria-label="Delete trip"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {editingTrip && (
        <EditTripDialog
          trip={editingTrip}
          open
          onOpenChange={(v) => { if (!v) setEditingTrip(null) }}
          onSave={(updated) => { onUpdateTrip(updated); setEditingTrip(null) }}
        />
      )}

      <Dialog open={!!deleteId} onOpenChange={(v) => { if (!v) setDeleteId(null) }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Delete trip?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { if (deleteId) onDeleteTrip(deleteId); setDeleteId(null) }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── GlobalTripSettingsDialog ─────────────────────────────────────────────────

interface GlobalTripSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tripCount: number
  onApply: (settings: Partial<Pick<SavedTrip, "maxWalkKm" | "walkSpeed" | "maxTransfers">>) => void
}

export function GlobalTripSettingsDialog({
  open,
  onOpenChange,
  tripCount,
  onApply,
}: GlobalTripSettingsDialogProps) {
  const [maxWalkKm, setMaxWalkKm] = useState("1")
  const [walkSpeed, setWalkSpeed] = useState("4.8")
  const [maxTransfers, setMaxTransfers] = useState("5")
  const [checked, setChecked] = useState<Record<OverrideKey, boolean>>({
    maxWalkKm: false,
    walkSpeed: false,
    maxTransfers: false,
  })

  const toggle = (key: OverrideKey) =>
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }))

  const anyChecked = Object.values(checked).some(Boolean)

  const handleApply = () => {
    const settings: Partial<Pick<SavedTrip, "maxWalkKm" | "walkSpeed" | "maxTransfers">> = {}
    if (checked.maxWalkKm) settings.maxWalkKm = maxWalkKm
    if (checked.walkSpeed) settings.walkSpeed = walkSpeed
    if (checked.maxTransfers) settings.maxTransfers = maxTransfers
    onApply(settings)
    onOpenChange(false)
  }

  const rows: { key: OverrideKey; label: string; control: React.ReactNode }[] = [
    {
      key: "maxWalkKm",
      label: "Max walk",
      control: (
        <Select value={maxWalkKm} onValueChange={setMaxWalkKm} disabled={!checked.maxWalkKm}>
          <SelectTrigger className="w-24 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0.5">0.5 km</SelectItem>
            <SelectItem value="1">1 km</SelectItem>
            <SelectItem value="2">2 km</SelectItem>
            <SelectItem value="5">5 km</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    {
      key: "walkSpeed",
      label: "Walk speed",
      control: (
        <Select value={walkSpeed} onValueChange={setWalkSpeed} disabled={!checked.walkSpeed}>
          <SelectTrigger className="w-24 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">Slow</SelectItem>
            <SelectItem value="4.8">Normal</SelectItem>
            <SelectItem value="5.5">Brisk</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    {
      key: "maxTransfers",
      label: "Transfers",
      control: (
        <Select value={maxTransfers} onValueChange={setMaxTransfers} disabled={!checked.maxTransfers}>
          <SelectTrigger className="w-24 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Direct</SelectItem>
            <SelectItem value="1">1</SelectItem>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="3">3</SelectItem>
            <SelectItem value="4">4</SelectItem>
            <SelectItem value="5">5+</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Update all trips</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-1">
          Choose which settings to apply to all {tripCount} saved trip{tripCount !== 1 ? "s" : ""}.
        </p>

        <div className="space-y-2.5">
          {rows.map(({ key, label, control }) => (
            <div key={key} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={key}
                  checked={checked[key]}
                  onCheckedChange={() => toggle(key)}
                />
                <Label
                  htmlFor={key}
                  className={`text-sm cursor-pointer select-none ${!checked[key] ? "text-muted-foreground" : ""}`}
                >
                  {label}
                </Label>
              </div>
              {control}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleApply} disabled={!anyChecked || tripCount === 0}>
            Apply to all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
