/**
 * File Name: globals-store.ts
 * Purpose: Implements a persistent key-value store for CMS global singleton data,
 *   backed by the Postgres `globals` table with upsert-based reads, patches, and overwrites.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm, @tangen/db (globals table), @tangen/types (GlobalsStore).
 */
import { randomBytes } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { globals } from '@tangen/db'
import type { GlobalsStore } from '@tangen/types'

/**
 * Shallow merge — patch values win; existing keys absent from patch are preserved.
 * @param existing - The current stored data object.
 * @param patch - Partial update whose keys override the existing values.
 * @returns A new merged object combining both inputs.
 */
export function mergeGlobalData(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...patch }
}

/**
 * Creates a GlobalsStore bound to a specific workspace and environment.
 * Exposes get, patch, and set methods that transparently handle DB upserts.
 * @param db - Drizzle database client instance.
 * @param workspaceId - Workspace scope for the globals data.
 * @returns A GlobalsStore implementation.
 */
export function createGlobalsStore(
  db: any,
  workspaceId: string,
): GlobalsStore {
  async function readRow(name: string) {
    const rows = await db
      .select({ id: globals.id, data: globals.data })
      .from(globals)
      .where(and(eq(globals.workspaceId, workspaceId), eq(globals.name, name)))
      .limit(1)
    return rows[0] ?? null
  }

  async function upsert(name: string, data: Record<string, unknown>) {
    const existing = await readRow(name)
    if (existing) {
      await db
        .update(globals)
        .set({ data, updatedAt: new Date() })
        .where(eq(globals.id, existing.id))
    } else {
      await db.insert(globals).values({
        id: randomBytes(12).toString('hex'),
        name,
        workspaceId,
        data,
        updatedAt: new Date(),
      })
    }
  }

  return {
    async get(name) {
      const row = await readRow(name)
      return (row?.data ?? {}) as Record<string, unknown>
    },

    async patch(name, data) {
      const row = await readRow(name)
      const merged = mergeGlobalData((row?.data as Record<string, unknown>) ?? {}, data)
      await upsert(name, merged)
    },

    async set(name, data) {
      await upsert(name, data)
    },
  }
}
