/**
 * File Name: execution.ts
 * Purpose: One ExecutionContext per request or run (kernel plan §11): its
 *          own id, the one workspace, the one actor, the locale, the
 *          initiator when it differs, and the correlation that survives
 *          every asynchronous boundary. Built once at the edge and passed
 *          everywhere; nothing downstream resolves any of it again.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A request's id is the Gateway's request id when the
 *          Gateway is in the chain (the same value the client got in the
 *          response header), else a fresh one. `X-Tangen-Correlation` lets a
 *          caller chain executions; absent, the request is the head.
 */
import { randomUUID } from 'node:crypto'
import type { ActorContext, ActorIdentity, ExecutionContext, ExecutionKind, ExecutionSource, LocaleContext, LocalizationConfig } from '@tangen/types'
import { baseLocaleContext, resolveLocaleContext } from './locale'

export const CORRELATION_HEADER = 'X-Tangen-Correlation'

/**
 * The mark that says the kernel built this execution.
 *
 * NON-ENUMERABLE on purpose. Object spread copies symbol-keyed properties, so
 * an enumerable brand would survive an extension doing
 * `{ ...myExec, actor: { ...authority, admin: true } }` - which is exactly the
 * escalation it exists to stop. A spread copy loses it and is refused.
 *
 * Module-private: nothing outside this file can apply it, so an execution can
 * only come from `createExecution` (and therefore from `requestExecution`,
 * `dispatchExecution` and `executionForRun`, which all route through it).
 */
const KERNEL_MINTED = Symbol('tangen.kernel.execution')

/** Whether the kernel minted this execution, rather than a caller assembling one. */
export function isKernelExecution(exec: unknown): boolean {
  return typeof exec === 'object' && exec !== null
    && (exec as Record<symbol, unknown>)[KERNEL_MINTED] === true
}

/** Refuses an execution the kernel did not mint, naming why. */
export function assertKernelExecution(exec: unknown): void {
  if (!isKernelExecution(exec)) {
    throw new Error(
      'This execution was not minted by the kernel. Build one with createExecution, '
      + 'or for work on another principal\'s behalf use ctx.resolveActor, which returns one.',
    )
  }
}

export function createExecution(input: {
  id?: string
  kind: ExecutionKind
  source: ExecutionSource
  workspaceId: string
  actor: ActorContext
  locale?: LocaleContext
  initiator?: ActorIdentity | null
  correlationId?: string | null
  causationId?: string | null
  startedAt?: string
}): ExecutionContext {
  if (!input.actor) throw new Error('An execution needs an actor')
  if (!input.workspaceId) throw new Error('An execution needs a workspace')
  const id = input.id ?? randomUUID()
  const exec: ExecutionContext = {
    id,
    kind: input.kind,
    workspaceId: input.workspaceId,
    actor: input.actor,
    initiator: input.initiator ?? null,
    correlationId: input.correlationId ?? id,
    causationId: input.causationId ?? null,
    locale: input.locale ?? baseLocaleContext(null),
    source: input.source,
    startedAt: input.startedAt ?? new Date().toISOString(),
  }
  Object.defineProperty(exec, KERNEL_MINTED, { value: true, enumerable: false, writable: false, configurable: false })
  return exec
}

/** The execution for one HTTP request: id from the Gateway, correlation from the header, locale from `?locale=`. */
export function requestExecution(input: {
  request: Request
  requestId?: string | null
  workspaceId: string
  actor: ActorContext
  localization: LocalizationConfig | null | undefined
  source: ExecutionSource
  initiator?: ActorIdentity | null
}): ExecutionContext {
  const url = new URL(input.request.url)
  const correlation = input.request.headers.get(CORRELATION_HEADER)?.trim() || null
  return createExecution({
    id: input.requestId ?? undefined,
    kind: 'request',
    source: input.source,
    workspaceId: input.workspaceId,
    actor: input.actor,
    initiator: input.initiator ?? null,
    correlationId: correlation,
    locale: resolveLocaleContext({ requested: url.searchParams.get('locale'), localization: input.localization, actor: input.actor }),
  })
}
