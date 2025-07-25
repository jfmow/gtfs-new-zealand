import Link from 'next/link'
import { Train, MapPin, Map, MessageCircleWarningIcon, Settings2Icon, MenuIcon, X, StarIcon } from 'lucide-react'
import { Button, buttonVariants } from './ui/button'
import { cn, useIsMobile } from '@/lib/utils'
import { useTheme } from 'next-themes'
import { ReactNode, useEffect, useState } from 'react'
import Head from 'next/head'
import Router from 'next/router'
import FindCurrentVehicle from './services/assistance/find-closest-vehicle'
import { motion, AnimatePresence } from 'framer-motion'
import Favorites from './stops/favourites'

export default function NavBar() {
    const { theme } = useTheme()
    const isMobile = useIsMobile()
    const [menuOpen, setMenuOpen] = useState(false)

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
                <nav className='sticky top-0 bg-background/80 backdrop-blur-sm mx-auto max-w-[1400px] w-full py-4 px-2 flex items-center justify-between border-b relative z-50 h-[70px]'>
                    <div className='flex items-center justify-between w-full'>
                        <Button onClick={() => setMenuOpen(!menuOpen)} variant={"ghost"}>
                            <MenuIcon />
                            Menu
                        </Button>
                        <Link href='/'>
                            <div className="flex items-center">
                                <img src={theme === "dark" ? "/branding/nav-logo-dark.png" : "/branding/nav-logo.png"} alt="Logo" className="w-8 h-8 mr-2" />
                            </div>
                        </Link>
                    </div>
                    <AnimatePresence>
                        {menuOpen && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="fixed inset-0 z-50 flex flex-col h-screen w-screen bg-background bg-white dark:bg-black"
                            >
                                <div className="flex justify-between items-center mt-4 mx-2">
                                    <Button variant="ghost" onClick={() => setMenuOpen(false)}>
                                        <X className="w-6 h-6" />
                                        Menu
                                    </Button>
                                </div>
                                <motion.div
                                    variants={{
                                        hidden: {},
                                        show: {
                                            transition: {
                                                staggerChildren: 0.1,
                                            },
                                        },
                                    }}
                                    initial="hidden"
                                    animate="show"
                                    className='px-4 flex flex-col h-full flex-grow overflow-y-auto'>
                                    <div className='flex items-center justify-start mb-4 mt-8'>
                                        <p className='text-muted-foreground text-sm'>Menu</p>
                                    </div>
                                    <motion.ul
                                        className="flex flex-col gap-3"
                                        variants={{
                                            hidden: {},
                                            show: {
                                                transition: {
                                                    staggerChildren: 0.1,
                                                },
                                            },
                                        }}
                                    >
                                        {NAV_ROUTES.map((item) => (
                                            <motion.li
                                                key={item.label}
                                                variants={{
                                                    hidden: { opacity: 0, x: -20 },
                                                    show: { opacity: 1, x: 0 },
                                                }}
                                            >
                                                <button
                                                    className="flex items-center gap-4 w-full text-left"
                                                    onClick={() => {
                                                        Router.push(item.href)
                                                        setMenuOpen(false)
                                                    }}
                                                >
                                                    <item.icon className='w-12 h-12 text-primary border rounded-2xl p-3 shadow-sm bg-primary/5' />
                                                    <div className='flex flex-col'>
                                                        <p className='font-medium text-primary'>{item.label}</p>
                                                        <p className='text-muted-foreground text-sm'>{item.description}</p>
                                                    </div>
                                                </button>
                                            </motion.li>
                                        ))}
                                    </motion.ul>
                                    <motion.div
                                        className='flex items-center justify-start mb-4 mt-8'
                                        variants={{
                                            hidden: { opacity: 0, x: -20 },
                                            show: { opacity: 1, x: 0 },
                                        }}
                                    >
                                        <StarIcon className="text-yellow-500 fill-yellow-500 w-4 h-4 mr-2 hidden" />
                                        <p className='text-muted-foreground text-sm'>Favourites</p>
                                    </motion.div>
                                    <motion.div
                                        variants={{
                                            hidden: { opacity: 0, x: -20 },
                                            show: { opacity: 1, x: 0 },
                                        }}
                                    >
                                        <Favorites grid onClick={() => setMenuOpen(false)} />
                                    </motion.div>
                                </motion.div>
                                <div
                                    className='mt-auto grid gap-2 p-4'
                                >
                                    <FindCurrentVehicle />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </nav>
            ) : (
                <nav className="sticky top-0 bg-background/80 backdrop-blur-sm mx-auto max-w-[1400px] w-full p-4 flex items-center justify-between border-b  relative z-50 h-[70px]">
                    <Link href='/'>
                        <div className="flex items-center">
                            <img src={theme === "dark" ? "/branding/nav-logo-dark.png" : "/branding/nav-logo.png"} alt="Logo" className="w-8 h-8 mr-2" />
                        </div>
                    </Link>
                    <div className='flex items-center gap-2'>
                        <ul className="flex font-medium text-sm items-center gap-4">
                            <NavItems />
                        </ul>
                    </div>
                </nav>
            )}
        </>
    )
}

const NAV_ROUTES = [
    {
        href: '/',
        label: 'Train/Bus/Ferry',
        description: 'Find transportation options',
        icon: Train,
        description_short: "Services"
    },
    {
        href: '/stops',
        label: 'Find a stop',
        description: 'Locate nearby stops',
        icon: MapPin,
        description_short: "Stops"
    },
    {
        href: '/vehicles',
        label: 'Vehicles',
        description: 'View real-time vehicle locations',
        icon: Map,
        description_short: "Vehicles"
    },
    {
        href: '/alerts',
        label: 'Travel Alerts',
        description: 'Travel advisories and alerts',
        icon: MessageCircleWarningIcon,
        description_short: "Alerts"
    },
    {
        href: '/settings',
        label: 'App Settings',
        description: 'Set app preferences and change region',
        icon: Settings2Icon,
        description_short: "Settings"
    },
]

function NavItems({ toggleMenu }: { toggleMenu?: () => void }) {
    return (
        <>
            {NAV_ROUTES.map((item) => (
                <li key={item.href} className="block" onClick={() => typeof toggleMenu === "function" && toggleMenu()}>
                    <Link
                        href={item.href}
                        className={cn(buttonVariants({ variant: 'link', size: 'default' }), "text-foreground")}
                    >
                        <div className="flex items-center " >
                            <item.icon className={'w-4 h-4 mr-2'} />
                            <span >{item.label}</span>
                        </div>
                    </Link>
                </li>
            ))}
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