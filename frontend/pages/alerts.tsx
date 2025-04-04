import Head from "next/head"
import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { formatTextToNiceLookingWords } from "@/lib/formating"
import SearchForStop from "@/components/stops/search"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { BellDot, MegaphoneOff } from "lucide-react"
import LoadingSpinner from "@/components/loading-spinner"
import { Button } from "@/components/ui/button"
import StopNotifications from "@/components/services/notifications"
import { TrainsApiResponse } from "@/components/services/types"
import { ApiFetch } from "@/lib/url-context"
import { useQueryParams } from "@/lib/url-params"

export default function Alerts() {
    const [alerts, setAlerts] = useState<Alert[]>([])
    const { selected_stop } = useQueryParams({ selected_stop: { type: "string", default: "", keys: ["s"] } })
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (selected_stop.found) {
            setLoading(true)
            ApiFetch(`stops/alerts/${selected_stop.value}`)
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
                        <SearchForStop defaultValue={selected_stop.value} url="/alerts?r=" />
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
                                                            {alert.header_text.translation[0].text}
                                                        </CardTitle>
                                                        <CardDescription>
                                                            <p>
                                                                Currently active:
                                                                {alert.active_period.some(period => {
                                                                    const now = Date.now() / 1000;
                                                                    return period.start <= now && period.end >= now;
                                                                }) ? <span className="text-red-500"> Yes</span> : <span className="text-green-500"> No</span>}
                                                            </p>
                                                            <p>{alert.active_period.map((period, idx) => (
                                                                <div key={idx}>
                                                                    Start: {new Date(period.start * 1000).toLocaleString()} | End: {new Date(period.end * 1000).toLocaleString()}
                                                                </div>
                                                            ))}</p>
                                                            <p>
                                                                Affects:
                                                                <ul className="list-disc list-inside">
                                                                    {alert.informed_entity.map((item) => (
                                                                        <>
                                                                            {item.stop_id !== "" ? <li>Stop: {item.stop_id}</li> : <li>Route: {item.route_id}</li>}
                                                                        </>
                                                                    ))}
                                                                </ul>
                                                            </p>
                                                        </CardDescription>
                                                    </CardHeader>
                                                    <CardContent>
                                                        <p>
                                                            {alert.description_text.translation[0].text}
                                                        </p>
                                                    </CardContent>
                                                    <CardFooter>
                                                        <p className="text-sm text-muted-foreground">
                                                            Cause: {formatTextToNiceLookingWords(alert.cause, true)} | Effect: {formatTextToNiceLookingWords(alert.effect, true).replace("_", " ")}
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

            <link rel="manifest" href="manifest.json" />
            <meta name="mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-capable" content="yes" />
            <meta name="application-name" content="Trains" />
            <meta name="apple-mobile-web-app-title" content="Trains" />
            <meta name="theme-color" content="#ffffff" />
            <meta name="msapplication-navbutton-color" content="#ffffff" />
            <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
            <meta name="msapplication-starturl" content="/" />
            <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
            <link rel='icon' type='image/png' href={`/Favicon.png`} />
            <link rel="apple-touch-icon" href={`/Favicon.png`} />
            <link rel="shortcut icon" href={`/Favicon.png`} />

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
    active_period: ActivePeriod[];
    informed_entity: InformedEntity[];
    cause: string;
    effect: string;
    header_text: Text;
    description_text: Text;
}

export interface ActivePeriod {
    start: number;
    end: number;
}

export interface Text {
    translation: Translation[];
}

export interface Translation {
    text: string;
    language: string;
}

export interface InformedEntity {
    stop_id: string;
    route_id: string;
}
