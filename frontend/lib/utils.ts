import { clsx, type ClassValue } from "clsx"
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