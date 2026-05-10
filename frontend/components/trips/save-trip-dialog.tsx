"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface Location {
  lat: number
  lon: number
  label: string
}

interface SaveTripDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  startLocation: Location | null
  endLocation: Location | null
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save trip</DialogTitle>
        </DialogHeader>

        {startLocation && endLocation && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <span className="truncate">{startLocation.label}</span>
            <span className="shrink-0">→</span>
            <span className="truncate">{endLocation.label}</span>
          </div>
        )}

        <div className="min-w-0">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave()
            }}
            placeholder="Trip name"
            autoFocus
            className="h-9 w-full truncate"
          />
        </div>

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
