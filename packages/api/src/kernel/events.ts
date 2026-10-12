/**
 * File Name: events.ts
 * Purpose: The kernel's event envelope and the durable event record (plan
 *          §10, §18, K5). A domain operation builds ONE envelope from its
 *          execution - actor (every kind), initiator, execution, correlation,
 *          resource, locale - writes it to `audit_log` inside its transaction
 *          where it has one, then emits it on the in-process bus for the
 *          derived consumers. The record is the fact; the bus is dispatch.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The legacy envelope fields (`actorId`, `actorType`,
 *          `source`) stay on every event so today's consumers keep reading
 *          them; the kernel fields are additive (`version: 2`). The bus
 *          subscriber that copied every event into audit_log skips events
 *          marked `recorded`, so nothing is written twice.
 */
import { randomUUID } from 'node:crypto'
import { auditLog } from '@tangen/db'
import type { ActorContext, ActorKind, ExecutionContext, TangenEvent } from '@tangen/types'
import { actorFromContext, isRecordedKind, type LegacyIdentityContext } from './actor'

/** Who is writing: the execution when the caller has one, else the decorations it still holds. */
export type Writer = LegacyIdentityContext & { exec?: ExecutionContext | null }

export interface DomainEventInput {
  type: string
  workspaceId: string
  resource: { kind: 'object' | 'media' | 'global' | 'table' | (string & {}); type: string | null; id: string }
  payload: Record<string, unknown>
  /** The locale a localized write targeted; omit for the base row. */
  locale?: string | null
  /** The client connection that issued the write (X-Tangen-Origin), advisory. */
  origin?: string | null
  /** The event or execution that caused this one, when the caller knows. */
  causationId?: string | null
}

export type RecordedEvent = TangenEvent & { recorded: true }

const LEGACY_SOURCES = new Set(['admin', 'rest', 'graphql', 'sdk'])

/** The attribution a row stores: the id when the actor has one, and always the kind. */
export function attributionOf(writer: Writer | null | undefined): { id: string | null; kind: ActorKind } {
  const actor = writer?.exec?.actor ?? actorFromContext(writer ?? null)
  if (!actor) return { id: null, kind: 'system' }
  const id = actor.identity.id || null
  return { id: isRecordedKind(actor.identity.kind) ? id : null, kind: actor.identity.kind }
}

/** One envelope for one mutation: the kernel fields from the execution, the legacy fields derived the way every writer derived them. */
export function buildEvent(input: DomainEventInput, writer: Writer | null | undefined): RecordedEvent {
  const exec = writer?.exec ?? null
  const actor: ActorContext | null = exec?.actor ?? actorFromContext(writer ?? null)
  const kind: ActorKind = actor?.identity.kind ?? 'system'
  const actorId = actor && isRecordedKind(kind) ? (actor.identity.id || null) : null
  const initiator = exec?.initiator ?? (actor?.onBehalfOf ?? null)
  const source = exec && LEGACY_SOURCES.has(exec.source) ? exec.source : (kind === 'member' ? 'admin' : 'rest')
  return {
    id: randomUUID(),
    type: input.type,
    workspaceId: input.workspaceId,
    timestamp: new Date().toISOString(),
    actorId,
    actorType: isRecordedKind(kind) ? kind : null,
    source: source as 'admin' | 'rest' | 'graphql' | 'sdk',
    ...(input.origin ? { origin: input.origin } : {}),
    version: 2,
    actor: { kind, id: actorId ?? (kind === 'system' ? (actor?.reason ?? null) : (actor?.identity.id ?? null)) },
    initiator: initiator ? { kind: initiator.kind, id: initiator.id } : null,
    execution: exec ? { kind: exec.kind, id: exec.id } : { kind: 'request', id: randomUUID() },
    correlationId: exec?.correlationId ?? undefined,
    causationId: input.causationId ?? exec?.causationId ?? null,
    resource: input.resource,
    locale: input.locale ?? null,
    payload: input.payload,
    recorded: true,
  } as unknown as RecordedEvent
}

/** Writes the durable record. Pass the transaction to make it part of the mutation. */
export async function recordEvent(db: any, event: RecordedEvent, opts: { inTransaction?: boolean } = {}): Promise<void> {
  const e = event as unknown as Record<string, any>
  await db.insert(auditLog).values({
    id: randomUUID(),
    workspaceId: e.workspaceId,
    eventType: e.type,
    eventId: e.id,
    actorId: e.actorId ?? null,
    actorType: e.actorType ?? null,
    payload: e.payload ?? {},
    actorKind: e.actor?.kind ?? null,
    initiatorId: e.initiator?.id ?? null,
    initiatorKind: e.initiator?.kind ?? null,
    executionKind: e.execution?.kind ?? null,
    executionId: e.execution?.id ?? null,
    correlationId: e.correlationId ?? e.execution?.id ?? null,
    causationId: e.causationId ?? null,
    resourceKind: e.resource?.kind ?? null,
    resourceType: e.resource?.type ?? null,
    resourceId: e.resource?.id ?? null,
    locale: e.locale ?? null,
    source: e.source ?? null,
    recordedInTransaction: opts.inTransaction === true,
  })
}

/** Record, then emit: the order every domain operation uses. */
export async function emitRecorded(
  bus: { emit(event: unknown): void },
  db: any,
  event: RecordedEvent,
  opts: { inTransaction?: boolean } = {},
): Promise<void> {
  await recordEvent(db, event, opts)
  bus.emit(event)
}
