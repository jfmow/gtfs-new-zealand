import { Circle, PersonStandingIcon } from "lucide-react"

interface OccupancyStatusIndicatorProps {
    value: number
    type: "dots" | "message" | "people"
}

export default function OccupancyStatusIndicator({ value = 0, type = "dots" }: OccupancyStatusIndicatorProps) {
    const textVersion = type === "message"
    const peopleVersion = type === "people"
    switch (value) {
        case 0:
            if (textVersion) return "Empty"
            if (peopleVersion) return (
                <div className="flex items-center" aria-label="Occupancy is empty">
                    <PersonStandingIcon className="w-4 h-4" />
                    <PersonStandingIcon className="w-4 h-4" />
                    <PersonStandingIcon className="w-4 h-4" />
                    <PersonStandingIcon className="w-4 h-4" />
                </div>
            )
            return (
                <div className="flex items-center" aria-label="Occupancy is empty">
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                </div>
            )
        case 1:
            if (textVersion) return "Some people"
            if (peopleVersion) return (
                <div className="flex items-center" aria-label="Occupancy is lots of room">
                    <PersonStandingIcon className="w-4 h-4 text-green-500" />
                    <PersonStandingIcon className="w-4 h-4" />
                    <PersonStandingIcon className="w-4 h-4" />
                    <PersonStandingIcon className="w-4 h-4" />
                </div>
            )
            return (
                <div className="flex items-center" aria-label="Occupancy is lots of room">
                    <Circle fill="green" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                </div>
            )
        case 2:
            if (textVersion) return "Busy"
            if (peopleVersion) return (
                <div className="flex items-center" aria-label="Occupancy is almost full">
                    <PersonStandingIcon className="w-4 h-4 text-orange-500" />
                    <PersonStandingIcon className="w-4 h-4 text-orange-500" />
                    <PersonStandingIcon className="w-4 h-4" />
                    <PersonStandingIcon className="w-4 h-4" />
                </div>
            )
            return (
                <div className="flex items-center" aria-label="Occupancy is almost full">
                    <Circle fill="orange" className="w-2 h-2" />
                    <Circle fill="orange" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                </div>
            )
        case 3:
            if (textVersion) return "Very Busy"
            if (peopleVersion) return (
                <div className="flex items-center" aria-label="Occupancy is basically full">
                    <PersonStandingIcon className="w-4 h-4 text-red-500" />
                    <PersonStandingIcon className="w-4 h-4 text-red-500" />
                    <PersonStandingIcon className="w-4 h-4 text-red-500" />
                    <PersonStandingIcon className="w-4 h-4" />
                </div>
            )
            return (
                <div className="flex items-center" aria-label="Occupancy is basically full">
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                </div>
            )
        case 4:
            if (textVersion) return "Probably not gonna be getting on"
            if (peopleVersion) return (
                <div className="flex items-center" aria-label="Occupancy is full">
                    <PersonStandingIcon className="w-4 h-4 text-red-500" />
                    <PersonStandingIcon className="w-4 h-4 text-red-500" />
                    <PersonStandingIcon className="w-4 h-4 text-red-500" />
                    <PersonStandingIcon className="w-4 h-4 text-red-500" />
                </div>
            )
            return (
                <div className="flex items-center" aria-label="Occupancy is full">
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                </div>
            )
        default:
            return "Unknown"
    }
}