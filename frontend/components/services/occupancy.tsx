import { Armchair, Circle, PersonStandingIcon, Skull, User } from "lucide-react"

interface OccupancyStatusIndicatorProps {
    value: number
    type: "dots" | "message" | "people"
}

/** Longer, sentence-style occupancy description - used where there's room to explain. */
export function getOccupancyLabel(value: number): string {
    switch (value) {
        case 0:
        case 1:
            return "Seats available"
        case 2:
            return "Some seats still available"
        case 3:
            return "Likely standing room only"
        case 4:
            return "Likely full, standing only"
        default:
            return "Unknown occupancy"
    }
}

/** Two-word occupancy label for tight spots (the departures board row, the tracker summary). */
export function getOccupancyShort(value: number): string {
    switch (value) {
        case 0:
        case 1:
            return "Seats free"
        case 2:
            return "Filling up"
        case 3:
            return "Standing room"
        case 4:
            return "Likely full"
        default:
            return ""
    }
}

/**
 * Three-figure occupancy readout - 0-1 low, 2 medium, 3-4 high - filled figures
 * darken as the vehicle fills up. Shared by the journey sheet and the service tracker.
 */
export function OccupancyIcons({ occupancy }: { occupancy: number }) {
    const filled = occupancy <= 1 ? 1 : occupancy === 2 ? 2 : 3
    return (
        <span className="flex items-center gap-0.5" aria-hidden>
            {[0, 1, 2].map((i) => (
                <User key={i} className={`h-3.5 w-3.5 ${i < filled ? "text-foreground" : "text-muted-foreground/30"}`} />
            ))}
        </span>
    )
}

export default function OccupancyStatusIndicator({ value = 0, type = "dots" }: OccupancyStatusIndicatorProps) {
    const textVersion = type === "message"
    const peopleVersion = type === "people"
    switch (value) {
        case 0:
        case 1:
            if (textVersion) return "Some people"
            if (peopleVersion) return (
                <div className="flex items-center" aria-label="Occupancy is lots of room">
                    <Armchair className="w-4 h-4 text-green-500" />
                    <PersonStandingIcon className="w-4 h-4" />
                    <Skull className="w-4 h-4" />
                </div>
            )
            return (
                <div className="flex items-center" aria-label="Occupancy is lots of room">
                    <Circle fill="green" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                </div>
            )
        case 2:
            if (textVersion) return "Busy"
            if (peopleVersion) return (
                <div className="flex items-center" aria-label="Occupancy is almost full">
                    <Armchair className="w-4 h-4 text-orange-500" />
                    <PersonStandingIcon className="w-4 h-4" />
                    <Skull className="w-4 h-4" />
                </div>
            )
            return (
                <div className="flex items-center" aria-label="Occupancy is almost full">
                    <Circle fill="orange" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                </div>
            )
        case 3:
            if (textVersion) return "Very Busy"
            if (peopleVersion) return (
                <div className="flex items-center" aria-label="Occupancy is basically full">
                    <Armchair className="w-4 h-4 text-red-500" />
                    <PersonStandingIcon className="w-4 h-4 text-red-500" />
                    <Skull className="w-4 h-4" />
                </div>
            )
            return (
                <div className="flex items-center" aria-label="Occupancy is basically full">
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                </div>
            )
        case 4:
            if (textVersion) return "Probably not gonna be getting on"
            if (peopleVersion) return (
                <div className="flex items-center" aria-label="Occupancy is full">
                    <Armchair className="w-4 h-4 text-red-500" />
                    <PersonStandingIcon className="w-4 h-4 text-red-500" />
                    <Skull className="w-4 h-4 text-red-500" />
                </div>
            )
            return (
                <div className="flex items-center" aria-label="Occupancy is full">
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                </div>
            )
        default:
            return "Unknown"
    }
}
