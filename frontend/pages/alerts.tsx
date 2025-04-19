import Head from "next/head"
import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import SearchForStop from "@/components/stops/search"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { BellDot, MegaphoneOff } from "lucide-react"
import LoadingSpinner from "@/components/loading-spinner"
import { Button } from "@/components/ui/button"
import StopNotifications from "@/components/services/notifications"
import { TrainsApiResponse } from "@/components/services/types"
import { ApiFetch } from "@/lib/url-context"
import { useQueryParams } from "@/lib/url-params"
import { HeaderMeta } from "@/components/nav"

export default function Alerts() {
    const [alerts, setAlerts] = useState<Alert[]>([])
    const { selected_stop } = useQueryParams({ selected_stop: { type: "string", default: "", keys: ["s", "r"] } })
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (selected_stop.found) {
            setLoading(true)
            ApiFetch(`realtime/alerts/${selected_stop.value.replace("/", "%2F")}`)
                .then(async res => {
                    if (res.ok) {
                        const data: TrainsApiResponse<Alert[]> = await res.json()
                        setAlerts(data.data)
                    }
                    setLoading(false)
                })

        }
    }, [selected_stop])

    return (
        <>
            <Header />
            <div className="w-full">
                <div className="mx-auto max-w-[1400px] flex flex-col p-4">
                    <div className="flex items-center gap-2 p-4">
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
                        <>
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                                {alerts.length > 0 ? (
                                    <>
                                        {alerts.map((alert) => (
                                            <>
                                                <Card>
                                                    <CardHeader>
                                                        <CardTitle>
                                                            {alert.title}
                                                        </CardTitle>
                                                        <CardDescription>
                                                            <p className="font-medium">
                                                                Currently active:
                                                                {alert.start_date <= Date.now() / 1000 && alert.end_date >= Date.now() / 1000 ? <span className="text-red-500"> Yes</span> : <span className="text-green-500"> No</span>}
                                                            </p>
                                                            <p>
                                                                Start: {new Date(alert.start_date * 1000).toLocaleString()} {'->'} End: {new Date(alert.end_date * 1000).toLocaleString()}
                                                            </p>
                                                            <p>
                                                                <details>
                                                                    <summary className="text-bold text-blue-500 cursor-pointer">
                                                                        Affected stops/routes (click)
                                                                    </summary>
                                                                    <ul className="list-disc list-inside">
                                                                        {alert.affected.map((item) => (
                                                                            <>
                                                                                <li>{item}</li>
                                                                            </>
                                                                        ))}
                                                                    </ul>
                                                                </details>
                                                            </p>
                                                        </CardDescription>
                                                    </CardHeader>
                                                    <CardContent>
                                                        <p>
                                                            {alert.description.split('\n').map((line, index) => (
                                                                <span key={index}>
                                                                    {line}
                                                                    <br />
                                                                </span>
                                                            ))}
                                                        </p>
                                                    </CardContent>
                                                    <CardFooter>
                                                        <p className="text-sm text-muted-foreground">
                                                            Cause: {alert.cause} | Effect: {alert.effect}
                                                        </p>
                                                    </CardFooter>
                                                </Card>
                                            </>
                                        ))}
                                    </>
                                ) : selected_stop.found ? (
                                    <>
                                        <Alert>
                                            <MegaphoneOff className="h-4 w-4" />
                                            <AlertTitle>No alerts found</AlertTitle>
                                            <AlertDescription>
                                                This stop has no alerts at the moment.
                                                <br />
                                                <br />
                                                Use the bell above to enable notifications for any future alerts/cancellations at this stop
                                            </AlertDescription>
                                        </Alert>

                                    </>
                                ) : (
                                    <div className="grid gap-1">
                                        <p className="text-sm text-muted-foreground">Search for a stop to view alerts.</p>
                                    </div>
                                )}
                            </div>
                        </>
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
            <meta name="keywords" content="at, auckland, auckland transport, transport, trains, bus, travel, car, fly, tracks, train tracks, track train, ferry, at mobile"></meta>
            <link rel="canonical" href="https://trains.suddsy.dev/"></link>
            <meta property="og:title" content="Live vehicle locations!" />
            <meta property="og:url" content="https://trains.suddsy.dev/" />
            <meta property="og:description" content="Auckland transports trains, buses and ferry's all in one easy to navigate place. Track, predict and prepare your journey." />
            <meta property="og:image" content="https://trains.suddsy.dev/rounded-icon.png" />
        </Head>
    )
}

export interface Alert {
    start_date: number;
    end_date: number;
    cause: string;
    effect: string;
    title: string;
    description: string;
    affected: string[];
}

