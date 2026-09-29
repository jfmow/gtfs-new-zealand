import { Header } from "@/components/nav";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUrl } from "@/lib/url-context";
import { Bell, BellRing, ChevronRight, Map as MapIcon, Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { getMapThemeOverride, setMapThemeOverride, type MapThemeOverride } from "@/components/map/map-theme";
import { ManageNotificationsSheet } from "@/components/notifications/manage-sheet";
import { Button } from "@/components/ui/button";
import { usePlannerStyle, type PlannerStyle } from "@/lib/planner-style";
import { ensureSubscription } from "@/lib/notifications";
import { toast } from "sonner";
import Link from "next/link";

export default function Settings() {
    const { urlOptions, setCurrentUrl, currentUrl } = useUrl()
    const { setTheme, theme } = useTheme()
    const [mapTheme, setMapTheme] = useState<MapThemeOverride>("auto")
    const [remindersOpen, setRemindersOpen] = useState(false)
    const [plannerStyle, setPlannerStyle] = usePlannerStyle()
    useEffect(() => setMapTheme(getMapThemeOverride()), [])

    return (
        <>
            <Header title="Settings" />
            <div className="mx-auto w-full max-w-[1400px] px-4 pb-8">
                <div className="mb-6">
                    <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
                    <p className="text-sm text-muted-foreground mt-1">Manage your preferences</p>
                </div>

                <div className="max-w-lg divide-y divide-border border rounded-xl overflow-hidden bg-card">
                    <NotificationsRow />

                    {/* Reminders & alerts */}
                    <button
                        onClick={() => setRemindersOpen(true)}
                        className="flex w-full items-center justify-between gap-6 px-4 py-3.5 text-left transition-colors hover:bg-accent/50"
                    >
                        <div className="flex items-start gap-3">
                            <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            <div>
                                <p className="text-sm font-medium">Reminders &amp; alerts</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Repeating leave-by reminders, and stop &amp; route alerts
                                </p>
                            </div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>

                    {/* Region */}
                    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
                        <div>
                            <p className="text-sm font-medium">Region</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Your transit provider</p>
                        </div>
                        <Select
                            value={currentUrl.url}
                            onValueChange={(val) => {
                                const item = urlOptions.find((item) => item.url === val)
                                if (item) {
                                    setCurrentUrl(item)
                                    window.location.reload()
                                }
                            }}
                        >
                            <SelectTrigger className="w-[200px] shrink-0">
                                <SelectValue placeholder="Select a provider" />
                            </SelectTrigger>
                            <SelectContent>
                                {urlOptions.map((item) => (
                                    <SelectItem key={item.url} value={item.url}>
                                        <div className="flex items-center gap-2">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                alt="provider logo"
                                                className="w-4 h-4 object-contain"
                                                src={item.logoUrl}
                                            />
                                            <span>{item.displayName}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Theme */}
                    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
                        <div>
                            <p className="text-sm font-medium">Appearance</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Light, dark, or match system</p>
                        </div>
                        <Select value={theme || "system"} onValueChange={(val) => setTheme(val)}>
                            <SelectTrigger className="w-[140px] shrink-0">
                                <SelectValue placeholder="Select theme" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="light">
                                    <div className="flex items-center gap-2">
                                        <Sun className="w-4 h-4" /> Light
                                    </div>
                                </SelectItem>
                                <SelectItem value="dark">
                                    <div className="flex items-center gap-2">
                                        <Moon className="w-4 h-4" /> Dark
                                    </div>
                                </SelectItem>
                                <SelectItem value="system">
                                    <div className="flex items-center gap-2">
                                        <Monitor className="w-4 h-4" /> System
                                    </div>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Map basemap theme */}
                    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
                        <div>
                            <p className="text-sm font-medium">Map style</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Basemap colours, independent of the app theme</p>
                        </div>
                        <Select
                            value={mapTheme}
                            onValueChange={(val) => {
                                const next = val as MapThemeOverride
                                setMapTheme(next)
                                setMapThemeOverride(next)
                            }}
                        >
                            <SelectTrigger className="w-[140px] shrink-0">
                                <SelectValue placeholder="Select map style" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="auto">
                                    <div className="flex items-center gap-2">
                                        <MapIcon className="w-4 h-4" /> Auto
                                    </div>
                                </SelectItem>
                                <SelectItem value="light">
                                    <div className="flex items-center gap-2">
                                        <Sun className="w-4 h-4" /> Light
                                    </div>
                                </SelectItem>
                                <SelectItem value="dark">
                                    <div className="flex items-center gap-2">
                                        <Moon className="w-4 h-4" /> Dark
                                    </div>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Planner style */}
                    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
                        <div>
                            <p className="text-sm font-medium">Planner</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Step by step asks 4 simple questions, one at a time</p>
                        </div>
                        <Select value={plannerStyle ?? "standard"} onValueChange={(v) => setPlannerStyle(v as PlannerStyle)}>
                            <SelectTrigger className="w-[140px] shrink-0">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="standard">Standard</SelectItem>
                                <SelectItem value="stepByStep">Step by step</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <p className="mt-4 max-w-lg text-center text-xs text-muted-foreground">
                    Version {process.env.NEXT_PUBLIC_APP_VERSION} · <Link href="/privacy" className="underline underline-offset-2">Privacy</Link>
                </p>
            </div>

            <ManageNotificationsSheet open={remindersOpen} onOpenChange={setRemindersOpen} />
        </>
    );
}

type PushState = "checking" | "on" | "off" | "blocked" | "unsupported"

/**
 * Whether this browser can get notifications - the iOS `PushStatusCard`:
 * reminders and alerts can't arrive without it, so it says so and offers to
 * turn it on.
 */
function NotificationsRow() {
    const [state, setState] = useState<PushState>("checking")
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (typeof Notification === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
            setState("unsupported")
            return
        }
        setState(Notification.permission === "granted" ? "on" : Notification.permission === "denied" ? "blocked" : "off")
    }, [])

    const turnOn = async () => {
        setBusy(true)
        try {
            const permission = await Notification.requestPermission()
            if (permission === "granted") {
                await ensureSubscription()
                setState("on")
                toast.success("Notifications are on")
            } else {
                setState(permission === "denied" ? "blocked" : "off")
            }
        } catch {
            toast.error("Couldn't turn on notifications")
        } finally {
            setBusy(false)
        }
    }

    const detail = {
        checking: "Checking...",
        on: "On - reminders and alerts can reach this browser",
        off: "Off - reminders and alerts can't reach you yet",
        blocked: "Blocked - allow notifications for this site in your browser's settings",
        unsupported: "Not available in this browser. On iPhone, add this site to your Home Screen, or use the iPhone app.",
    }[state]

    return (
        <div className="flex items-center justify-between gap-6 px-4 py-3.5">
            <div className="flex items-start gap-3">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                    <p className="text-sm font-medium">Notifications</p>
                    <p className={`text-xs mt-0.5 ${state === "on" ? "text-green-700 dark:text-green-400" : state === "blocked" ? "text-destructive" : "text-muted-foreground"}`}>{detail}</p>
                </div>
            </div>
            {state === "off" && (
                <Button size="sm" className="shrink-0" onClick={turnOn} disabled={busy}>Turn on</Button>
            )}
        </div>
    )
}
