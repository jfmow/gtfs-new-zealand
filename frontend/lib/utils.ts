import { clsx, type ClassValue } from "clsx"
import { useEffect, useState } from "react";
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function convertSecondsToTime(seconds: number) {
  const hours = Math.floor(seconds / 3600); // Calculate the whole hours
  const minutes = Math.floor((seconds % 3600) / 60); // Calculate remaining minutes
  const remainingSeconds = seconds % 60; // Calculate remaining seconds

  if (hours > 0) {
    return `${hours}h ${minutes}min ${remainingSeconds.toFixed(2)}sec`;
  } else {
    return `${minutes}min ${remainingSeconds.toFixed(2)}sec`;
  }
}

export function convertSecondsToTimeNoDecimal(seconds: number) {
  const hours = Math.floor(seconds / 3600); // Calculate the whole hours
  const minutes = Math.floor((seconds % 3600) / 60); // Calculate remaining minutes
  const remainingSeconds = Math.floor(seconds % 60); // Calculate remaining seconds

  if (hours > 0) {
    return `${hours}h ${minutes}min ${remainingSeconds}sec`;
  } else {
    return `${minutes}min ${remainingSeconds}sec`;
  }
}
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function formatDistance(meters: number) {
  if (meters >= 1000) {
    return (meters / 1000).toFixed(2) + " km";
  } else {
    return Math.round(meters) + " m";
  }
}

export function fullyEncodeURIComponent(str: string) {
  return Array.from(str)
    .map(char => {
      const code = char.charCodeAt(0);
      // Don't encode unreserved URI characters
      if (
        (code >= 0x30 && code <= 0x39) || // 0-9
        (code >= 0x41 && code <= 0x5A) || // A-Z
        (code >= 0x61 && code <= 0x7A) || // a-z
        '-_.~'.includes(char)
      ) {
        return char;
      }
      return '%' + code.toString(16).toUpperCase().padStart(2, '0');
    })
    .join('');
}

const MOBILE_UA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i

interface UseMobileOptions {
  /**
   * The width threshold in pixels below which a device is considered mobile
   * @default 768
   */
  mobileWidth?: number
  /**
   * Resolve synchronously from `window` on the very first client render instead
   * of defaulting to `false` until the mount effect runs. Only safe for callers
   * that render no DOM differences during hydration (e.g. content gated behind
   * an `open` prop that is always false at hydration) - otherwise it causes a
   * hydration mismatch.
   * @default false
   */
  immediate?: boolean
}

/**
 * React hook to determine if the current device is a mobile device
 * Uses both screen width and user agent detection for better accuracy
 */
export function useIsMobile({ mobileWidth = 768, immediate = false }: UseMobileOptions = {}): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (!immediate || typeof window === "undefined") return false
    return window.innerWidth < mobileWidth || MOBILE_UA.test(navigator.userAgent)
  })

  useEffect(() => {
    // Function to check if device is mobile
    const checkIsMobile = () => {
      // Check screen width
      const isMobileByWidth = window.innerWidth < mobileWidth

      // Check user agent for mobile devices
      const isMobileByUserAgent = MOBILE_UA.test(navigator.userAgent)

      // Consider a device mobile if either condition is true
      setIsMobile(isMobileByWidth || isMobileByUserAgent)
    }

    // Check immediately on mount
    checkIsMobile()

    // Add event listeners for responsive behavior
    window.addEventListener("resize", checkIsMobile)
    window.addEventListener("orientationchange", checkIsMobile)

    // Clean up event listeners
    return () => {
      window.removeEventListener("resize", checkIsMobile)
      window.removeEventListener("orientationchange", checkIsMobile)
    }
  }, [mobileWidth])

  return isMobile
}

/** Tracks the browser's own online/offline signal (e.g. flight mode, a dropped wifi/cell connection) - fast and free compared to waiting for a poll to fail. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener("online", goOnline)
    window.addEventListener("offline", goOffline)
    return () => {
      window.removeEventListener("online", goOnline)
      window.removeEventListener("offline", goOffline)
    }
  }, [])

  return online
}