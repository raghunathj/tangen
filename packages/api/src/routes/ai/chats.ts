/**
 * File Name: chats.ts
 * Purpose: /api/v1/admin/ai/chats — Gen AI conversation threads. A member keeps
 *          several private threads per content object: list (with derived
 *          titles), read, upsert, and delete. Threads are capped per scope,
 *          messages shape-checked and capped, and history lazily expires after
 *          30 days.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Member JWT required. Every statement is member-scoped —
 *          thread ids are client-minted (`cht_…`), so ownership, not the id,
 *          is the privacy boundary. History is advisory UI state — it is never
 *          fed back to providers verbatim (the panel sends brief recaps).
 */
import { Elysia, t } from 'elysia'
import { eq, and, inArray } from 'drizzle-orm'
import { aiChats } from '@tangen/db'
import { RequestError } from '../../lib/errors'

export const MAX_CHAT_MESSAGES = 50
export const CHAT_RETENTION_DAYS = 30
export const MAX_THREADS_PER_SCOPE = 10

/** True when a stored conversation is past the retention window. */
export function isChatExpired(updatedAt: Date | string | null | undefined, now = new Date()): boolean {
  if (!updatedAt) return false
  const age = now.getTime() - new Date(updatedAt).getTime()
  return age > CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000
}

const ROLES = new Set(['user', 'assistant', 'assistant-fill', 'error'])

/**
 * Keeps only well-shaped messages with known roles, capped to the most
 * recent MAX_CHAT_MESSAGES.
 */
export function sanitizeChatMessages(messages: unknown): Record<string, unknown>[] {
  if (!Array.isArray(messages)) return []
  const valid = messages.filter(
    (m): m is Record<string, unknown> =>
      !!m && typeof m === 'object' && !Array.isArray(m) && ROLES.has(String((m as any).role)),
  )
  return valid.slice(-MAX_CHAT_MESSAGES)
}

// ─── Thread helpers (pure) ────────────────────────────────────────────────────

const TITLE_MAX = 60

/**
 * Derives a thread label from the first user message — the panel prefixes
 * field-tagged briefs with `@Label: `, which is noise in a list.
 * @returns The trimmed label, or null when no user message exists yet.
 */
export function deriveChatTitle(messages: unknown[]): string | null {
  const first = (messages ?? []).find(
    (m: any) => m && m.role === 'user' && typeof m.text === 'string' && m.text.trim(),
  ) as { text: string } | undefined
  if (!first) return null
  const text = first.text.replace(/^@[^:]{1,80}:\s*/, '').trim()
  if (!text) return null
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text
}

interface ThreadRowLike { id: string; updatedAt: Date | string | null }

/** Splits scope rows into live threads and expired ones (to be deleted). */
export function partitionExpired<R extends ThreadRowLike>(rows: R[], now = new Date()): { live: R[]; expired: R[] } {
  const live: R[] = []
  const expired: R[] = []
  for (const row of rows) (isChatExpired(row.updatedAt, now) ? expired : live).push(row)
  return { live, expired }
}

/** Ids of the oldest threads beyond the per-scope cap. */
export function threadIdsToPrune(rows: ThreadRowLike[], max: number): string[] {
  if (rows.length <= max) return []
  return [...rows]
    .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
    .slice(max)
    .map((r) => r.id)
}

interface ThreadScope { workspaceId: string; objectType: string; objectId: string }

/**
 * Access decision for a thread id: 'create' (id unclaimed), 'owned' (the
 * caller's thread in this scope), or 'denied' (someone else's thread, or the
 * caller's thread addressed through the wrong object).
 */
export function threadAccess(
  row: (ThreadScope & { memberId: string }) | null,
  memberId: string,
  scope: ThreadScope,
): 'create' | 'owned' | 'denied' {
  if (!row) return 'create'
  if (row.memberId !== memberId) return 'denied'
  const sameScope =
    row.workspaceId === scope.workspaceId &&
    row.objectType === scope.objectType &&
    row.objectId === scope.objectId
  return sameScope ? 'owned' : 'denied'
}

// ─── Routes ───────────────────────────────────────────────────────────────────

function requireMember(memberId: string | undefined): asserts memberId is string {
  if (!memberId) throw new RequestError('FORBIDDEN', 'AI chats are admin-panel only', 403)
}

