/**
 * File Name: clipboard.ts
 * Purpose: One place to copy text — writes to the clipboard AND toasts, so every
 *          copy affordance gives the same "Copied to clipboard" feedback.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { toast } from '@/lib/toast'

/** Copy `text`, toast on success/failure. Returns whether it copied. */
export async function copyToClipboard(text: string, message = 'Copied to clipboard'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
    return true
  } catch {
    toast.error('Could not copy to clipboard')
    return false
  }
}
