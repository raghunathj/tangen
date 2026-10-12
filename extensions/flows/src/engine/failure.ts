/**
 * File Name: failure.ts
 * Purpose: What a Flow failure IS (closure plan Phase 9B, Units 8, 13 and 27):
 *          a stable code, a bounded and redacted message, and a retryability
 *          the failing thing DECLARED rather than one this file guessed.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. The rule: retryability is never inferred from a
 *          message. A message that happens to contain "timeout" is still
 *          UNKNOWN, and unknown is not retried - retrying a failure nobody
 *          classified is how a non-idempotent action gets run twice.
 */

/** Three answers, and only three. */
export type Retryability = 'retryable' | 'non_retryable' | 'unknown'

/** Everything stored about a failure. No stack, no provider internals. */
export interface FlowFailure {
  code: string
  message: string
  retryable: Retryability
  nodeId?: string
  attempt?: number
}

/** Bounded: an execution history is not a place to put a provider's essay. */
export const MAX_MESSAGE_LENGTH = 500

/**
 * The error an action throws when it knows what went wrong. Everything else
 * that reaches the classifier is UNKNOWN by definition, which is the safe
 * answer rather than a convenient one.
 */
export class FlowActionError extends Error {
  readonly code: string
  readonly retryable: Retryability
  /** Diagnostic payload for the log sink. NEVER stored in run history. */
  readonly detail?: unknown

  constructor(code: string, message: string, opts: { retryable: Retryability; detail?: unknown }) {
    super(message)
    this.name = 'FlowActionError'
    this.code = code
    this.retryable = opts.retryable
    this.detail = opts.detail
  }
}

/** The codes the shipped actions use. An extension may declare its own. */
export const FLOW_ERROR_CODES = {
  /** The action's configuration cannot work, and will not work next time. */
  CONFIG_INVALID: 'FLOW_CONFIG_INVALID',
  /** Something the action needs is not part of this runtime. */
  DEPENDENCY_MISSING: 'FLOW_DEPENDENCY_MISSING',
  /** The target refused on policy grounds (private host, permission). */
  REFUSED: 'FLOW_REFUSED',
  /** The transport failed before any response. */
  NETWORK: 'FLOW_NETWORK',
  /** A response arrived and its status decides. */
  HTTP_STATUS: 'FLOW_HTTP_STATUS',
  /** The action exceeded its own time budget. */
  TIMEOUT: 'FLOW_TIMEOUT',
  /** The action the node names is not registered here. */
  ACTION_MISSING: 'FLOW_ACTION_MISSING',
  /** Nobody classified it. */
  UNKNOWN: 'FLOW_UNKNOWN',
} as const

/**
 * Which HTTP statuses mean "the same request may succeed later".
 *
 * 408 request timeout, 425 too early, 429 rate limited, and the 5xx that are
 * about the server being unwell. 501 is excluded: a server that does not
 * implement the method will not implement it in thirty seconds either.
 */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

export function classifyHttpStatus(status: number): Retryability {
  return RETRYABLE_STATUSES.has(status) ? 'retryable' : 'non_retryable'
}

/** Only a declared 'retryable' is retried. Unknown is not a maybe. */
export function isRetryable(failure: FlowFailure): boolean {
  return failure.retryable === 'retryable'
}

const REDACTIONS: Array<[RegExp, string]> = [
  // Authorization headers, in any of the shapes an error message quotes them.
  [/\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/\b(authorization)\s*[:=]\s*\S+/gi, '$1: [redacted]'],
  // Anything named like a credential in a query string or an object dump.
  [/\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret)\s*[=:]\s*"?[A-Za-z0-9._~+/=-]{6,}"?/gi, '$1=[redacted]'],
  // A long opaque run of credential-shaped characters, prefixed or not.
  [/\b[A-Za-z0-9_]{2,8}_[A-Za-z0-9]{16,}\b/g, '[redacted]'],
  [/\b[A-Fa-f0-9]{32,}\b/g, '[redacted]'],
]

/** A message fit to store: redacted first, then bounded. */
export function safeMessage(raw: unknown): string {
  let text = typeof raw === 'string' ? raw : String((raw as { message?: unknown } | null)?.message ?? raw ?? '')
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement)
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text
}

/**
 * Turns whatever was thrown into the record a run keeps.
 *
 * An error that did not declare itself is `unknown`, never a guess. That is
 * the conservative direction: an unknown failure is not retried, so an action
 * nobody classified cannot be run a second time by this system's decision.
 */
export function classifyFailure(thrown: unknown, at?: { nodeId?: string; attempt?: number }): FlowFailure {
  const typed = thrown instanceof FlowActionError
  const failure: FlowFailure = {
    code: typed ? thrown.code : FLOW_ERROR_CODES.UNKNOWN,
    message: safeMessage(thrown instanceof Error ? thrown.message : thrown),
    retryable: typed ? thrown.retryable : 'unknown',
  }
  if (at?.nodeId !== undefined) failure.nodeId = at.nodeId
  if (at?.attempt !== undefined) failure.attempt = at.attempt
  return failure
}
