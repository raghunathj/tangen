/**
 * File Name: contract.ts
 * Purpose: What a telemetry event IS (closure plan Phase 9C, Units 2, 3, 4 and
 *          10): a bounded, redacted, allow-listed record that something
 *          happened - and nothing that could turn an operational tool into a
 *          content log or an analytics product.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Vendor-independent by construction. Nothing here knows
 *          about OpenTelemetry, Datadog or any exporter; an exporter is a
 *          SUBSCRIBER, and the internal model does not bend to accommodate one.
 */

/** The words, fixed, so they stop being used interchangeably (Unit 2). */
export const TELEMETRY_TERMS = {
  /** A bounded structured record that something happened. What this file defines. */
  event: 'event',
  /** An aggregated number - a counter or a duration histogram. Never a stored sample. */
  metric: 'metric',
  /** A timed operation carrying a correlation id. An event with a duration. */
  operation: 'operation',
  /** Diagnostic text through @tangen/logging. Not owned here. */
  log: 'log',
  /** Who changed what. `audit_log` and `workspace_activity`. NOT telemetry. */
  audit: 'audit',
} as const

/** How bad it is. Four levels; there is no `debug` because nothing would read it. */
export type TelemetrySeverity = 'info' | 'warn' | 'error'

/**
 * The taxonomy: `domain.subject.action`, and a closed list.
 *
 * Closed on purpose. An open string would become a permanent public analytics
 * schema by accident the first time somebody shipped a dashboard against it.
 */
export const TELEMETRY_EVENTS = [
  'http.request.completed',
  'db.query.completed',
  'cache.lookup.completed',
  'job.run.completed',
  'flow.execution.completed',
  'flow.node.retry_scheduled',
  'release.apply.completed',
  'extension.lifecycle.completed',
  'ai.request.completed',
  'mcp.tool.completed',
  'extension.http.completed',
  'telemetry.events.dropped',
] as const

export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number]

const EVENT_NAMES: ReadonlySet<string> = new Set(TELEMETRY_EVENTS)
export const isTelemetryEventName = (name: unknown): name is TelemetryEventName =>
  typeof name === 'string' && EVENT_NAMES.has(name)

/**
 * The attributes an event may carry, by event. An ALLOW-LIST, not a
 * blacklist: guessing every name a secret might travel under is a losing
 * game, and anything not named here is dropped without being examined.
 */
export const TELEMETRY_ATTRIBUTES: Record<TelemetryEventName, readonly string[]> = {
  'http.request.completed': ['method', 'route', 'statusClass', 'status', 'errorCode', 'policy'],
  'db.query.completed': ['type', 'operation', 'rows', 'total', 'depth', 'cache', 'statements', 'slow', 'errorCode'],
  'cache.lookup.completed': ['backend', 'result', 'scope'],
  'job.run.completed': ['taskId', 'result', 'attempts', 'errorCode'],
  'flow.execution.completed': ['flowId', 'executionId', 'nodeId', 'attempt', 'result', 'errorCode'],
  'flow.node.retry_scheduled': ['flowId', 'executionId', 'nodeId', 'attempt', 'errorCode'],
  'release.apply.completed': ['releaseId', 'result', 'items', 'errorCode'],
  'extension.lifecycle.completed': ['extensionId', 'operation', 'result', 'errorCode'],
  // Identity and outcome, never content. No prompt, no completion, no
  // embedding, no tool argument: those are the caller's data, and an
  // operational ring buffer is not where they belong.
  'ai.request.completed': ['provider', 'model', 'surface', 'result', 'errorCode'],
  'mcp.tool.completed': ['tool', 'result', 'errorCode'],
  // K1.4: an extension's outbound call - the host and outcome, never the URL's query or the body.
  'extension.http.completed': ['extensionId', 'host', 'method', 'status', 'result', 'errorCode'],
  'telemetry.events.dropped': ['reason', 'count'],
}

/** An attribute value: a scalar. No objects, no arrays, no nesting to bound. */
export type TelemetryAttributeValue = string | number | boolean

/**
 * One event. Every identity field is optional because not every event has one -
 * a job has no request, a request has no flow - and making them mandatory
 * would produce a lot of confidently empty strings.
 */
export interface TelemetryEvent {
  name: TelemetryEventName
  /** Epoch milliseconds. Set by the bus, not by the caller. */
  timestamp: number
  severity: TelemetrySeverity
  /** How long the operation took, when it was one. */
  durationMs?: number
  /** `ok` or `failed`. Deliberately two values: a status CLASS, not a code. */
  status?: 'ok' | 'failed'
  workspaceId?: string
  /** The Gateway's request id - the correlation spine that already exists. */
  requestId?: string
  /** A longer-lived correlation: a flow execution, a release, a job run. */
  operationId?: string
  attributes?: Record<string, TelemetryAttributeValue>
}

/** What a caller passes. The bus supplies the timestamp and enforces the rest. */
export type TelemetryEventInput = Omit<TelemetryEvent, 'timestamp'> & { timestamp?: number }

// ── Bounds ───────────────────────────────────────────────────────────────────

export const TELEMETRY_LIMITS = {
  /** Attribute strings past this are truncated, not dropped. */
  maxAttributeLength: 120,
  /** Attributes per event, after the allow-list. A guard, not a policy. */
  maxAttributes: 12,
  /** Identity strings (ids) past this are refused: an id that long is not one. */
  maxIdentityLength: 128,
  /** The serialized ceiling, checked once, so nothing unbounded is retained. */
  maxEventBytes: 2_048,
} as const
