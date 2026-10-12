/**
 * File Name: logger.ts
 * Purpose: Minimal structured logger interface used across the Tangen platform for
 *   consistent log-level output with optional metadata.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None — a single standalone interface.
 */

/**
 * Structured logger contract implemented by the platform's Pino-backed logger.
 */
export interface TangenLogger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, errorOrMeta?: Error | Record<string, unknown>): void
}
