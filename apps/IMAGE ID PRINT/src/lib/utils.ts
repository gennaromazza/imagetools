import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** mm → pixel conversion. formula: pixel = (mm / 25.4) * dpi */
export function mmToPx(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi
}
