import { useState } from "react"
import { formatTextToNiceLookingWords } from "@/lib/formating"
import { AlertCircle, Info, Code, ChevronDown, ChevronUp, Hash } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible"

export default function ErrorScreen({
    errorText,
    errorTitle,
    traceId,
}: {
    errorText: string
    errorTitle: string
    traceId?: string
}) {
    const [detailsExpanded, setDetailsExpanded] = useState(false)

    const getErrorSeverity = (errorText: string) => {
        const lowerError = errorText.toLowerCase()
        if (lowerError.includes("fatal") || lowerError.includes("critical")) {
            return { level: "critical", label: "Critical" }
        }
        if (lowerError.includes("warning") || lowerError.includes("warn")) {
            return { level: "warning", label: "Warning" }
        }
        return { level: "error", label: "Error" }
    }

    const getBadgeVariant = (level: string) => {
        switch (level) {
            case "critical":
                return "destructive"
            case "warning":
                return "default"
            default:
                return "destructive"
        }
    }

    const truncateText = (text: string, maxLength = 120) => {
        if (text.length <= maxLength) return text
        return text.slice(0, maxLength) + "..."
    }

    const severity = getErrorSeverity(errorText)
    const formattedError = formatTextToNiceLookingWords(errorText, true)

    return (
        <div className="flex-grow w-full flex items-center justify-center p-4">
            <Card className="w-full max-w-lg mx-auto">
                <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-lg leading-tight flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-destructive" />
                            {errorTitle}
                        </CardTitle>
                        <Badge variant={getBadgeVariant(severity.level)} className="shrink-0">
                            {severity.label}
                        </Badge>
                    </div>
                </CardHeader>

                <CardContent className="space-y-4 flex-grow">

                    {traceId && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm">
                                <Hash className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">Trace ID</span>
                            </div>
                            <div className="pl-6">
                                <code className="text-xs bg-muted px-2 py-1 rounded font-mono text-foreground select-all">
                                    {traceId}
                                </code>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Collapsible open={detailsExpanded} onOpenChange={setDetailsExpanded}>
                            <div className="text-sm leading-relaxed">
                                {detailsExpanded ? (
                                    <div className="rounded-md border bg-muted/30 p-4">
                                        <p className="font-mono text-sm text-foreground whitespace-pre-wrap">{formattedError}</p>
                                    </div>
                                ) : (
                                    <p className="mb-2 text-muted-foreground">{truncateText(formattedError)}</p>
                                )}
                            </div>
                            {formattedError.length > 120 && (
                                <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium text-primary hover:underline mt-2">
                                    {detailsExpanded ? (
                                        <>
                                            <ChevronUp className="h-4 w-4" />
                                            Show less
                                        </>
                                    ) : (
                                        <>
                                            <ChevronDown className="h-4 w-4" />
                                            Show details
                                        </>
                                    )}
                                </CollapsibleTrigger>
                            )}
                        </Collapsible>
                    </div>
                </CardContent>

                <CardFooter className="pt-0">
                    <div className="flex flex-wrap items-center gap-2 justify-between w-full">
                        <Badge variant="secondary" className="flex items-center gap-1">
                            <Code className="h-4 w-4" />
                            System Error
                        </Badge>
                        <Badge variant="outline">Needs Attention</Badge>
                    </div>
                </CardFooter>
            </Card>
        </div>
    )
}

export function InfoScreen({ infoText, infoTitle }: { infoText: string; infoTitle: string }) {
    const [detailsExpanded, setDetailsExpanded] = useState(false)

    const getInfoType = (infoText: string) => {
        const lowerInfo = infoText.toLowerCase()
        if (lowerInfo.includes("update") || lowerInfo.includes("new")) {
            return { type: "update", label: "Update" }
        }
        if (lowerInfo.includes("maintenance") || lowerInfo.includes("scheduled")) {
            return { type: "maintenance", label: "Maintenance" }
        }
        return { type: "info", label: "Information" }
    }

    const getBadgeVariant = (type: string) => {
        switch (type) {
            case "update":
                return "default"
            case "maintenance":
                return "secondary"
            default:
                return "secondary"
        }
    }

    const truncateText = (text: string, maxLength = 120) => {
        if (text.length <= maxLength) return text
        return text.slice(0, maxLength) + "..."
    }

    const infoType = getInfoType(infoText)
    const formattedInfo = formatTextToNiceLookingWords(infoText, true)

    return (
        <div className="flex-grow w-full flex items-center justify-center p-4">
            <Card className="w-full max-w-lg mx-auto">
                <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-lg leading-tight flex items-center gap-2">
                            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            {infoTitle}
                        </CardTitle>
                        <Badge
                            variant={getBadgeVariant(infoType.type)}
                            className="shrink-0 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        >
                            {infoType.label}
                        </Badge>
                    </div>
                </CardHeader>

                <CardContent className="space-y-4 flex-grow">

                    <div className="space-y-2">
                        <Collapsible open={detailsExpanded} onOpenChange={setDetailsExpanded}>
                            <div className="text-sm leading-relaxed">
                                {detailsExpanded ? (
                                    <div className="rounded-md border bg-blue-50/30 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/50 p-4">
                                        <p className="text-foreground whitespace-pre-wrap">{formattedInfo}</p>
                                    </div>
                                ) : (
                                    <p className="mb-2 text-muted-foreground">{truncateText(formattedInfo)}</p>
                                )}
                            </div>
                            {formattedInfo.length > 120 && (
                                <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium text-primary hover:underline mt-2">
                                    {detailsExpanded ? (
                                        <>
                                            <ChevronUp className="h-4 w-4" />
                                            Show less
                                        </>
                                    ) : (
                                        <>
                                            <ChevronDown className="h-4 w-4" />
                                            Read more
                                        </>
                                    )}
                                </CollapsibleTrigger>
                            )}
                        </Collapsible>
                    </div>
                </CardContent>

                <CardFooter className="pt-0">
                    <div className="flex flex-wrap items-center gap-2 justify-between w-full">
                        <Badge variant="secondary" className="flex items-center gap-1">
                            <Info className="h-4 w-4" />
                            System Notice
                        </Badge>
                        <Badge variant="outline">Informational</Badge>
                    </div>
                </CardFooter>
            </Card>
        </div>
    )
}