function scopeWhere(scope: ThreadScope, memberId: string) {
  return and(
    eq(aiChats.workspaceId, scope.workspaceId),
    eq(aiChats.objectType, scope.objectType),
    eq(aiChats.objectId, scope.objectId),
    eq(aiChats.memberId, memberId),
  )
}

/**
 * Registers the Gen AI thread endpoints. Mounted after authMiddleware.
 */
export const aiChatsRoute = (app: Elysia) =>
  app
    // Thread list for the picker — newest first, expired rows swept lazily.
    .get('/api/v1/admin/ai/chats/:typeName/:objectId', async (ctx: any) => {
      const { db, workspaceId, memberId, params } = ctx
      requireMember(memberId)
      const scope = { workspaceId, objectType: params.typeName, objectId: params.objectId }
      const rows = await db.select().from(aiChats).where(scopeWhere(scope, memberId))
      const { live, expired } = partitionExpired(rows as any[])
      if (expired.length > 0) {
        await db.delete(aiChats).where(inArray(aiChats.id, expired.map((r: any) => r.id))).catch(() => {})
      }
      const chats = live
        .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .map((r: any) => ({
          id: r.id,
          // legacy rows predate the title column — derive a label on the fly
          title: r.title ?? deriveChatTitle(r.messages as unknown[]) ?? 'New chat',
          updatedAt: r.updatedAt,
        }))
      return { data: { chats } }
    })
    // One thread's messages.
    .get('/api/v1/admin/ai/chats/:typeName/:objectId/:chatId', async (ctx: any) => {
      const { db, workspaceId, memberId, params } = ctx
      requireMember(memberId)
      const scope = { workspaceId, objectType: params.typeName, objectId: params.objectId }
      const rows = await db.select().from(aiChats).where(eq(aiChats.id, params.chatId)).limit(1)
      const row = (rows as any[])[0] ?? null
      if (threadAccess(row, memberId, scope) !== 'owned') {
        // unknown and foreign ids look identical — no existence leak
        throw new RequestError('NOT_FOUND', 'Chat not found', 404)
      }
      if (isChatExpired(row.updatedAt)) {
        await db.delete(aiChats).where(eq(aiChats.id, row.id)).catch(() => {})
        return { data: { messages: [] } }
      }
      return { data: { messages: (row.messages as unknown[]) ?? [] } }
    })
    // Delete one thread — single member-guarded statement.
    .delete('/api/v1/admin/ai/chats/:typeName/:objectId/:chatId', async (ctx: any) => {
      const { db, workspaceId, memberId, params } = ctx
      requireMember(memberId)
      await db.delete(aiChats).where(and(eq(aiChats.id, params.chatId), eq(aiChats.memberId, memberId)))
      return { data: { cleared: true } }
    })
    // Upsert one thread; derives the title once and prunes beyond the cap.
    .put('/api/v1/admin/ai/chats/:typeName/:objectId/:chatId', async (ctx: any) => {
      const { db, workspaceId, memberId, params, body } = ctx
      requireMember(memberId)
      const scope = { workspaceId, objectType: params.typeName, objectId: params.objectId }
      const messages = sanitizeChatMessages((body as any)?.messages)

      const rows = await db.select().from(aiChats).where(eq(aiChats.id, params.chatId)).limit(1)
      const existing = (rows as any[])[0] ?? null
      const access = threadAccess(existing, memberId, scope)
      if (access === 'denied') throw new RequestError('NOT_FOUND', 'Chat not found', 404)

      const title = (existing?.title as string | null) ?? deriveChatTitle(messages)
      if (access === 'create') {
        await db.insert(aiChats).values({
          id: params.chatId,
          workspaceId,
          objectType: params.typeName,
          objectId: params.objectId,
          memberId,
          title,
          messages,
          updatedAt: new Date(),
        })
      } else {
        await db
          .update(aiChats)
          .set({ messages, title, updatedAt: new Date() })
          .where(and(eq(aiChats.id, params.chatId), eq(aiChats.memberId, memberId)))
      }

      const scopeRows = await db
        .select({ id: aiChats.id, updatedAt: aiChats.updatedAt })
        .from(aiChats)
        .where(scopeWhere(scope, memberId))
      const prune = threadIdsToPrune(scopeRows as any[], MAX_THREADS_PER_SCOPE)
      if (prune.length > 0) {
        await db.delete(aiChats).where(inArray(aiChats.id, prune)).catch(() => {})
      }

      return { data: { id: params.chatId, title, messages } }
    }, { body: t.Object({ messages: t.Array(t.Any()) }) })
