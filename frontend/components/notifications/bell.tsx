"use client"

import { useEffect, useState } from "react"
import { Bell } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { getMySubscriptions, type RecentNotificationEntry } from "@/lib/notifications"
import { ManageNotificationsSheet } from "./manage-sheet"

const LAST_SEEN_KEY = "notifications_last_seen"
const POLL_MS = 60000

/** Nav bell + unread badge + recent-notification history - the only in-app surface for pushes, which otherwise only ever show as native OS notifications. Read state lives in localStorage (no backend "read" tracking), same as saved trips/favourites elsewhere in this app. */
export function NotificationsBell() {
    const [entries, setEntries] = useState<RecentNotificationEntry[]>([])
    const [lastSeen, setLastSeen] = useState(0)
    const [manageOpen, setManageOpen] = useState(false)

    useEffect(() => {
        try {
            setLastSeen(Number(localStorage.getItem(LAST_SEEN_KEY) ?? "0"))
        } catch {
            // localStorage unavailable (private mode etc) - badge just won't persist across reloads
        }
    }, [])

    useEffect(() => {
        let cancelled = false
        function load() {
            getMySubscriptions().then((data) => {
                if (cancelled || !data) return
                const sorted = [...(data.recent_notifications ?? [])].sort((a, b) => (b.seen_at ?? 0) - (a.seen_at ?? 0))
                setEntries(sorted)
            })
        }
        load()
        const interval = setInterval(load, POLL_MS)
        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [])

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

    return (
        <>
            <Popover onOpenChange={(open) => { if (open) markSeen() }}>
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
                    <div className="p-3 border-b flex items-center justify-between sticky top-0 bg-popover">
                        <p className="text-sm font-medium">Notifications</p>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setManageOpen(true)}>
                            Manage
                        </Button>
                    </div>
                    {entries.length === 0 ? (
                        <p className="p-4 text-sm text-muted-foreground text-center">No notifications yet.</p>
                    ) : (
                        <div className="divide-y">
                            {entries.slice(0, 20).map((entry, i) => (
                                <div key={`${entry.id}-${i}`} className="p-3">
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
