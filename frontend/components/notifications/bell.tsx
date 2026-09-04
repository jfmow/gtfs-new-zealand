"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/router"
import { Bell, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import {
    getMySubscriptions,
    dismissNotification,
    clearNotifications,
    type RecentNotificationEntry,
} from "@/lib/notifications"
import { ManageNotificationsSheet } from "./manage-sheet"

const LAST_SEEN_KEY = "notifications_last_seen"
const UPDATED_EVENT = "notificationsUpdated"
const POLL_MS = 60000

/** Nav bell + unread badge + recent-notification history - the only in-app surface for pushes, which otherwise only ever show as native OS notifications. Entries are tappable (open their deeplink) and dismissable. Read state lives in localStorage (no backend "read" tracking), same as saved trips/favourites elsewhere in this app. */
export function NotificationsBell() {
    const router = useRouter()
    const [entries, setEntries] = useState<RecentNotificationEntry[]>([])
    const [lastSeen, setLastSeen] = useState(0)
    const [manageOpen, setManageOpen] = useState(false)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        try {
            setLastSeen(Number(localStorage.getItem(LAST_SEEN_KEY) ?? "0"))
        } catch {
            // localStorage unavailable (private mode etc) - badge just won't persist across reloads
        }
    }, [])

    const load = useCallback(() => {
        getMySubscriptions().then((data) => {
            if (!data) return
            const sorted = [...(data.recent_notifications ?? [])]
                .filter((e) => !e.dismissed)
                .sort((a, b) => (b.seen_at ?? 0) - (a.seen_at ?? 0))
            setEntries(sorted)
        })
    }, [])

    useEffect(() => {
        load()
        const interval = setInterval(load, POLL_MS)
        window.addEventListener(UPDATED_EVENT, load)
        return () => {
            clearInterval(interval)
            window.removeEventListener(UPDATED_EVENT, load)
        }
    }, [load])

    const unread = entries.filter((e) => (e.seen_at ?? 0) > lastSeen).length

    const markSeen = () => {
        const now = Math.floor(Date.now() / 1000)
        setLastSeen(now)
        try {
            localStorage.setItem(LAST_SEEN_KEY, String(now))
        } catch {
            // ignore - see above
        }
    }

    const handleOpen = (next: string | undefined) => {
        setOpen(false)
        if (next) router.push(next)
    }

    const handleDismiss = (id: string) => {
        setEntries((prev) => prev.filter((e) => e.id !== id))
        dismissNotification(id).finally(() => window.dispatchEvent(new CustomEvent(UPDATED_EVENT)))
    }

    const handleClearAll = () => {
        setEntries([])
        clearNotifications().finally(() => window.dispatchEvent(new CustomEvent(UPDATED_EVENT)))
    }

    return (
        <>
            <Popover
                open={open}
                onOpenChange={(o) => {
                    setOpen(o)
                    if (o) markSeen()
                }}
            >
                <PopoverTrigger asChild>
                    <button
                        aria-label="Notifications"
                        className="relative w-9 h-9 flex items-center justify-center rounded-md text-foreground hover:bg-accent transition-colors shrink-0"
                    >
                        <Bell className="w-4 h-4" />
                        {unread > 0 && (
                            <span className="absolute top-1 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-medium text-destructive-foreground">
                                {unread > 9 ? "9+" : unread}
                            </span>
                        )}
                    </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 max-h-96 overflow-y-auto overscroll-contain p-0">
                    <div className="p-3 border-b flex items-center justify-between sticky top-0 bg-popover z-10">
                        <p className="text-sm font-medium">Notifications</p>
                        <div className="flex items-center gap-1">
                            {entries.length > 0 && (
                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleClearAll}>
                                    Clear all
                                </Button>
                            )}
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setOpen(false); setManageOpen(true) }}>
                                Manage
                            </Button>
                        </div>
                    </div>
                    {entries.length === 0 ? (
                        <p className="p-4 text-sm text-muted-foreground text-center">No notifications yet.</p>
                    ) : (
                        <div className="divide-y">
                            {entries.slice(0, 30).map((entry, i) => (
                                <div key={`${entry.id}-${i}`} className="flex items-start gap-1 pr-1.5">
                                    <button
                                        type="button"
                                        disabled={!entry.url}
                                        onClick={() => handleOpen(entry.url)}
                                        className="flex-1 min-w-0 p-3 text-left enabled:hover:bg-accent/50 disabled:cursor-default transition-colors"
                                    >
                                        <p className="text-sm font-medium">{entry.title || "Notification"}</p>
                                        {entry.body && (
                                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{entry.body}</p>
                                        )}
                                        {!!entry.seen_at && (
                                            <p className="text-[10px] text-muted-foreground/70 mt-1">
                                                {new Date(entry.seen_at * 1000).toLocaleString("en-NZ", {
                                                    day: "numeric",
                                                    month: "short",
                                                    hour: "numeric",
                                                    minute: "2-digit",
                                                })}
                                            </p>
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Dismiss notification"
                                        onClick={() => handleDismiss(entry.id)}
                                        className="mt-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </PopoverContent>
            </Popover>
            <ManageNotificationsSheet open={manageOpen} onOpenChange={setManageOpen} />
        </>
    )
}
