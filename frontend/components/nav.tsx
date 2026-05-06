'use client'

import Link from 'next/link'
import { Map, Settings2Icon, MenuIcon, X, Car, Siren, CalendarDays, Route, Star } from 'lucide-react'
import { cn, useIsMobile } from '@/lib/utils'
import { useTheme } from 'next-themes'
import { ReactNode, useEffect, useState } from 'react'
import Head from 'next/head'
import FindCurrentVehicle from './services/assistance/find-closest-vehicle'
import { motion, AnimatePresence } from 'framer-motion'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import SettingsList from './settings'
import { useRouter } from 'next/router'


interface BaseNavRoute {
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    description_short: string;
    hidden?: boolean;
}

interface HrefNavRoute extends BaseNavRoute {
    href: string;
    component?: never;
}

interface ComponentNavRoute extends BaseNavRoute {
    href?: never;
    component: React.ComponentType<{ children?: ReactNode }>;
}

type NavRoute = HrefNavRoute | ComponentNavRoute;

const NAV_ROUTES: NavRoute[] = [
    {
        href: '/',
        label: 'Live Schedule',
        description: 'Find transportation options',
        icon: CalendarDays,
        description_short: 'Schedule',
    },
    {
        href: '/plan',
        label: 'Journey Planner',
        description: 'Plan your trip',
        icon: Route,
        description_short: 'Planner',
    },
    {
        href: '/stops',
        label: 'Find a Stop',
        description: 'Locate nearby stops',
        icon: Map,
        description_short: 'Stops',
    },
    {
        href: '/vehicles',
        label: 'Track Vehicles',
        description: 'View real-time vehicle locations',
        icon: Car,
        description_short: 'Vehicles',
    },
    {
        href: '/alerts',
        label: 'Travel Alerts',
        description: 'Travel advisories and alerts',
        icon: Siren,
        description_short: 'Alerts',
    },
    {
        component: SettingsPopover,
        label: 'Settings',
        description: 'Set app preferences and change region',
        icon: Settings2Icon,
        description_short: 'Settings',
    },
]

export default function NavBar() {
    const { theme } = useTheme()
    const isMobile = useIsMobile()
    const [menuOpen, setMenuOpen] = useState(false)
    const router = useRouter()
    const pathname = router.pathname

    useEffect(() => {
        document.body.style.overflow = menuOpen ? 'hidden' : ''
        return () => { document.body.style.overflow = '' }
    }, [menuOpen])

    // Close menu on route change
    useEffect(() => {
        setMenuOpen(false)
    }, [pathname])

    const logoSrc = theme === 'dark' ? '/branding/nav-logo-dark.png' : '/branding/nav-logo.png'

    return (
        <>
            {isMobile ? (
                <MobileNav
                    logoSrc={logoSrc}
                    menuOpen={menuOpen}
                    setMenuOpen={setMenuOpen}
                    pathname={pathname}
                />
            ) : (
                <DesktopNav logoSrc={logoSrc} pathname={pathname} />
            )}
        </>
    )
}

// ─────────────────────────────────────────────
// DESKTOP NAV
// ─────────────────────────────────────────────
function DesktopNav({ logoSrc, pathname }: { logoSrc: string; pathname: string | null }) {
    return (
        <nav className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/90 backdrop-blur-md">
            <div className="mx-auto max-w-[1400px] px-4 h-14 flex items-center gap-6">
                {/* Logo */}
                <Link href="/" className="flex items-center shrink-0">
                    <img src={logoSrc} alt="Logo" className="w-7 h-7" />
                </Link>

                {/* Divider */}
                <div className="h-5 w-px bg-border" />

                {/* Nav links */}
                <ul className="flex items-center gap-1 flex-1">
                    {NAV_ROUTES.map((item) => {
                        const isActive = item.href ? (item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href)) : false

                        const content = (
                            <span className={cn(
                                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer select-none',
                                isActive
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                            )}>
                                <item.icon className="w-4 h-4 shrink-0" />
                                {item.description_short}
                            </span>
                        )

                        return (
                            <li key={item.label}>
                                {item.component ? (
                                    <item.component>{content}</item.component>
                                ) : (
                                    <Link href={item.href}>{content}</Link>
                                )}
                            </li>
                        )
                    })}
                </ul>
            </div>
        </nav>
    )
}

