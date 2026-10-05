import Link from 'next/link'
import { useRouter } from 'next/router'
import { Map, Settings2Icon, MenuIcon, CalendarDays, Route, BellRing, Locate, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn, useIsMobile } from '@/lib/utils'
import { useUrl } from '@/lib/url-context'
import { hasRealtime } from '@/lib/url-store'
import { useTheme } from 'next-themes'
import { ReactNode, useEffect, useState } from 'react'
import Head from 'next/head'
import FindCurrentVehicle from './services/assistance/find-closest-vehicle'
import { NotificationsBell } from './notifications/bell'
import { ManageNotificationsSheet } from './notifications/manage-sheet'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './ui/dropdown-menu'

interface NavTab {
    href: string
    label: string
    icon: LucideIcon
    /** Path prefixes that count as this tab ("/" matches only itself). */
    match: string[]
    /** Needs the region's realtime feed. */
    realtime?: boolean
}

/**
 * The four tabs, in the iOS app's order (Home/Schedule, Planner, Map,
 * Alerts). Settings, My reminders and Find my vehicle live in the menu, as
 * on iOS. Map is /map, whose Stops/Vehicles switch replaced the old /stops
 * and /vehicles pages (they redirect there).
 */
const NAV_TABS: NavTab[] = [
    { href: '/', label: 'Schedule', icon: CalendarDays, match: ['/'] },
    { href: '/plan', label: 'Planner', icon: Route, match: ['/plan', '/journey'] },
    { href: '/map', label: 'Map', icon: Map, match: ['/map', '/stops', '/vehicles'] },
    { href: '/alerts', label: 'Alerts', icon: TriangleAlert, match: ['/alerts'], realtime: true },
]

/** The tabs for the current region - Alerts only where the region has realtime. */
function useNavTabs(): NavTab[] {
    const { currentUrl } = useUrl()
    const realtime = hasRealtime(currentUrl)
    return NAV_TABS.filter((tab) => realtime || !tab.realtime)
}

/** Titles for pages that aren't a tab (reached from the menu). */
const PAGE_TITLES: Record<string, string> = {
    '/settings': 'Settings',
    '/history': 'History',
    '/privacy': 'Privacy',
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

    const logo = theme === "dark" ? "/branding/nav-logo-dark.png" : "/branding/nav-logo.png"
    const title = PAGE_TITLES[router.pathname] ?? activeTab?.label ?? ''

    // Pages sized to the viewport subtract --tabbar-h (globals.css), which
    // only has a height while the bar is showing.
    useEffect(() => {
        if (!isMobile) return
        document.documentElement.setAttribute('data-tabbar', '')
        return () => document.documentElement.removeAttribute('data-tabbar')
    }, [isMobile])

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
                        <span className="flex-1 min-w-0 truncate font-display text-sm font-semibold uppercase tracking-wide">
                            {title}
                        </span>
                        <div className="flex items-center gap-1">
                            <NotificationsBell />
                            <AppMenu />
                        </div>
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
                                                "relative flex items-center gap-1.5 px-3 h-full font-display text-sm font-medium uppercase tracking-wide transition-colors",
                                                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                                            )}
                                        >
                                            <tab.icon className="w-4 h-4 shrink-0" />
                                            {tab.label}
                                            {active && (
                                                <span className="absolute inset-x-3 -bottom-px h-0.5 bg-primary rounded-full" />
                                            )}
                                        </Link>
                                    </li>
                                )
                            })}
                        </ul>

                        <div className="flex items-center gap-1">
                            <NotificationsBell />
                            <AppMenu />
                        </div>
                    </nav>
                )}
            </div>

            {isMobile && <TabBar tabs={tabs} activeTab={activeTab} />}
        </>
    )
}

/** The iOS tab bar: fixed to the bottom on phones, above the home indicator. */
function TabBar({ tabs, activeTab }: { tabs: NavTab[]; activeTab: NavTab | undefined }) {
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
                                <tab.icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                                {tab.label}
                            </Link>
                        </li>
                    )
                })}
            </ul>
        </nav>
    )
}

/** ☰ - what the iOS app's menu holds: My reminders, Find my vehicle, Settings. */
function AppMenu() {
    const router = useRouter()
    const [remindersOpen, setRemindersOpen] = useState(false)
    const [findVehicleOpen, setFindVehicleOpen] = useState(false)
    const { currentUrl } = useUrl()
    const realtime = hasRealtime(currentUrl)

    return (
        <>
            {/* Non-modal: a modal menu that opens a dialog from an item
                strands pointer-events:none on <body>. */}
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                    <button
                        aria-label="Menu"
                        className="w-9 h-9 flex items-center justify-center rounded-md text-foreground hover:bg-accent transition-colors"
                    >
                        <MenuIcon className="w-5 h-5" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => setRemindersOpen(true)}>
                        <BellRing className="w-4 h-4" />
                        My reminders
                    </DropdownMenuItem>
                    {realtime && (
                        <DropdownMenuItem onSelect={() => setFindVehicleOpen(true)}>
                            <Locate className="w-4 h-4" />
                            Find my vehicle
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => router.push('/settings')}>
                        <Settings2Icon className="w-4 h-4" />
                        Settings
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <ManageNotificationsSheet open={remindersOpen} onOpenChange={setRemindersOpen} />
            <FindCurrentVehicle open={findVehicleOpen} onOpenChange={setFindVehicleOpen} />
        </>
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
            <meta name="theme-color" content="#ffffff" />
            <meta name="msapplication-navbutton-color" content="#ffffff" />
            <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
            <meta name="msapplication-starturl" content="/" />
            <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
            <link rel='icon' type='image/png' href='/branding/Favicon.png' />
            <link rel="apple-touch-icon" href='/branding/Favicon.png' />
            <link rel="shortcut icon" href='/branding/Favicon.png' />
        </>
    )
}
