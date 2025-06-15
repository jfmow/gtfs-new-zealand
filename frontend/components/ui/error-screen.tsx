import { formatTextToNiceLookingWords } from "@/lib/formating"
import { AlertCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

export default function ErrorScreen({ errorText, errorTitle }: { errorText: string; errorTitle: string }) {
    return (
        <div className="flex-grow w-full flex items-center justify-center p-4">
            <Card className="w-full max-w-md mx-auto shadow-lg border-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                <CardContent className="flex flex-col items-center justify-center text-center p-8 space-y-6">
                    <div className="flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 border border-destructive/20">
                        <AlertCircle className="w-8 h-8 text-destructive" />
                    </div>

                    <div className="space-y-3">
                        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{errorTitle}</h1>
                        <div className="space-y-2">
                            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Error Details</p>
                            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm p-2 border rounded-lg bg-muted italic">
                                {formatTextToNiceLookingWords(errorText, true)}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
