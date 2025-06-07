import { HeaderMeta } from "@/components/nav";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUrl } from "@/lib/url-context";
import Head from "next/head";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes";
import { Label } from "@/components/ui/label";

export default function Settings() {
    const { urlOptions, setCurrentUrl, currentUrl } = useUrl()
    const { setTheme, theme } = useTheme()
    return (
        <>
            <Head>
                <title>Settings</title>

                <HeaderMeta />

                <meta name="description" content="Auckland transports trains, buses and ferry's all in one easy to navigate place. Track, predict and prepare your journey." />
                <meta name="keywords" content="at, auckland, auckland transport, transport, trains, bus, travel, car, fly, tracks, train tracks, track train, ferry, at mobile"></meta>
                <link rel="canonical" href="https://trains.suddsy.dev/"></link>
                <meta property="og:title" content="Settings" />
                <meta property="og:url" content="https://trains.suddsy.dev/" />
                <meta property="og:description" content="Auckland transports trains, buses and ferry's all in one easy to navigate place. Track, predict and prepare your journey." />
                <meta property="og:image" content="https://trains.suddsy.dev/rounded-icon.png" />
            </Head>
            <div className="flex-grow flex">
                <div className="mx-auto max-w-[1400px] flex flex-col p-4 w-full">
                    <div className="flex-grow flex items-center justify-center">
                        <Card className="w-full max-w-[400px]">
                            <CardHeader>
                                <CardTitle>Settings</CardTitle>
                                <CardDescription>Select a different region, theme and more...</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-4">
                                <Label>Region</Label>
                                <Select value={currentUrl.url} onValueChange={(val) => {
                                    const item = urlOptions.find((item) => item.url === val)
                                    if (item) {
                                        setCurrentUrl(item)
                                        window.location.reload()
                                    }
                                }}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Provider" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {urlOptions.map((item) => (
                                            <SelectItem key={item.url} value={item.url}>
                                                <div className="flex items-center gap-2">
                                                    <img className="w-4 h-4 object-contain" src={item.logoUrl} />
                                                    <span style={{ color: item.textColor }}>{item.displayName}</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Label>App Theme</Label>
                                <Select value={theme} defaultValue="system" onValueChange={(val) => setTheme(val)}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Theme" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={"light"}>
                                            <div className="flex items-center gap-2">
                                                <Sun className="w-4 h-4" />
                                                Light
                                            </div>
                                        </SelectItem>
                                        <SelectItem value={"dark"}>
                                            <div className="flex items-center gap-2">
                                                <Moon className="w-4 h-4" />
                                                Dark
                                            </div>
                                        </SelectItem>
                                        <SelectItem value={"system"}>
                                            <div className="flex items-center gap-2">
                                                <Monitor className="w-4 h-4" />
                                                System
                                            </div>
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </>
    )
}