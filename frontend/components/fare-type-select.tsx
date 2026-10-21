import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useFareType, useFareTypeOptions, type FareType } from "@/lib/fare-type"

/** Picks the fare type used for fare estimates, from what the region offers - Settings and the first-visit card. */
export function FareTypeSelect({ className }: { className?: string }) {
    const [fareType, setFareType] = useFareType()
    const options = useFareTypeOptions()
    // A choice the region doesn't offer (or not loaded yet) shows as its adult fare, which is what's priced.
    const value = options.some((o) => o.value === fareType) ? fareType : "adult"
    return (
        <Select value={value} onValueChange={(v) => setFareType(v as FareType)} disabled={options.length < 2}>
            <SelectTrigger className={cn("w-[200px] shrink-0", className)} aria-label="Fare type">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map((o) => (
                    <SelectItem key={o.value} value={o.value} title={o.detail}>{o.label}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
