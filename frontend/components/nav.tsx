import Link from 'next/link'
import { useRouter } from 'next/router'
import { Map, Settings2Icon, MenuIcon, X, Car, Siren, CalendarDays, Route } from 'lucide-react'
import { cn, useIsMobile } from '@/lib/utils'
import { useTheme } from 'next-themes'
import { ReactNode, useEffect, useState } from 'react'
import Head from 'next/head'
import FindCurrentVehicle from './services/assistance/find-closest-vehicle'
import { motion, AnimatePresence } from 'framer-motion'
import Favorites from './stops/favourites'

const NAV_ROUTES = [
    {
        href: '/',
        label: 'Live Schedule',
        short: 'Schedule',
        icon: CalendarDays,
    },
    {
        href: '/plan',
        label: 'Journey Planner',
        short: 'Planner',
        icon: Route,
    },
    {
        href: '/stops',
        label: 'Find a Stop',
        short: 'Stops',
        icon: Map,
    },
    {
        href: '/vehicles',
        label: 'Track Vehicles',
        short: 'Vehicles',
        icon: Car,
    },
    {
        href: '/alerts',
        label: 'Travel Alerts',
        short: 'Alerts',
        icon: Siren,
    },
    {
        href: '/settings',
        label: 'Settings',
        short: 'Settings',
        icon: Settings2Icon,
    },
]

export default function NavBar() {
    const { theme } = useTheme()
    const isMobile = useIsMobile()
    const [menuOpen, setMenuOpen] = useState(false)
    const router = useRouter()

    const logo = theme === "dark" ? "/branding/nav-logo-dark.png" : "/branding/nav-logo.png"

    const isActive = (href: string) =>
        href === '/' ? router.pathname === '/' : router.pathname.startsWith(href)

    useEffect(() => {
        if (menuOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
        }
        return () => { document.body.style.overflow = '' }
    }, [menuOpen])

    // Close drawer on route change
    useEffect(() => {
        setMenuOpen(false)
    }, [router.pathname])

    return (
        <>
            {/* ── DESKTOP ──────────────────────────────────────────────── */}
            {!isMobile && (
                <div className="sticky top-0 z-50 bg-background/90 backdrop-blur-md">
                    <nav className="max-w-[1400px] mx-auto px-4 h-12 flex items-center gap-4">
                        <Link href='/' className="flex items-center shrink-0 mr-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={logo} alt="Logo" className="w-7 h-7" />
                        </Link>

                        <ul className="flex items-center gap-0.5 flex-1">
                            {NAV_ROUTES.map((item) => (
                                <li key={item.href}>
                                    <Link
                                        href={item.href}
                                        className={cn(
                                            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                                            isActive(item.href)
                                                ? "bg-accent text-foreground"
                                                : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                                        )}
                                    >
                                        <item.icon className="w-4 h-4 shrink-0" />
                                        {item.short}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>
            )}

            {/* ── MOBILE ───────────────────────────────────────────────── */}
            {isMobile && (
                <>
                    <div className="sticky top-0 z-50 bg-background/90 backdrop-blur-md">
                        <div className="flex items-center justify-between px-3 h-12">
                            <Link href='/'>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={logo} alt="Logo" className="w-7 h-7" />
                            </Link>
                            <button
                                onClick={() => setMenuOpen(true)}
                                aria-label="Open menu"
                                className="w-9 h-9 flex items-center justify-center rounded-md text-foreground hover:bg-accent transition-colors"
                            >
                                <MenuIcon className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    <AnimatePresence>
                        {menuOpen && (
                            <>
                                {/* Backdrop */}
                                <motion.div
                                    key="backdrop"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
                                    onClick={() => setMenuOpen(false)}
                                />

                                {/* Drawer */}
                                <motion.div
                                    key="drawer"
                                    initial={{ x: "100%" }}
                                    animate={{ x: 0 }}
                                    exit={{ x: "100%" }}
                                    transition={{ type: "spring", damping: 28, stiffness: 300 }}
                                    className="fixed inset-y-0 right-0 z-50 w-72 bg-background shadow-2xl flex flex-col"
                                >
                                    {/* Drawer header */}
                                    <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
                                        <Link href='/' onClick={() => setMenuOpen(false)}>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={logo} alt="Logo" className="w-7 h-7" />
                                        </Link>
                                        <button
                                            onClick={() => setMenuOpen(false)}
                                            aria-label="Close menu"
                                            className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>

                                    {/* Scrollable body */}
                                    <div className="flex-1 overflow-y-auto">
                                        {/* Nav links */}
                                        <nav className="p-2">
                                            {NAV_ROUTES.map((item) => (
                                                <Link
                                                    key={item.href}
                                                    href={item.href}
                                                    onClick={() => setMenuOpen(false)}
                                                    className={cn(
                                                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                                                        isActive(item.href)
                                                            ? "bg-accent text-foreground"
                                                            : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                                                    )}
                                                >
                                                    <item.icon className="w-4 h-4 shrink-0" />
                                                    {item.label}
                                                </Link>
                                            ))}
                                        </nav>

                                        {/* Favourites */}
                                        <div className="px-4 py-3 border-t border-border">
                                            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                                                Favourites
                                            </p>
                                            <Favorites onClick={() => setMenuOpen(false)} />
                                        </div>
                                    </div>

                                    {/* Footer */}
                                    <div className="p-3 border-t border-border shrink-0">
                                        <FindCurrentVehicle />
                                    </div>
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>
                </>
            )}
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
            <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
            <link rel='icon' type='image/png' href='/branding/Favicon.png' />
            <link rel="apple-touch-icon" href='/branding/Favicon.png' />
            <link rel="shortcut icon" href='/branding/Favicon.png' />
        </>
    )
}
