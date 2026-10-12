/**
 * File Name: bus.ts
 * Purpose: The one telemetry emission seam (closure plan Phase 9C, Units 5, 10
 *          and 35), built on the shape the Phase 6A query observer already
 *          proved: a Set of subscribers, a size check when nobody is
 *          listening, and a subscriber that throws contained rather than
 *          propagated.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: THE RULE: telemetry failure must never become
 *          application failure. Nothing here awaits, writes a database,
 *          touches the network or throws. It normalises, bounds and fans out;
 *          a subscriber that wants to persist or export takes it from here and
 *          does that on its own time.
 *
 *          Emission is also RE-ENTRANT-SAFE: a subscriber that emits while
 *          being emitted to is ignored, so a bug cannot become a stack
 *          overflow on the request path.
 */
import {
  TELEMETRY_ATTRIBUTES, TELEMETRY_LIMITS, isTelemetryEventName,
  type TelemetryAttributeValue, type TelemetryEvent, type TelemetryEventInput,
} from './contract'

export type { TelemetryEvent } from './contract'

export type TelemetrySubscriber = (event: TelemetryEvent) => void

const subscribers = new Set<TelemetrySubscriber>()
/** Guards against a subscriber emitting from inside a fan-out. */
let fanningOut = false

/** Why an event never reached a subscriber. Counted, never re-emitted. */
export type DropReason = 'unknown_event' | 'too_large' | 'recursive' | 'subscriber_error'
const dropped: Record<DropReason, number> = { unknown_event: 0, too_large: 0, recursive: 0, subscriber_error: 0 }

/**
 * Registers a subscriber and returns the function that removes it.
 *
 * This IS the exporter seam. An OpenTelemetry, Datadog or file exporter is a
 * subscriber somebody writes; the internal model does not change to admit one,
 * and none ships enabled.
 */
export function observeTelemetry(fn: TelemetrySubscriber): () => void {
  subscribers.add(fn)
  return () => { subscribers.delete(fn) }
}

export function telemetrySubscriberCount(): number { return subscribers.size }
export function resetTelemetry(): void {
  subscribers.clear()
  for (const key of Object.keys(dropped) as DropReason[]) dropped[key] = 0
  fanningOut = false
}

/** What has been lost, and why. Read by the Admin; never emitted as an event. */
export function droppedCounts(): Record<DropReason, number> { return { ...dropped } }

const id = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value === '') return undefined
  // An id longer than this is not an id; refusing beats truncating one into
  // a different id that looks real.
  return value.length > TELEMETRY_LIMITS.maxIdentityLength ? undefined : value
}

/**
 * Keeps only the attributes this event is allowed to carry, as scalars,
 * bounded. Anything else is dropped WITHOUT being inspected - an allow-list
 * cannot be defeated by a name nobody thought of.
 */
function cleanAttributes(name: TelemetryEvent['name'], raw: unknown): Record<string, TelemetryAttributeValue> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const allowed = TELEMETRY_ATTRIBUTES[name]
  const out: Record<string, TelemetryAttributeValue> = {}
  let count = 0
  for (const key of allowed) {
    if (count >= TELEMETRY_LIMITS.maxAttributes) break
    const value = (raw as Record<string, unknown>)[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'number') { if (Number.isFinite(value)) { out[key] = value; count++ } continue }
    if (typeof value === 'boolean') { out[key] = value; count++; continue }
    if (typeof value === 'string') {
      out[key] = value.length > TELEMETRY_LIMITS.maxAttributeLength
        ? `${value.slice(0, TELEMETRY_LIMITS.maxAttributeLength)}…`
        : value
      count++
    }
    // Anything else - an object, an array, a function, an Error - is dropped.
  }
  return count ? out : undefined
}

/** Normalises an input into the event that will be stored, or null. */
export function normalizeEvent(input: TelemetryEventInput): TelemetryEvent | null {
  if (!isTelemetryEventName(input?.name)) { dropped.unknown_event++; return null }

  const event: TelemetryEvent = {
    name: input.name,
    timestamp: Number.isFinite(input.timestamp) ? input.timestamp! : Date.now(),
    severity: input.severity === 'error' || input.severity === 'warn' ? input.severity : 'info',
  }
  if (Number.isFinite(input.durationMs)) event.durationMs = Math.max(0, Math.round(input.durationMs! * 10) / 10)
  if (input.status === 'ok' || input.status === 'failed') event.status = input.status
  const ws = id(input.workspaceId); if (ws) event.workspaceId = ws
  const req = id(input.requestId); if (req) event.requestId = req
  const op = id(input.operationId); if (op) event.operationId = op
  const attributes = cleanAttributes(event.name, input.attributes)
  if (attributes) event.attributes = attributes

  // One serialization check, so nothing unbounded is ever retained. It cannot
  // realistically fail after the bounds above; if it somehow does, the event
  // is dropped rather than kept.
  try {
    if (JSON.stringify(event).length > TELEMETRY_LIMITS.maxEventBytes) { dropped.too_large++; return null }
  } catch { dropped.too_large++; return null }

  return event
}

/**
 * Emits one event. Costs a `size` check when nobody is listening, which is the
 * deployed default. Never throws, never awaits, never reaches the network.
 */
export function emitTelemetry(input: TelemetryEventInput): void {
  if (subscribers.size === 0) return
  if (fanningOut) { dropped.recursive++; return }

  const event = normalizeEvent(input)
  if (!event) return

  fanningOut = true
  try {
    for (const subscriber of subscribers) {
      // A subscriber that throws is counted and skipped. It must never be able
      // to fail the request that emitted.
      try { subscriber(event) } catch { dropped.subscriber_error++ }
    }
  } finally {
    fanningOut = false
  }
}
