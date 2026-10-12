/**
 * File Name: unsafe-storage.ts
 * Purpose: The storage half of the local client, named for what it is
 *          (kernel plan §13): a client with Tangen's own authority and no
 *          policy between it and the tables. Its callers are the framework's
 *          privileged paths (Porter import, CLI push, maintenance) and the
 *          domain operations; application code gets a ContentClient bound
 *          to an execution instead, and never finds this on a context.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: INTERNAL. Not exported from any package entry (the
 *          public-surface snapshot pins that) and not importable from an
 *          extension (framework-boundary.test.ts pins that). Obtaining
 *          superuser mutation is an explicit `systemExecution(reason)` that
 *          is attributed on every row and event it touches.
 */
import type { ExecutionContext, ExecutionKind, ExecutionSource, TangenLocalClient } from '@tangen/types'
import { createLocalClient, type LocalClientOptions } from '../services/local-client'
import { createExecution } from '../kernel/execution'
import { systemActor } from '../kernel/actor'

/** Tangen's own authority, for one workspace and one stated reason - attributed, never implicit. */
export function systemExecution(input: { workspaceId: string; reason: string; kind?: ExecutionKind; source?: ExecutionSource; correlationId?: string | null }): ExecutionContext {
  return createExecution({
    kind: input.kind ?? 'cli', source: input.source ?? 'cli', workspaceId: input.workspaceId,
    actor: systemActor({ workspaceId: input.workspaceId, reason: input.reason }),
    correlationId: input.correlationId ?? null,
  })
}

/** The unsafe storage client: writes with the framework's authority under an explicit system execution. */
export function createUnsafeStorage(options: Omit<LocalClientOptions, 'exec'>, exec: ExecutionContext): TangenLocalClient {
  if (exec.actor.identity.kind !== 'system') throw new Error('Unsafe storage runs under a system execution only; bind a ContentClient to any other actor')
  return createLocalClient({ ...options, exec })
}

/** A ContentClient: the same builder, bound to the execution whose authority and attribution every read and write carries. */
export function contentClientFor(exec: ExecutionContext, options: Omit<LocalClientOptions, 'exec'>): TangenLocalClient {
  return createLocalClient({ ...options, exec })
}