// ─────────────────────────────────────────────
// MOBILE NAV
// ─────────────────────────────────────────────
function MobileNav({
    logoSrc,
    menuOpen,
    setMenuOpen,
    pathname,
}: {
    logoSrc: string
    menuOpen: boolean
    setMenuOpen: (v: boolean) => void
    pathname: string | null
}) {
    return (
        <nav className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/90 backdrop-blur-md">
            <div className="h-14 px-4 flex items-center justify-between">
                <Link href="/" className="flex items-center">
                    <img src={logoSrc} alt="Logo" className="w-7 h-7" />
                </Link>
                <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                    className="flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                    {menuOpen ? <X className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
                </button>
            </div>

            <AnimatePresence>
                {menuOpen && (
                    <motion.div
                        key="mobile-menu"
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="fixed inset-0 top-14 z-40 flex flex-col bg-background overflow-y-auto overflow-x-hidden"
                    >
                        <div className="flex flex-col gap-6 px-4 pt-6 pb-8 flex-1">

                            {/* Navigation section */}
                            <section>
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 px-1">
                                    Navigate
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    {NAV_ROUTES.map((item) => {
                                        const isActive = item.href
                                            ? (item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href))
                                            : false

                                        const content = (
                                            <div className={cn(
                                                'flex items-center gap-3 w-full px-4 py-3.5 rounded-xl border transition-colors',
                                                isActive
                                                    ? 'border-primary/20 bg-primary/8 text-primary'
                                                    : 'border-border bg-card text-foreground hover:bg-muted'
                                            )}>
                                                <div className={cn(
                                                    'flex items-center justify-center w-9 h-9 rounded-lg shrink-0',
                                                    isActive ? 'bg-primary/15' : 'bg-muted'
                                                )}>
                                                    <item.icon className={cn('w-4 h-4', isActive ? 'text-primary' : 'text-muted-foreground')} />
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <span className="text-sm font-semibold leading-tight truncate">
                                                        {item.description_short}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground leading-tight mt-0.5 truncate">
                                                        {item.description}
                                                    </span>
                                                </div>
                                            </div>
                                        )

                                        return (
                                            <motion.div
                                                key={item.label}
                                                initial={{ opacity: 0, y: 6 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: NAV_ROUTES.indexOf(item) * 0.04 }}
                                            >
                                                {item.component ? (
                                                    <item.component>{content}</item.component>
                                                ) : (
                                                    <Link href={item.href} onClick={() => setMenuOpen(false)}>
                                                        {content}
                                                    </Link>
                                                )}
                                            </motion.div>
                                        )
                                    })}
                                </div>
                            </section>

                            {/* Favourites section */}
                            <section>
                                <div className="flex items-center gap-2 mb-3 px-1">
                                    <Star className="w-3.5 h-3.5 text-muted-foreground" />
                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Favourite Stops
                                    </p>
                                </div>
                                <MobileFavorites onClick={() => setMenuOpen(false)} />
                            </section>

                            {/* Find my vehicle */}
                            <section className="mt-auto pt-2">
                                <FindCurrentVehicle />
                            </section>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </nav>
    )
}

// ─────────────────────────────────────────────
// MOBILE FAVOURITES — cleaner layout
// ─────────────────────────────────────────────
function MobileFavorites({ onClick }: { onClick?: () => void }) {
    const [favorites, setFavorites] = useState<{ stop: string; displayName: string }[]>([])

    useEffect(() => {
        const load = () => {
            if (typeof window === 'undefined') return
            setFavorites(JSON.parse(window.localStorage.getItem('favorites') || '[]'))
        }
        load()
        window.addEventListener('favoritesUpdated', load)
        return () => window.removeEventListener('favoritesUpdated', load)
    }, [])

    if (favorites.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-1 py-6 rounded-xl border border-dashed border-border text-muted-foreground">
                <Star className="w-5 h-5 opacity-40" />
                <p className="text-sm">No favourites saved yet</p>
                <p className="text-xs opacity-70">Star a stop to save it here</p>
            </div>
        )
    }

    return (
        <div className="grid grid-cols-2 gap-2">
            {favorites.map((fav) => (
                <Link
                    key={fav.stop}
                    href={`/?s=${fav.stop}`}
                    onClick={onClick}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border bg-card hover:bg-muted transition-colors"
                >
                    <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-yellow-500/10 shrink-0">
                        <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold truncate">{fav.displayName}</span>
                        <span className="text-xs text-muted-foreground truncate">{fav.stop}</span>
                    </div>
                </Link>
            ))}
        </div>
    )
}

// ─────────────────────────────────────────────
// SETTINGS POPOVER
// ─────────────────────────────────────────────
function SettingsPopover({ children }: { children?: ReactNode }) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                {children}
            </PopoverTrigger>
            <PopoverContent className="w-72" align="start">
                <SettingsList />
            </PopoverContent>
        </Popover>
    )
}

// ─────────────────────────────────────────────
// HEADER / SEO
// ─────────────────────────────────────────────
export function Header({ title, children }: { title: string; children?: ReactNode }) {
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
            <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
            <link rel="icon" type="image/png" href="/branding/Favicon.png" />
            <link rel="apple-touch-icon" href="/branding/Favicon.png" />
            <link rel="shortcut icon" href="/branding/Favicon.png" />
        </>
    )
}
