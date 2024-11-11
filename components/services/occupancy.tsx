import { Circle } from "lucide-react"

interface OccupancyStatusIndicatorProps {
    value: number
    type: "dots" | "message"
}

export default function OccupancyStatusIndicator({ value = 0, type = "dots" }: OccupancyStatusIndicatorProps) {
    const textVersion = type === "message"
    switch (value) {
        case 0:
            if (textVersion) return "Empty"
            return (
                <div className="flex items-center">
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                </div>
            )
        case 1:
            if (textVersion) return "Some people"
            return (
                <div className="flex items-center">
                    <Circle fill="green" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                </div>
            )
        case 2:
            if (textVersion) return "Busy"
            return (
                <div className="flex items-center">
                    <Circle fill="orange" className="w-2 h-2" />
                    <Circle fill="orange" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                </div>
            )
        case 3:
            if (textVersion) return "Very Busy"
            return (
                <div className="flex items-center">
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="" className="w-2 h-2" />
                </div>
            )
        case 4:
            if (textVersion) return "Probably not gonna be getting on"
            return (
                <div className="flex items-center">
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                    <Circle fill="red" className="w-2 h-2" />
                </div>
            )
    }
}