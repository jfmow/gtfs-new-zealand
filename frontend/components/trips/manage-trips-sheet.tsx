"use client"

import { useEffect, useRef, useState } from "react"
import { Reorder, useDragControls } from "framer-motion"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { GripVertical, MoreVertical, Pencil, Trash2, Check } from "lucide-react"
import { toast } from "sonner"
import { useIsMobile } from "@/lib/utils"
import { SWATCH_COLORS } from "@/lib/colors"
import type { SavedTrip } from "@/components/journey/use-saved-trips"

interface ManageTripsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  savedTrips: SavedTrip[]
  onLoadTrip: (trip: SavedTrip) => void
  onDeleteTrip: (id: string) => void
  onUpdateTrip: (trip: SavedTrip) => void
  onReorderTrips: (trips: SavedTrip[]) => void
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
  const [color, setColor] = useState(trip.color)
  const [maxWalkKm, setMaxWalkKm] = useState(trip.maxWalkKm)
  const [walkSpeed, setWalkSpeed] = useState(trip.walkSpeed)
  const [maxTransfers, setMaxTransfers] = useState(trip.maxTransfers)

  const handleSave = () => {
    onSave({ ...trip, name: name.trim() || trip.name, color, maxWalkKm, walkSpeed, maxTransfers })
    onOpenChange(false)
    toast.success("Trip updated")
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

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Colour</p>
            <div className="flex flex-wrap gap-1.5">
              {SWATCH_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  aria-label={c.name}
                  onClick={() => setColor(c.value)}
                  className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${color === c.value ? "ring-2 ring-offset-1 ring-offset-background ring-foreground/50" : ""
                    }`}
                  style={{ background: c.value }}
                />
              ))}
            </div>
          </div>

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

function TripRow({
  trip,
  onLoad,
  onEdit,
  onDelete,
  onDragEnd,
}: {
  trip: SavedTrip
  onLoad: () => void
  onEdit: () => void
  onDelete: () => void
  onDragEnd: () => void
}) {
  const controls = useDragControls()

  return (
    <Reorder.Item
      value={trip}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      as="li"
      className="flex items-center gap-2 px-4 py-3 bg-background"
      style={{ borderLeft: `3px solid ${trip.color}` }}
    >
      <button
        onPointerDown={(e) => controls.start(e)}
        aria-label="Drag to reorder"
        className="flex items-center justify-center w-6 h-6 shrink-0 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-colors cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <button type="button" className="flex-1 text-left min-w-0" onClick={onLoad}>
        <p className="text-sm font-medium truncate">{trip.name}</p>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
          {trip.startLocation.label} → {trip.endLocation.label}
        </p>
        <p className="text-[11px] text-muted-foreground/60 mt-0.5">
          {trip.maxWalkKm} km &middot;{" "}
          {trip.walkSpeed === "3" ? "Slow" : trip.walkSpeed === "4.8" ? "Normal" : "Brisk"} &middot;{" "}
          {trip.maxTransfers === "0" ? "Direct" : `≤${trip.maxTransfers} transfers`}
        </p>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Options for ${trip.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors shrink-0"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={onDelete}
            className="text-destructive focus:text-destructive focus:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Reorder.Item>
  )
}

function ManageTripsBody({
  savedTrips,
  onLoadTrip,
  onDeleteTrip,
  onUpdateTrip,
  onReorderTrips,
  onClose,
}: Omit<ManageTripsSheetProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [order, setOrder] = useState<SavedTrip[]>(savedTrips)
  const [editingTrip, setEditingTrip] = useState<SavedTrip | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const orderRef = useRef<SavedTrip[]>(savedTrips)

  useEffect(() => setOrder(savedTrips), [savedTrips])
  useEffect(() => {
    orderRef.current = order
  }, [order])

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        {savedTrips.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No saved trips yet.
          </p>
        ) : (
          <Reorder.Group as="ul" axis="y" values={order} onReorder={setOrder} className="divide-y list-none">
            {order.map((trip) => (
              <TripRow
                key={trip.id}
                trip={trip}
                onLoad={() => {
                  onLoadTrip(trip)
                  onClose()
                }}
                onEdit={() => setEditingTrip(trip)}
                onDelete={() => setDeleteConfirmId(trip.id)}
                onDragEnd={() => onReorderTrips(orderRef.current)}
              />
            ))}
          </Reorder.Group>
        )}
      </div>

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
                if (deleteConfirmId) {
                  onDeleteTrip(deleteConfirmId)
                  toast.success("Trip deleted")
                }
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

export function ManageTripsSheet({
  open,
  onOpenChange,
  savedTrips,
  onLoadTrip,
  onDeleteTrip,
  onUpdateTrip,
  onReorderTrips,
}: ManageTripsSheetProps) {
  const isMobile = useIsMobile()
  const title = (
    <>
      Saved trips
      {savedTrips.length > 0 && (
        <span className="ml-1.5 text-muted-foreground font-normal">({savedTrips.length})</span>
      )}
    </>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh] flex flex-col">
          <DrawerHeader className="px-4 py-3 border-b text-left">
            <DrawerTitle className="text-sm">{title}</DrawerTitle>
          </DrawerHeader>
          <ManageTripsBody
            savedTrips={savedTrips}
            onLoadTrip={onLoadTrip}
            onDeleteTrip={onDeleteTrip}
            onUpdateTrip={onUpdateTrip}
            onReorderTrips={onReorderTrips}
            onClose={() => onOpenChange(false)}
          />
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col p-0">
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle className="text-sm">{title}</SheetTitle>
        </SheetHeader>
        <ManageTripsBody
          savedTrips={savedTrips}
          onLoadTrip={onLoadTrip}
          onDeleteTrip={onDeleteTrip}
          onUpdateTrip={onUpdateTrip}
          onReorderTrips={onReorderTrips}
          onClose={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
