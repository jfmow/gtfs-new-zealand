import Link from 'next/link'
import { Train, MapPin, Map, MessageCircleWarningIcon, Settings2Icon, MenuIcon } from 'lucide-react'
import { Button, buttonVariants } from './ui/button'
import { cn, useIsMobile } from '@/lib/utils'
import { useTheme } from 'next-themes'
import { ReactNode } from 'react'
import Head from 'next/head'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { PopoverClose } from '@radix-ui/react-popover'
import Router from 'next/router'

export default function NavBar() {
    const { theme } = useTheme()
    const isMobile = useIsMobile({ mobileWidth: 820 })

    return (
        <>
            {isMobile ? (
                <nav className='sticky top-0 bg-background/80 backdrop-blur-sm mx-auto max-w-[1400px] w-full py-4 px-2 flex items-center justify-between border-b  relative z-50 h-[70px]'>
                    <Popover>
                        <div className='flex items-center justify-between w-full'>
                            <PopoverTrigger asChild>
                                <Button variant={"ghost"}>
                                    <MenuIcon />
                                    Menu
                                </Button>
                            </PopoverTrigger>
                            <Link href='/'>
                                <div className="flex items-center">
                                    <img src={theme === "dark" ? "/branding/nav-logo-dark.png" : "/branding/nav-logo.png"} alt="Logo" className="w-8 h-8 mr-2" />
                                </div>
                            </Link>
                        </div>
                        <PopoverContent collisionPadding={5}>
                            <span className='font-medium text-sm text-muted-foreground'>Menu</span>
                            <ul className='w-full flex flex-col gap-4 mt-2'>
                                {NAV_ROUTES.map((item) => (
                                    <li key={item.label}>
                                        <PopoverClose>
                                            <button className='flex items-center gap-4' onClick={() => Router.push(item.href)}>
                                                <item.icon className='w-8 h-8 text-primary border rounded-[100vw] p-2 shadow-sm bg-primary/5' />
                                                <div className='flex flex-col text-left'>
                                                    <p className='font-medium text-primary text-sm'>{item.label}</p>
                                                    <p className='text-muted-foreground text-xs'>{item.description}</p>
                                                </div>
                                            </button>
                                        </PopoverClose>
                                    </li>
                                ))}
                            </ul>
                        </PopoverContent>
                    </Popover>
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