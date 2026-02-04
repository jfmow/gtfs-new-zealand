import Link from 'next/link'
import { Map, Settings2Icon, MenuIcon, X, ClockFading, Car, Siren, CalendarDays, Bus } from 'lucide-react'
import { Button, buttonVariants } from './ui/button'
import { cn, useIsMobile } from '@/lib/utils'
import { useTheme } from 'next-themes'
import { ReactNode, useEffect, useState } from 'react'
import Head from 'next/head'
import FindCurrentVehicle from './services/assistance/find-closest-vehicle'
import { motion, AnimatePresence } from 'framer-motion'
import Favorites from './stops/favourites'
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
        description_short: "Schedule"
    },
    {
        href: '/stops',
        label: 'Find a stop',
        description: 'Locate nearby stops',
        icon: Map,
        description_short: "Stops"
    },
    {
        href: '/vehicles',
        label: 'Track Vehicles',
        description: 'View real-time vehicle locations',
        icon: Car,
        description_short: "Vehicles"
    },
    {
        href: '/alerts',
        label: 'Travel Alerts',
        description: 'Travel advisories and alerts',
        icon: Siren,
        description_short: "Alerts"
    },
    {
        href: '/history',
        label: 'Service History',
        description: 'View previous trips and services',
        icon: ClockFading,
        description_short: "History",
        hidden: true
    },
    {
        component: SettingsPopover,
        label: 'Settings',
        description: 'Set app preferences and change region',
        icon: Settings2Icon,
        description_short: "Settings"
    },
].filter(route => !route.hidden)

