import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A Home section - the iOS `HomeHeading`: a sentence-case heading, an
 * optional live dot, text actions on the right, then content.
 */
export function HomeSection({
    title,
    liveDot = false,
    actions,
    children,
    className,
}: {
    title: string
    /** Ignored - kept so existing callers compile; iOS dropped the count pill. */
    count?: number
    liveDot?: boolean
    actions?: ReactNode
    children: ReactNode
    className?: string
}) {
    const id = `home-${title.toLowerCase().replace(/\W+/g, "-")}`
    return (
        <section aria-labelledby={id} className={cn("flex flex-col gap-2.5", className)}>
            <div className="flex min-h-6 items-center gap-2">
                {liveDot && <span className="live-dot h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" aria-hidden />}
                <h2 id={id} className="text-base font-semibold text-foreground">
                    {title}
                </h2>
                <div className="ml-auto flex items-center gap-3 text-[13px] font-medium text-muted-foreground [&_a:hover]:text-foreground [&_button:hover]:text-foreground">
                    {actions}
                </div>
            </div>
            {children}
        </section>
    )
}

/** An empty or informational state in a Home section - a dashed card with an icon, a line and an optional action. */
export function HomeHint({ icon: Icon, text, action }: { icon: LucideIcon; text: string; action?: ReactNode }) {
    return (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-card/60 p-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground" aria-hidden>
                <Icon className="h-4 w-4" />
            </span>
            <div className="flex min-w-0 flex-col items-start gap-2">
                <p className="text-xs text-muted-foreground">{text}</p>
                {action}
            </div>
        </div>
    )
}
