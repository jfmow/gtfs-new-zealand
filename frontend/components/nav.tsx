import Link from 'next/link'
import { useRouter } from 'next/router'
import { Map, Settings, CalendarDays, Route, Bell, type LucideIcon } from 'lucide-react'
import { cn, useIsMobile } from '@/lib/utils'
import { useTheme } from 'next-themes'
import { ReactNode, useEffect } from 'react'
import Head from 'next/head'
import { useNotificationFeed } from './notifications/bell'

interface NavTab {
    href: string
    label: string
    icon: LucideIcon
    /** Path prefixes that count as this tab ("/" matches only itself). */
    match: string[]
    /** Shows the unread-notification count. */
    badge?: boolean
}

/**
 * The four tabs, in the iOS app's order (Home/Schedule, Planner, Map,
 * Updates). Updates (/alerts) holds your notifications and reminders ("For
 * you") and service alerts - it replaced the bell and the ☰ menu on every
 * page (2026-11-03, as on iOS), leaving just Settings up top. Map is /map,
 * whose Stops/Vehicles switch replaced the old /stops and /vehicles pages.
 */
const NAV_TABS: NavTab[] = [
    { href: '/', label: 'Schedule', icon: CalendarDays, match: ['/'] },
    { href: '/plan', label: 'Planner', icon: Route, match: ['/plan', '/journey'] },
    { href: '/map', label: 'Map', icon: Map, match: ['/map', '/stops', '/vehicles'] },
    { href: '/alerts', label: 'Updates', icon: Bell, match: ['/alerts'], badge: true },
]

/** Every region gets all four - a timetable-only one's Updates is just "For you". */
function useNavTabs(): NavTab[] {
    return NAV_TABS
}

/** A tab's own page - on a phone these have no top bar (see `NavBar`). */
const TAB_ROOTS = new Set(['/', '/plan', '/map', '/alerts'])

/** Titles for pages that aren't a tab (reached from the menu). */
const PAGE_TITLES: Record<string, string> = {
    '/settings': 'Settings',
    '/privacy': 'Privacy',
    '/reliability': 'Route reliability',
}

function useActiveTab(): NavTab | undefined {
    const router = useRouter()
    return NAV_TABS.find((tab) =>
        tab.match.some((path) => path === '/' ? router.pathname === '/' : router.pathname.startsWith(path))
    )
}

export default function NavBar() {
    const { theme } = useTheme()
    const isMobile = useIsMobile()
    const router = useRouter()
    const activeTab = useActiveTab()
    const tabs = useNavTabs()
    const { unread } = useNotificationFeed()

    const logo = theme === "dark" ? "/branding/nav-logo-dark.png" : "/branding/nav-logo.png"
    const title = PAGE_TITLES[router.pathname] ?? activeTab?.label ?? ''

    // Pages sized to the viewport subtract --tabbar-h (globals.css), which
    // only has a height while the bar is showing.
    useEffect(() => {
        if (!isMobile) return
        document.documentElement.setAttribute('data-tabbar', '')
        return () => document.documentElement.removeAttribute('data-tabbar')
    }, [isMobile])

    // On a phone a tab's own page has no top bar: the tab bar already names
    // it, and Settings sits beside the page's first row (`MobileSettingsLink`)
    // - the bar was a big, nearly empty gap (as on iOS, 2026-11-03). Other
    // pages (Settings, Privacy, a journey link) keep it for their title.
    const hideHeader = isMobile && TAB_ROOTS.has(router.pathname)
    useEffect(() => {
        if (!hideHeader) return
        document.documentElement.setAttribute('data-noheader', '')
        return () => document.documentElement.removeAttribute('data-noheader')
    }, [hideHeader])

    if (hideHeader) {
        return (
            <>
                {/* Clear of the status bar - except the map, which runs under it. */}
                {router.pathname !== '/map' && <div aria-hidden className="h-[calc(env(safe-area-inset-top)+0.75rem)]" />}
                <TabBar tabs={tabs} activeTab={activeTab} unread={unread} />
            </>
        )
    }

    return (
        <>
            {/* Hidden, like the tab bar, under a full-screen tracker - it has its own back button. */}
            <div data-hide-immersive className="sticky top-0 z-50 mb-4 bg-background/90 backdrop-blur-md border-b border-border">
                {isMobile ? (
                    <div className="flex items-center gap-2.5 px-3 h-12">
                        <Link href='/' className="shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={logo} alt="Home" className="w-7 h-7" />
                        </Link>
                        <span className="flex-1 min-w-0 truncate text-[15px] font-semibold">
                            {title}
                        </span>
                        <SettingsLink />
                    </div>
                ) : (
                    <nav className="max-w-[1400px] mx-auto px-4 h-12 flex items-center gap-4">
                        <Link href='/' className="flex items-center shrink-0 mr-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={logo} alt="Home" className="w-7 h-7" />
                        </Link>

                        <ul className="flex items-center gap-1 flex-1 h-full">
                            {tabs.map((tab) => {
                                const active = tab === activeTab
                                return (
                                    <li key={tab.href} className="h-full">
                                        <Link
                                            href={tab.href}
                                            aria-current={active ? 'page' : undefined}
                                            className={cn(
                                                "relative flex items-center gap-1.5 px-3 h-full text-sm font-medium transition-colors",
                                                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                                            )}
                                        >
                                            <tab.icon className="w-4 h-4 shrink-0" />
                                            {tab.label}
                                            {tab.badge && <UnreadBadge count={unread} />}
                                            {active && (
                                                <span className="absolute inset-x-3 -bottom-px h-0.5 bg-primary rounded-full" />
                                            )}
                                        </Link>
                                    </li>
                                )
                            })}
                        </ul>

                        <SettingsLink />
                    </nav>
                )}
            </div>

            {isMobile && <TabBar tabs={tabs} activeTab={activeTab} unread={unread} />}
        </>
    )
}

