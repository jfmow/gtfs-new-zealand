"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { RouteMultiSelect, type RouteOption } from "@/components/journey/route-filter"

interface GlobalTripSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tripCount: number
  onApply: (settings: {
    maxWalkKm?: string
    walkSpeed?: string
    maxTransfers?: string
    onlyRoutes?: RouteOption[]
    requiredRoutes?: RouteOption[]
  }) => void
}

type OverrideKey = "maxWalkKm" | "walkSpeed" | "maxTransfers" | "onlyRoutes" | "requiredRoutes"

export function GlobalTripSettingsDialog({
  open,
  onOpenChange,
  tripCount,
  onApply,
}: GlobalTripSettingsDialogProps) {
  const [maxWalkKm, setMaxWalkKm] = useState("1")
  const [walkSpeed, setWalkSpeed] = useState("4.8")
  const [maxTransfers, setMaxTransfers] = useState("5")
  const [onlyRoutes, setOnlyRoutes] = useState<RouteOption[]>([])
  const [requiredRoutes, setRequiredRoutes] = useState<RouteOption[]>([])

  const [checked, setChecked] = useState<Record<OverrideKey, boolean>>({
    maxWalkKm: false,
    walkSpeed: false,
    maxTransfers: false,
    onlyRoutes: false,
    requiredRoutes: false,
  })

  const toggle = (key: OverrideKey) =>
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }))

  const anyChecked = Object.values(checked).some(Boolean)

  const handleApply = () => {
    const settings: {
      maxWalkKm?: string
      walkSpeed?: string
      maxTransfers?: string
      onlyRoutes?: RouteOption[]
      requiredRoutes?: RouteOption[]
    } = {}
    if (checked.maxWalkKm) settings.maxWalkKm = maxWalkKm
    if (checked.walkSpeed) settings.walkSpeed = walkSpeed
    if (checked.maxTransfers) settings.maxTransfers = maxTransfers
    if (checked.onlyRoutes) settings.onlyRoutes = onlyRoutes
    if (checked.requiredRoutes) settings.requiredRoutes = requiredRoutes
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
          Select settings to apply to all {tripCount} saved trip{tripCount !== 1 ? "s" : ""}.
        </p>

        <div className="space-y-2">
          {rows.map(({ key, label, control }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={key}
                  checked={checked[key]}
                  onCheckedChange={() => toggle(key)}
                />
                <Label
                  htmlFor={key}
                  className={`text-sm cursor-pointer ${!checked[key] ? "text-muted-foreground" : ""}`}
                >
                  {label}
                </Label>
              </div>
              {control}
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Checkbox
              id="onlyRoutes"
              checked={checked.onlyRoutes}
              onCheckedChange={() => toggle("onlyRoutes")}
            />
            <Label
              htmlFor="onlyRoutes"
              className={`text-sm cursor-pointer ${!checked.onlyRoutes ? "text-muted-foreground" : ""}`}
            >
              Only use these routes
            </Label>
          </div>
          {checked.onlyRoutes && (
            <RouteMultiSelect
              label=""
              placeholder="Search routes…"
              selected={onlyRoutes}
              onChange={setOnlyRoutes}
            />
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="requiredRoutes"
              checked={checked.requiredRoutes}
              onCheckedChange={() => toggle("requiredRoutes")}
            />
            <Label
              htmlFor="requiredRoutes"
              className={`text-sm cursor-pointer ${!checked.requiredRoutes ? "text-muted-foreground" : ""}`}
            >
              Must include these routes
            </Label>
          </div>
          {checked.requiredRoutes && (
            <RouteMultiSelect
              label=""
              placeholder="Search routes…"
              selected={requiredRoutes}
              onChange={setRequiredRoutes}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={!anyChecked || tripCount === 0}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
