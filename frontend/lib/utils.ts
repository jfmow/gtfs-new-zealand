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

interface UseMobileOptions {
  /**
   * The width threshold in pixels below which a device is considered mobile
   * @default 768
   */
  mobileWidth?: number
}

/**
 * React hook to determine if the current device is a mobile device
 * Uses both screen width and user agent detection for better accuracy
 */
export function useIsMobile({ mobileWidth = 768 }: UseMobileOptions = {}): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(false)

  useEffect(() => {
    // Function to check if device is mobile
    const checkIsMobile = () => {
      // Check screen width
      const isMobileByWidth = window.innerWidth < mobileWidth

      // Check user agent for mobile devices
      const isMobileByUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      )

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