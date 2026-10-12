/**
 * File Name: toast.ts
 * Purpose: Re-exports the toast imperative API and related types from the shared
 *   UI package so admin components can import from a single consistent path.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/ui (toast, useToastStore, ToastVariant, ToastItem)
 */

export { toast, useToastStore, type ToastVariant, type ToastItem } from '@tangen/ui'
