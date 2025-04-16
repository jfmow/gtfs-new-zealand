'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Menu, X, Train, MapPin, Map, MessageCircleWarningIcon } from 'lucide-react'
import ThemePicker, { useTheme } from './theme'
import { buttonVariants } from './ui/button'


export default function NavBar() {
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const { theme } = useTheme()
    useEffect(() => {
        if (isMenuOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = 'unset'
        }

        return () => {
            document.body.style.overflow = 'unset'
        }
    }, [isMenuOpen])

    const toggleMenu = () => setIsMenuOpen(!isMenuOpen)

    return (
        <nav className="mx-auto max-w-[1400px] w-full p-4 flex items-center justify-between border-b relative z-50 h-[70px]">
            <div className="flex items-center">
                <img src={theme === "dark" ? "/branding/nav-logo-dark.png" : "/branding/nav-logo.png"} alt="Logo" className="w-8 h-8 mr-2" />
            </div>


            {/* Desktop menu */}
            <div className='hidden md:flex items-center gap-2'>
                <ul className="hidden md:flex font-medium text-sm items-center gap-4">
                    <NavItems />
                </ul>
                <ThemePicker />
            </div>


            <div className='flex md:hidden items-center gap-4'>
                <ThemePicker />
                {/* Hamburger menu button (mobile only) */}
                <button
                    className="md:hidden z-50"
                    onClick={toggleMenu}
                    aria-label="Toggle menu"
                >
                    {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
            </div>

            {/* Mobile menu */}
            <div
                className={`
                fixed inset-0 
                bg-white/10 
                backdrop-blur-md 
                z-40 
                md:hidden 
                transition-all 
                duration-500 
                ease-in-out 
                ${isMenuOpen ? 'opacity-100 pointer-events-auto translate-x-0' : 'opacity-0 pointer-events-none translate-x-full'}
              `}>
                <div className="flex flex-col pt-20 px-6">
                    <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl mb-4">Menu</h1>
                </div>
                <ul className="flex flex-col h-full px-6 overflow-y-auto list-none">
                    <NavItems toggleMenu={toggleMenu} mobile />
                </ul>
            </div>
        </nav>
    )
}

function NavItems({ mobile = false, toggleMenu }: { mobile?: boolean, toggleMenu?: () => void }) {
    const items = [
        {
            href: '/',
            label: 'Train/Bus/Ferry',
            description: 'Find transportation options',
            icon: Train,
        },
        {
            href: '/stops',
            label: 'Find a stop',
            description: 'Locate nearby stops',
            icon: MapPin,
        },
        {
            href: '/vehicles',
            label: 'Vehicles',
            description: 'View real-time vehicle locations',
            icon: Map,
        },
        {
            href: '/alerts',
            label: 'Travel Alerts',
            description: 'Travel advisories and alerts',
            icon: MessageCircleWarningIcon,
        },
    ]

    return (
        <>
            {items.map((item) => (
                <li key={item.href} className="block" onClick={() => typeof toggleMenu === "function" && toggleMenu()}>
                    <Link
                        href={item.href}
                        className={
                            mobile
                                ? 'grid active:bg-gray-100 rounded-lg p-4 text-sm font-medium text-gray-900 hover:bg-gray-100'
                                : buttonVariants({ variant: 'ghost', size: 'default' })
                        }
                    >
                        <div className="flex items-center " >
                            <item.icon className={mobile ? 'w-6 h-6 mr-4' : 'w-4 h-4 mr-2'} />
                            <span >{item.label}</span>
                        </div>
                        {mobile && (
                            <p className="text-sm text-gray-500 mt-1 ml-10">
                                {item.description}
                            </p>
                        )}
                    </Link>
                </li>
            ))}
        </>
    )
}


export function HeaderMeta() {
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