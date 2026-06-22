import { useState } from "react"
import { AlertCircle, Check, Copy, CalendarOff } from "lucide-react"

export default function ErrorScreen({
    errorText,
    errorTitle,
    traceId,
}: {
    errorText: string
    errorTitle: string
    traceId?: string
}) {
    const [copied, setCopied] = useState(false)

    const handleCopyTraceId = () => {
        if (traceId) {
            navigator.clipboard.writeText(traceId)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    return (
        <div className="flex-grow w-full flex flex-col items-center justify-center p-6 min-h-[200px]">
            <div className="w-full max-w-xs text-center space-y-4">
                <div className="flex justify-center">
                    <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                        <AlertCircle className="w-6 h-6 text-destructive" />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <h2 className="text-base font-semibold text-foreground">{errorTitle}</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">{errorText}</p>
                </div>

                {traceId && (
                    <div className="text-left space-y-1.5 pt-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Trace ID</p>
                        <div className="flex items-center gap-2 bg-muted rounded-lg p-2.5">
                            <code className="font-mono text-[11px] text-muted-foreground break-all flex-1 leading-relaxed">
                                {traceId}
                            </code>
                            <button
                                onClick={handleCopyTraceId}
                                className="shrink-0 p-1.5 rounded-md hover:bg-background transition-colors"
                                aria-label="Copy trace ID"
                            >
                                {copied ? (
                                    <Check className="h-3.5 w-3.5 text-green-600" />
                                ) : (
                                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export function InfoScreen({ infoText, infoTitle }: { infoText: string; infoTitle: string }) {
    return (
        <div className="flex-grow w-full flex flex-col items-center justify-center p-6 min-h-[200px]">
            <div className="w-full max-w-xs text-center space-y-4">
                <div className="flex justify-center">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <CalendarOff className="w-6 h-6 text-muted-foreground" />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <h2 className="text-base font-semibold text-foreground">{infoTitle}</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">{infoText}</p>
                </div>
            </div>
        </div>
    )
}
