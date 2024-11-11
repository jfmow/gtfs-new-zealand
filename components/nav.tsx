'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Menu, X, Train, MapPin, Map } from 'lucide-react'

export default function NavBar() {
    const [isMenuOpen, setIsMenuOpen] = useState(false)

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
        <nav className="w-full p-4 flex items-center justify-between border-b relative z-50 h-[70px]">
            <div className="flex items-center">
                <img src="/nav-logo.png" alt="Logo" className="w-8 h-8 mr-2" />
            </div>

            {/* Desktop menu */}
            <ul className="hidden md:flex font-medium text-sm items-center gap-4">
                <NavItems />
            </ul>

            {/* Hamburger menu button (mobile only) */}
            <button
                className="md:hidden z-50"
                onClick={toggleMenu}
                aria-label="Toggle menu"
            >
                {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            {/* Mobile menu */}
            <div
                className={`fixed inset-0 bg-white z-40 md:hidden transition-transform duration-300 ease-in-out ${isMenuOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
            >
                <div className="flex flex-col pt-20 px-6">
                    <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl mb-4">Menu</h1>
                </div>
                <ul className="flex flex-col h-full px-6 overflow-y-auto list-none">
                    <NavItems mobile />
                </ul>
            </div>
        </nav>
    )
}

function NavItems({ mobile = false }: { mobile?: boolean }) {
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
    ]

    return (
        <>
            {items.map((item) => (
                <Link key={item.href} href={item.href} className="block">
                    <li
                        className={
                            mobile
                                ? 'mb-8'
                                : 'rounded p-2 hover:bg-zinc-300/70 transition-colors duration-200'
                        }
                    >
                        <div className="flex items-center">
                            <item.icon className={mobile ? 'w-6 h-6 mr-4' : 'w-4 h-4 mr-2'} />
                            <span>{item.label}</span>
                        </div>
                        {mobile && (
                            <p className="text-sm text-gray-500 mt-1 ml-10">
                                {item.description}
                            </p>
                        )}
                    </li>
                </Link>
            ))}
        </>
    )
}