export default function NavBar() {
    const { theme } = useTheme()
    const isMobile = useIsMobile()
    const [menuOpen, setMenuOpen] = useState(false)
    const router = useRouter()

    useEffect(() => {
        if (menuOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
        }
        return () => {
            document.body.style.overflow = ''
        }
    }, [menuOpen])

    return (
        <>
            {isMobile ? (
                <nav className='sticky top-0 bg-background/95 backdrop-blur-md w-full py-3 px-4 flex items-center justify-between z-50 border-b'>
                    <div className='flex items-center justify-between w-full'>
                        <Link href='/' className="flex items-center gap-2">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary">
                                <Bus className="w-5 h-5 text-primary-foreground" />
                            </div>
                            <span className="font-semibold text-lg">Transit NZ</span>
                        </Link>
                        <Button onClick={() => setMenuOpen(!menuOpen)} variant={"ghost"} size="icon" className="rounded-full">
                            <MenuIcon className="w-5 h-5" />
                        </Button>
                    </div>
                    <AnimatePresence>
                        {menuOpen && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="fixed inset-0 z-50 flex flex-col h-screen w-screen bg-background overflow-x-hidden"
                            >
                                <div className="flex justify-between items-center py-3 px-4 border-b bg-background">
                                    <Link href='/' className="flex items-center gap-2">
                                        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary">
                                            <Bus className="w-5 h-5 text-primary-foreground" />
                                        </div>
                                        <span className="font-semibold text-lg">Transit NZ</span>
                                    </Link>
                                    <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setMenuOpen(false)}>
                                        <X className="w-5 h-5" />
                                    </Button>
                                </div>
                                <motion.div
                                    variants={{
                                        hidden: {},
                                        show: {
                                            transition: {
                                                staggerChildren: 0.08,
                                            },
                                        },
                                    }}
                                    initial="hidden"
                                    animate="show"
                                    className='px-4 py-6 flex flex-col h-full flex-grow overflow-y-auto overflow-x-hidden'>
                                    <div className='flex items-center justify-start mb-3'>
                                        <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Navigation</h3>
                                    </div>
                                    <motion.ul
                                        className="flex flex-col gap-2"
                                        variants={{
                                            hidden: {},
                                            show: {
                                                transition: {
                                                    staggerChildren: 0.08,
                                                },
                                            },
                                        }}
                                    >
                                        {NAV_ROUTES.map((item) => (
                                            <motion.li
                                                key={item.label}
                                                variants={{
                                                    hidden: { opacity: 0, y: 10 },
                                                    show: { opacity: 1, y: 0 },
                                                }}
                                            >
                                                {item.component ? (
                                                    <item.component>
                                                        <button
                                                            className="flex items-center gap-3 w-full text-left p-3 rounded-xl hover:bg-accent transition-colors"
                                                        >
                                                            <div className="flex items-center justify-center w-11 h-11 rounded-lg bg-primary/10">
                                                                <item.icon className='w-5 h-5 text-primary' />
                                                            </div>
                                                            <div className='flex flex-col'>
                                                                <p className='font-semibold text-foreground'>{item.label}</p>
                                                                <p className='text-muted-foreground text-xs'>{item.description}</p>
                                                            </div>
                                                        </button>
                                                    </item.component>
                                                ) : (
                                                    <Link
                                                        className="flex items-center gap-3 w-full text-left p-3 rounded-xl hover:bg-accent transition-colors"
                                                        href={item.href}
                                                        onClick={() => setMenuOpen(false)}
                                                    >
                                                        <div className="flex items-center justify-center w-11 h-11 rounded-lg bg-primary/10">
                                                            <item.icon className='w-5 h-5 text-primary' />
                                                        </div>
                                                        <div className='flex flex-col'>
                                                            <p className='font-semibold text-foreground'>{item.label}</p>
                                                            <p className='text-muted-foreground text-xs'>{item.description}</p>
                                                        </div>
                                                    </Link>
                                                )}
                                            </motion.li>
                                        ))}
                                    </motion.ul>
                                    <motion.div
                                        className='flex items-center justify-start mb-3 mt-6'
                                        variants={{
                                            hidden: { opacity: 0, y: 10 },
                                            show: { opacity: 1, y: 0 },
                                        }}
                                    >
                                        <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Favorites</h3>
                                    </motion.div>
                                    <motion.div
                                        variants={{
                                            hidden: { opacity: 0, y: 10 },
                                            show: { opacity: 1, y: 0 },
                                        }}
                                        className='mb-4'
                                    >
                                        <Favorites grid onClick={() => setMenuOpen(false)} />
                                    </motion.div>
                                </motion.div>
                                <div className='mt-auto p-4 border-t bg-background'>
                                    <FindCurrentVehicle />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </nav>
            ) : (
                <nav className="sticky top-0 bg-background/95 backdrop-blur-md border-b z-50">
                    <div className="mx-auto max-w-[1400px] w-full px-6 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-8">
                            <Link href='/' className="flex items-center gap-2">
                                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary">
                                    <Bus className="w-5 h-5 text-primary-foreground" />
                                </div>
                                <span className="font-semibold text-lg">Transit NZ</span>
                            </Link>
                            <ul className="flex font-medium text-sm items-center gap-1">
                                {NAV_ROUTES.map((item) => {
                                    const isActive = item.href && router.pathname === item.href
                                    return (
                                        <li key={item.label}>
                                            {item.component ? (
                                                <item.component>
                                                    <button className={cn(
                                                        buttonVariants({ variant: 'ghost' }), 
                                                        'flex items-center gap-2 rounded-lg'
                                                    )}>
                                                        <item.icon className='w-4 h-4' />
                                                        <span>{item.description_short}</span>
                                                    </button>
                                                </item.component>
                                            ) : (
                                                <Link
                                                    href={item.href}
                                                    className={cn(
                                                        buttonVariants({ variant: 'ghost' }), 
                                                        'flex items-center gap-2 rounded-lg',
                                                        isActive && 'bg-accent text-accent-foreground'
                                                    )}
                                                >
                                                    <item.icon className='w-4 h-4' />
                                                    <span>{item.description_short}</span>
                                                </Link>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                        </div>
                    </div>
                </nav>
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
            <meta name="keywords" content="at, auckland, auckland transport, transport, trains, bus, travel, car, fly, tracks, train tracks, track train, ferry, at mobile"></meta>
            <link rel="canonical" href="https://trains.suddsy.dev/"></link>
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
            <link rel='icon' type='image/png' href={`/branding/Favicon.png`} />
            <link rel="apple-touch-icon" href={`/branding/Favicon.png`} />
            <link rel="shortcut icon" href={`/branding/Favicon.png`} />
        </>
    )
}

function SettingsPopover({ children }: { children?: ReactNode }) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                {children}
            </PopoverTrigger>
            <PopoverContent>
                <SettingsList />
            </PopoverContent>
        </Popover>
    )
}
