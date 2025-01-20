import { Loader2 } from "lucide-react"

interface LoadingSpinnerProps {
    description?: string
    height?: string
}

export default function LoadingSpinner({ description, height }: LoadingSpinnerProps) {
    return (
        <div style={height && height !== "" ? { height: height } : {}} className="flex items-center justify-center h-[calc(100vh-4rem)] bg-background">
            <div className="flex flex-col items-center space-y-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-lg font-medium text-muted-foreground">{description && description !== "" ? description : "Loading..."}</p>
            </div>
        </div>
    )
}