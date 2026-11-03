"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/router"
import { BellRing, ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    getMySubscriptions,
    dismissNotification,
    clearNotifications,
    type RecentNotificationEntry,
} from "@/lib/notifications"
import { ManageNotificationsSheet } from "./manage-sheet"

const LAST_SEEN_KEY = "notifications_last_seen"
const LAST_SEEN_EVENT = "notificationsSeen"
const UPDATED_EVENT = "notificationsUpdated"
const POLL_MS = 60000

/**
 * The recent-notification history (the only in-app surface for pushes,
 * which otherwise only show as native OS notifications) and how many are
 * new. Read state lives in localStorage - there's no backend "read"
 * tracking. Shared by the Updates tab's badge and its "For you" list.
 */
export function useNotificationFeed() {
    const [entries, setEntries] = useState<RecentNotificationEntry[]>([])
    const [lastSeen, setLastSeen] = useState(0)

    useEffect(() => {
        const read = () => {
            try {
                setLastSeen(Number(localStorage.getItem(LAST_SEEN_KEY) ?? "0"))
            } catch {
                // localStorage unavailable (private mode etc) - the badge just won't persist
            }
        }
        read()
        window.addEventListener(LAST_SEEN_EVENT, read)
        return () => window.removeEventListener(LAST_SEEN_EVENT, read)
    }, [])

    const load = useCallback(() => {
        getMySubscriptions().then((data) => {
            if (!data) return
            setEntries(
                [...(data.recent_notifications ?? [])]
                    .filter((e) => !e.dismissed)
                    .sort((a, b) => (b.seen_at ?? 0) - (a.seen_at ?? 0))
            )
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

    const markSeen = useCallback(() => {
        try {
            localStorage.setItem(LAST_SEEN_KEY, String(Math.floor(Date.now() / 1000)))
        } catch {
            // ignore - see above
        }
        window.dispatchEvent(new CustomEvent(LAST_SEEN_EVENT))
    }, [])

    const dismiss = (id: string) => {
        setEntries((prev) => prev.filter((e) => e.id !== id))
        dismissNotification(id).finally(() => window.dispatchEvent(new CustomEvent(UPDATED_EVENT)))
    }

    const clearAll = () => {
        setEntries([])
        clearNotifications().finally(() => window.dispatchEvent(new CustomEvent(UPDATED_EVENT)))
    }

    return {
        entries,
        unread: entries.filter((e) => (e.seen_at ?? 0) > lastSeen).length,
        markSeen,
        dismiss,
        clearAll,
    }
}

/**
 * The Updates tab's "For you": a way into your alerts and reminders, then
 * recent notifications by day - tap one to open it. Marks them seen.
 */
export function NotificationsInbox() {
    const router = useRouter()
    const { entries, markSeen, dismiss, clearAll } = useNotificationFeed()
    const [manageOpen, setManageOpen] = useState(false)

    useEffect(() => {
        markSeen()
    }, [markSeen, entries.length])

    const startOfDay = new Date().setHours(0, 0, 0, 0) / 1000
    const groups = [
        { title: "Today", items: entries.filter((e) => (e.seen_at ?? 0) >= startOfDay) },
        { title: "Earlier", items: entries.filter((e) => (e.seen_at ?? 0) < startOfDay) },
    ].filter((g) => g.items.length > 0)

    return (
        <div className="flex flex-col gap-5">
            <button
                type="button"
                onClick={() => setManageOpen(true)}
                className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left hover:bg-accent/50 transition-colors"
            >
                <BellRing className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-sm font-medium">Alerts &amp; reminders</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>

            {entries.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                    <BellRing className="h-6 w-6 text-muted-foreground" />
                    <p className="font-medium">No notifications yet</p>
                    <p className="max-w-xs text-sm text-muted-foreground">
                        Stop and route alerts, and leave-by reminders, show up here.
                    </p>
                </div>
            ) : (
                <>
                    {groups.map((group) => (
                        <section key={group.title} className="flex flex-col gap-2">
                            <h2 className="text-sm font-medium text-muted-foreground">{group.title}</h2>
                            <div className="divide-y rounded-xl border bg-card">
                                {group.items.slice(0, 50).map((entry, i) => (
                                    <div key={`${entry.id}-${i}`} className="flex items-start gap-1 pr-1.5">
                                        <button
                                            type="button"
                                            disabled={!entry.url}
                                            onClick={() => entry.url && router.push(entry.url)}
                                            className="flex-1 min-w-0 px-4 py-3 text-left enabled:hover:bg-accent/50 disabled:cursor-default transition-colors"
                                        >
                                            <div className="flex items-baseline justify-between gap-2">
                                                <p className="text-sm font-medium">{entry.title || "Notification"}</p>
                                                {!!entry.seen_at && (
                                                    <span className="shrink-0 text-xs text-muted-foreground">
                                                        {new Date(entry.seen_at * 1000).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" })}
                                                    </span>
                                                )}
                                            </div>
                                            {entry.body && <p className="mt-0.5 text-sm text-muted-foreground line-clamp-3">{entry.body}</p>}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label="Dismiss notification"
                                            onClick={() => dismiss(entry.id)}
                                            className="mt-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
                    <Button variant="ghost" size="sm" className="self-center text-muted-foreground" onClick={clearAll}>
                        Clear all
                    </Button>
                </>
            )}

            <ManageNotificationsSheet open={manageOpen} onOpenChange={setManageOpen} />
        </div>
    )
}
