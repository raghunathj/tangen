/**
 * File Name: collector.ts
 * Purpose: The one subscriber that fills the ring and the metrics (closure
 *          plan Phase 9C, Units 5, 11, 26 and 27), and the enablement that
 *          makes "off" mean nothing is subscribed at all.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Demand-driven through the Phase 3 registry: when
 *          telemetry is off the collector is not registered, so the bus's
 *          subscriber set is empty and `emitTelemetry` is a `size` check.
 *          There is no timer, no worker, no queue and no database here -
 *          nothing to keep alive, so nothing to leak.
 */
import { getSchemaWritable } from '../lib/schema-writable'
import { observeTelemetry, resetTelemetry } from './bus'
import { recordEvent, clearRing } from './ring'
import { recordMetric, resetMetrics } from './metrics'
import type { TelemetryEvent } from './contract'

export interface TelemetryConfig {
  /** Keep this share of SUCCESSFUL, fast events. 1 keeps everything. */
  sampleSuccess: number
  /** At or above this many milliseconds an operation is slow, and always kept. */
  slowMs: number
  /** Injected so a test asserts the number the sampler will actually use. */
  random: () => number
}

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  sampleSuccess: 1,
  slowMs: 500,
  random: Math.random,
}

/**
 * Whether telemetry collects here.
 *
 * `TANGEN_TELEMETRY=1|0` decides when it is set. Otherwise it follows the
 * Query Monitor's own default - on where the schema is writable, which is the
 * developer environment - so the two developer tools are on together and a
 * production deployment collects nothing it was not asked to. Deliberately NOT
 * more in production than in development: a ring of recent requests is a
 * debugging aid, not something a live site should pay for unasked.
 */
export function telemetryEnabled(): boolean {
  const env = process.env.TANGEN_TELEMETRY
  if (env === '1') return true
  if (env === '0') return false
  return getSchemaWritable()
}

let unsubscribe: (() => void) | null = null
let config: TelemetryConfig = DEFAULT_TELEMETRY_CONFIG

/** How many events the sampler let go. Visible; never emitted as an event. */
let sampledOut = 0
export const sampledOutCount = (): number => sampledOut

/**
 * Which events survive sampling.
 *
 * A failure, an error, and anything slow are ALWAYS kept: sampling exists to
 * cope with the volume of things going right, and an operational failure that
 * vanished because success traffic was noisy would defeat the whole point.
 */
export function keepEvent(event: TelemetryEvent, cfg: TelemetryConfig = config): boolean {
  if (event.severity === 'error' || event.severity === 'warn') return true
  if (event.status === 'failed') return true
  if (event.durationMs !== undefined && event.durationMs >= cfg.slowMs) return true
  if (cfg.sampleSuccess >= 1) return true
  if (cfg.sampleSuccess <= 0) return false
  return cfg.random() < cfg.sampleSuccess
}

/** Registers the collector. Idempotent; returns the stop function. */
export function startTelemetry(partial: Partial<TelemetryConfig> = {}): () => void {
  config = { ...DEFAULT_TELEMETRY_CONFIG, ...partial }
  if (unsubscribe) return stopTelemetry
  unsubscribe = observeTelemetry((event) => {
    // Metrics see EVERY event: a rate computed from a sample is a lie, and
    // counters are cheap. Only the ring - the expensive, readable part - is
    // sampled.
    recordMetric(event)
    if (!keepEvent(event)) { sampledOut++; return }
    recordEvent(event)
  })
  return stopTelemetry
}

export function stopTelemetry(): void {
  unsubscribe?.()
  unsubscribe = null
}

/** Whether the collector is currently subscribed. */
export const telemetryCollecting = (): boolean => unsubscribe !== null

/** Full reset, for a test. Drops subscribers, ring, metrics and counters. */
export function resetTelemetryState(): void {
  stopTelemetry()
  resetTelemetry()
  clearRing()
  resetMetrics()
  sampledOut = 0
  config = DEFAULT_TELEMETRY_CONFIG
}
