/**
 * File Name: connections.ts
 * Purpose: The connections store (Extension Kernel K6.1,
 *          tasks/plan-extension-kernel.md): an operator's credentials for a
 *          connector, per workspace, sealed at rest. `list` never returns
 *          material; `open` does, for the kernel's authed client only. Rows
 *          are attributed to who created them and carry the connector id as
 *          `ext:<extension>/<connector>` so a connector renamed or removed is
 *          still diagnosable.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { randomUUID } from 'node:crypto'
import { sealSecret, openSecret, type SealedKey } from '../lib/sealed'

type SqlExec = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>

export type ConnectionKind = 'oauth2' | 'apiKey' | 'basic'
/** `pending`: an OAuth flow core started and the provider has not answered yet; never usable, never listed to extensions. */
export type ConnectionStatus = 'active' | 'pending' | 'revoked' | 'unreadable'

/** What a list shows: never the material. */
export interface ConnectionSummary {
  id: string
  workspaceId: string
  connectorId: string
  label: string
  kind: ConnectionKind
  status: ConnectionStatus
  meta: Record<string, unknown>
  health: { ok: boolean; checkedAt: string; message?: string } | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** A summary plus the material, for the kernel only. */
export interface OpenedConnection extends ConnectionSummary {
  credentials: Record<string, unknown>
}

export interface ConnectionsStore {
  list(filter?: { connectorId?: string }): Promise<ConnectionSummary[]>
  open(id: string): Promise<OpenedConnection | null>
  create(input: { connectorId: string; label: string; kind: ConnectionKind; credentials: Record<string, unknown>; meta?: Record<string, unknown>; status?: ConnectionStatus; createdBy?: string | null }): Promise<ConnectionSummary>
  update(id: string, patch: { label?: string; credentials?: Record<string, unknown>; meta?: Record<string, unknown>; status?: ConnectionStatus; health?: ConnectionSummary['health'] }): Promise<void>
  remove(id: string): Promise<void>
}

const COLS = 'id, workspace_id, connector_id, label, kind, status, meta, health, created_by, created_at, updated_at'

function summaryOf(r: Record<string, unknown>): ConnectionSummary {
  const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
  return {
    id: String(r.id), workspaceId: String(r.workspace_id), connectorId: String(r.connector_id), label: String(r.label),
    kind: r.kind as ConnectionKind, status: (r.status as ConnectionStatus) ?? 'active',
    meta: (json(r.meta) as Record<string, unknown>) ?? {}, health: (json(r.health) as ConnectionSummary['health']) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: String(r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at),
    updatedAt: String(r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at),
  }
}

export function createConnectionsStore(exec: SqlExec, scope: { workspaceId: string; key: SealedKey }): ConnectionsStore {
  const { workspaceId, key } = scope
  return {
    async list(filter) {
      const rows = filter?.connectorId
        ? await exec(`SELECT ${COLS} FROM connections WHERE workspace_id = $1 AND connector_id = $2 ORDER BY created_at`, [workspaceId, filter.connectorId])
        : await exec(`SELECT ${COLS} FROM connections WHERE workspace_id = $1 ORDER BY created_at`, [workspaceId])
      return rows.map(summaryOf)
    },
    async open(id) {
      const rows = await exec(`SELECT ${COLS}, secret FROM connections WHERE workspace_id = $1 AND id = $2 LIMIT 1`, [workspaceId, id])
      if (!rows[0]) return null
      const summary = summaryOf(rows[0])
      try {
        return { ...summary, credentials: openSecret<Record<string, unknown>>(key, String(rows[0].secret)) }
      } catch {
        // The deployment's key changed: the row is intact, its material is not readable here.
        return { ...summary, status: 'unreadable', credentials: {} }
      }
    },
    async create(input) {
      const id = `conn_${randomUUID().replace(/-/g, '').slice(0, 20)}`
      await exec(
        `INSERT INTO connections (id, workspace_id, connector_id, label, kind, secret, meta, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [id, workspaceId, input.connectorId, input.label, input.kind, sealSecret(key, input.credentials), JSON.stringify(input.meta ?? {}), input.status ?? 'active', input.createdBy ?? null],
      )
      return (await this.list()).find((c) => c.id === id)!
    },
    async update(id, patch) {
      const sets: string[] = []
      const params: unknown[] = [workspaceId, id]
      const set = (col: string, value: unknown, cast = '') => { params.push(value); sets.push(`${col} = $${params.length}${cast}`) }
      if (patch.label !== undefined) set('label', patch.label)
      if (patch.credentials !== undefined) set('secret', sealSecret(key, patch.credentials))
      if (patch.meta !== undefined) set('meta', JSON.stringify(patch.meta), '::jsonb')
      if (patch.status !== undefined) set('status', patch.status)
      if (patch.health !== undefined) { set('health', patch.health ? JSON.stringify(patch.health) : null, '::jsonb'); sets.push('last_checked_at = now()') }
      if (sets.length === 0) return
      sets.push('updated_at = now()')
      await exec(`UPDATE connections SET ${sets.join(', ')} WHERE workspace_id = $1 AND id = $2`, params)
    },
    async remove(id) {
      await exec(`DELETE FROM connections WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])
    },
  }
}
