"use client"

import { useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Trash2, Pencil, Check } from "lucide-react"

interface Location {
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

interface ManageTripsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  savedTrips: SavedTrip[]
  onLoadTrip: (trip: SavedTrip) => void
  onDeleteTrip: (id: string) => void
  onUpdateTrip: (trip: SavedTrip) => void
}

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
          <Button size="sm" onClick={handleSave} className="gap-1.5">
            <Check className="h-3.5 w-3.5" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col p-0">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="text-sm">
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
                No saved trips yet.
              </p>
            ) : (
              <ul className="divide-y">
                {savedTrips.map((trip) => (
                  <li key={trip.id} className="group flex items-center gap-2 px-4 py-3">
                    {/* Load on click */}
                    <button
                      type="button"
                      className="flex-1 text-left min-w-0"
                      onClick={() => {
                        onLoadTrip(trip)
                        onOpenChange(false)
                      }}
                    >
                      <p className="text-sm font-medium truncate">{trip.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {trip.startLocation.label} → {trip.endLocation.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                        {trip.maxWalkKm} km &middot;{" "}
                        {trip.walkSpeed === "3" ? "Slow" : trip.walkSpeed === "4.8" ? "Normal" : "Brisk"}{" "}
                        &middot;{" "}
                        {trip.maxTransfers === "0" ? "Direct" : `≤${trip.maxTransfers} transfers`}
                      </p>
                    </button>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
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
                        onClick={() => setDeleteConfirmId(trip.id)}
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
          open={!!editingTrip}
          onOpenChange={(v) => { if (!v) setEditingTrip(null) }}
          onSave={(updated) => {
            onUpdateTrip(updated)
            setEditingTrip(null)
          }}
        />
      )}

      <Dialog
        open={!!deleteConfirmId}
        onOpenChange={(v) => { if (!v) setDeleteConfirmId(null) }}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Delete trip?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This trip will be permanently removed.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (deleteConfirmId) onDeleteTrip(deleteConfirmId)
                setDeleteConfirmId(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
