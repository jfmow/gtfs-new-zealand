"use client"

import { Component, type ReactNode } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Props {
    children: ReactNode
    /** Changing this clears a caught error and remounts the children - key it on whatever identifies the thing being tracked (e.g. the route ID) so picking a different journey recovers automatically instead of staying stuck on the fallback. */
    resetKey?: string | number
}

interface State {
    hasError: boolean
}

/**
 * Catches render/lifecycle errors from the live journey-tracking view. A
 * dropped connection can leave live data in an inconsistent shape mid-poll -
 * without this, that throws during render and (with no boundary anywhere in
 * the app) takes the whole page down to blank. This keeps the failure scoped
 * to the tracking sheet, with a way back in.
 */
export class JourneyErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false }

    static getDerivedStateFromError() {
        return { hasError: true }
    }

    componentDidCatch(error: unknown) {
        console.error("Journey tracking view crashed:", error)
    }

    componentDidUpdate(prevProps: Props) {
        if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false })
        }
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-3 border-t bg-background p-6 text-center shadow-lg sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:w-96 sm:-translate-x-1/2 sm:rounded-2xl sm:border">
                    <AlertTriangle className="h-8 w-8 text-amber-500" />
                    <div className="space-y-1">
                        <p className="font-semibold">Journey tracking hit a snag</p>
                        <p className="text-sm text-muted-foreground">
                            This usually happens after a dropped connection. Your search results are still here underneath.
                        </p>
                    </div>
                    <Button size="sm" className="gap-1.5" onClick={() => this.setState({ hasError: false })}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        Try again
                    </Button>
                </div>
            )
        }
        return this.props.children
    }
}
