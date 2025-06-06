"use client"

import Head from "next/head"
import { useEffect, useState } from "react"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import SearchForStop from "@/components/stops/search"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { BellDot, MegaphoneOff, Clock, MapPin, AlertTriangle } from "lucide-react"
import LoadingSpinner from "@/components/loading-spinner"
import { Button } from "@/components/ui/button"
import StopNotifications from "@/components/services/notifications"
import type { TrainsApiResponse } from "@/components/services/types"
import { ApiFetch } from "@/lib/url-context"
import { useQueryParams } from "@/lib/url-params"
import { HeaderMeta } from "@/components/nav"
import { fullyEncodeURIComponent } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { formatTextToNiceLookingWords } from "@/lib/formating"

export default function Alerts() {
    const [alerts, setAlerts] = useState<AlertType[]>([])
    const { selected_stop } = useQueryParams({ selected_stop: { type: "string", default: "", keys: ["s", "r"] } })
    const [loading, setLoading] = useState(false)
    const [expandedDescriptions, setExpandedDescriptions] = useState<Set<number>>(new Set())

    useEffect(() => {
        if (selected_stop.found) {
            setLoading(true)
            ApiFetch(`realtime/alerts/${fullyEncodeURIComponent(selected_stop.value)}`).then(async (res) => {
                if (res.ok) {
                    const data: TrainsApiResponse<AlertType[]> = await res.json()
                    setAlerts(data.data)
                } else {
                    setAlerts([])
                }
                setLoading(false)
            })
        }
    }, [selected_stop])

    const formatDate = (timestamp: number) => {
        return new Date(timestamp * 1000).toLocaleDateString("en-NZ", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
    }

    const isCurrentlyActive = (alert: AlertType) => {
        const now = Date.now() / 1000
        return alert.start_date <= now && alert.end_date >= now
    }

    const toggleDescription = (index: number) => {
        const newExpanded = new Set(expandedDescriptions)
        if (newExpanded.has(index)) {
            newExpanded.delete(index)
        } else {
            newExpanded.add(index)
        }
        setExpandedDescriptions(newExpanded)
    }

    const truncateText = (text: string, maxLength = 150) => {
        if (text.length <= maxLength) return text
        return text.slice(0, maxLength) + "..."
    }

    const getDescriptionPreview = (description: string) => {
        const lines = description.split("\n").filter((line) => line.trim() !== "")
        const fullText = lines.join(" ").trim()
        return truncateText(fullText)
    }

    const formatDescription = (description: string) => {
        const lines = description.split("\n").filter((line) => line.trim() !== "")

        return lines.map((line, index) => {
            const bulletMatch = line.match(/^\s*(•|-)\s?(.*)/)
            if (bulletMatch) {
                return (
                    <li key={index} className="ml-4 mb-2">
                        {bulletMatch[2]}
                    </li>
                )
            }
            return (
                <p key={index} className="mb-2">
                    {line.trim()}
                </p>
            )
        })
    }

    return (
        <>
            <Header />
            <div className="w-full">
                <div className="mx-auto max-w-[1400px] flex flex-col p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <StopNotifications stopName={selected_stop.value}>
                            <Button>
                                <BellDot />
                                <span className="hidden sm:block">Notifications</span>
                            </Button>
                        </StopNotifications>
                        <SearchForStop />
                    </div>

                    {loading ? (
                        <LoadingSpinner description="Loading alerts..." />
                    ) : (
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {alerts.length > 0 ? (
                                alerts.map((alert, index) => (
                                    <Card key={index} className="relative flex flex-col">
                                        <CardHeader className="pb-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <CardTitle className="text-lg leading-tight">{alert.title}</CardTitle>
                                                <Badge variant={isCurrentlyActive(alert) ? "destructive" : "secondary"} className="shrink-0">
                                                    {isCurrentlyActive(alert) ? "Active" : "Inactive"}
                                                </Badge>
                                            </div>
                                        </CardHeader>

                                        <CardContent className="space-y-4 flex-grow">
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2 text-sm">
                                                    <Clock className="h-4 w-4 text-muted-foreground" />
                                                    <span className="font-medium">Duration</span>
                                                </div>
                                                <div className="pl-6 space-y-1 text-sm text-muted-foreground">
                                                    <div>From: {formatDate(alert.start_date)}</div>
                                                    <div>Until: {formatDate(alert.end_date)}</div>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <Collapsible
                                                    open={expandedDescriptions.has(index)}
                                                    onOpenChange={() => toggleDescription(index)}
                                                >
                                                    <div className="text-sm leading-relaxed">
                                                        {expandedDescriptions.has(index) ? (
                                                            formatDescription(alert.description)
                                                        ) : (
                                                            <p className="mb-2">{getDescriptionPreview(alert.description)}</p>
                                                        )}
                                                    </div>
                                                    {alert.description.length > 150 && (
                                                        <CollapsibleTrigger className="text-sm font-medium text-primary hover:underline mt-2">
                                                            {expandedDescriptions.has(index) ? "Show less" : "Read more"}
                                                        </CollapsibleTrigger>
                                                    )}
                                                </Collapsible>
                                            </div>

                                            {alert.affected.length > 0 && (
                                                <Collapsible>
                                                    <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                                                        <MapPin className="h-4 w-4" />
                                                        Affected locations ({alert.affected.length})
                                                    </CollapsibleTrigger>
                                                    <CollapsibleContent className="mt-2">
                                                        <ul className="pl-6 space-y-1 text-sm text-muted-foreground">
                                                            {alert.affected.map((item, idx) => (
                                                                <li key={idx} className="list-disc">
                                                                    {item}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </CollapsibleContent>
                                                </Collapsible>
                                            )}
                                        </CardContent>

                                        <CardFooter className="pt-0">
                                            <div className="flex items-center gap-2 justify-between w-full">
                                                <Badge variant={"secondary"} className="flex items-center gap-1">
                                                    <AlertTriangle className="h-4 w-4" />
                                                    {formatTextToNiceLookingWords(alert.cause.replace("_", " ").toLowerCase(), true)}
                                                </Badge>
                                                <Badge variant="outline">
                                                    {formatTextToNiceLookingWords(alert.effect.replace("_", " ").toLowerCase(), true)}
                                                </Badge>
                                            </div>
                                        </CardFooter>
                                    </Card>
                                ))
                            ) : selected_stop.found ? (
                                <div className="col-span-full">
                                    <Alert>
                                        <MegaphoneOff className="h-4 w-4" />
                                        <AlertTitle>No alerts found</AlertTitle>
                                        <AlertDescription>This stop has no active alerts at the moment.</AlertDescription>
                                    </Alert>
                                </div>
                            ) : (
                                <div className="col-span-full">
                                    <div className="text-center py-8">
                                        <p className="text-muted-foreground">Search for a stop to view alerts.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

function Header() {
    return (
        <Head>
            <title>Alerts</title>
            <HeaderMeta />
            <meta name="description" content="Track public transport vehicles live!" />
            <meta
                name="keywords"
                content="at, auckland, auckland transport, transport, trains, bus, travel, car, fly, tracks, train tracks, track train, ferry, at mobile"
            />
            <link rel="canonical" href="https://trains.suddsy.dev/" />
            <meta property="og:title" content="Live travel alerts!" />
            <meta property="og:url" content="https://trains.suddsy.dev/" />
            <meta
                property="og:description"
                content="Auckland transports trains, buses and ferry's all in one easy to navigate place. Track, predict and prepare your journey."
            />
            <meta property="og:image" content="https://trains.suddsy.dev/rounded-icon.png" />
        </Head>
    )
}

export interface AlertType {
    start_date: number
    end_date: number
    cause: string
    effect: string
    title: string
    description: string
    affected: string[]
}