/** The iOS tab bar: fixed to the bottom on phones, above the home indicator. */
function TabBar({ tabs, activeTab, unread }: { tabs: NavTab[]; activeTab: NavTab | undefined; unread: number }) {
    return (
        <nav
            data-hide-immersive
            aria-label="Main"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
        >
            <ul className={cn("grid h-14", tabs.length === 4 ? "grid-cols-4" : "grid-cols-3")}>
                {tabs.map((tab) => {
                    const active = tab === activeTab
                    return (
                        <li key={tab.href}>
                            <Link
                                href={tab.href}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                    "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                                    active ? "text-foreground" : "text-muted-foreground"
                                )}
                            >
                                <span className="relative">
                                    <tab.icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                                    {tab.badge && unread > 0 && (
                                        <span className="absolute -top-1.5 -right-2.5"><UnreadBadge count={unread} /></span>
                                    )}
                                </span>
                                {tab.label}
                            </Link>
                        </li>
                    )
                })}
            </ul>
        </nav>
    )
}

/** New notifications, on the Updates tab. */
function UnreadBadge({ count }: { count: number }) {
    if (count <= 0) return null
    return (
        <span
            aria-label={`${count} unread`}
            className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
        >
            {count > 9 ? '9+' : count}
        </span>
    )
}

/**
 * Settings beside a tab page's first row, on a phone only - where that page
 * has no top bar (`NavBar`). Wider screens keep it in the top bar.
 */
export function MobileSettingsLink({ className }: { className?: string }) {
    const isMobile = useIsMobile()
    if (!isMobile) return null
    return (
        <span className={cn("shrink-0 [&>a]:border [&>a]:border-border [&>a]:bg-card [&>a]:shadow-sm", className)}>
            <SettingsLink />
        </span>
    )
}

/** Settings - all that's left in the top bar (the bell and ☰ menu went into the Updates tab). */
function SettingsLink() {
    return (
        <Link
            href="/settings"
            aria-label="Settings"
            className="w-9 h-9 flex items-center justify-center rounded-full text-foreground hover:bg-accent transition-colors shrink-0"
        >
            <Settings className="w-[18px] h-[18px]" />
        </Link>
    )
}

export function Header({ title, children }: { title: string, children?: ReactNode }) {
    return (
        <Head>
            <title>{title}</title>
            <HeaderMeta />
            <meta name="description" content="Track public transport vehicles live!" />
            <meta name="keywords" content="at, auckland, auckland transport, transport, trains, bus, travel, car, fly, tracks, train tracks, track train, ferry, at mobile" />
            <link rel="canonical" href="https://trains.suddsy.dev/" />
            <meta property="og:title" content="Live vehicle locations!" />
            <meta property="og:url" content="https://trains.suddsy.dev/" />
            <meta property="og:description" content="Auckland transports trains, buses and ferry's all in one easy to navigate place. Track, predict and prepare your journey." />
            <meta property="og:image" content="https://trains.suddsy.dev/rounded-icon.png" />
            {children}
        </Head>
    )
}

function HeaderMeta() {
    return (
        <>
            <link rel="manifest" href="/pwa/manifest.json" />
            <meta name="mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-capable" content="yes" />
            <meta name="application-name" content="Trains" />
            <meta name="apple-mobile-web-app-title" content="Trains" />
            <meta name="theme-color" content="#F6F9F6" />
            <meta name="msapplication-navbutton-color" content="#F6F9F6" />
            <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
            <meta name="msapplication-starturl" content="/" />
            <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
            <link rel='icon' type='image/png' href='/branding/Favicon.png' />
            <link rel="apple-touch-icon" href='/branding/Favicon.png' />
            <link rel="shortcut icon" href='/branding/Favicon.png' />
        </>
    )
}
