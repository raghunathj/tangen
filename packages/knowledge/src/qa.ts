/**
 * File Name: qa.ts
 * Purpose: Curated Q&A pairs — the admin-managed knowledge-base layer.
 *          Plain-table CRUD over the injected executor (no pgvector needed
 *          to MANAGE pairs; embedding rides the host's queue via syncQa).
 *          Pairs carry their own retrieval audience and an enabled switch;
 *          disabling removes the chunks without losing the curation work.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The table is declared and migrated by @tangen/db (0041) — the
 *          knowledge package owns its tables (optional install, no drizzle
 *          migration). Timestamps as ISO strings (postgres.js unsafe()
 *          rejects Date params).
 */
import type { SqlExec } from './store'

export interface KnowledgeQaRow {
  id: string
  workspaceId: string
  question: string
  answer: string
  audience: 'public' | 'internal'
  enabled: boolean
  updatedBy: string | null
  createdAt?: string
  updatedAt?: string
}

export interface QaUpsert {
  id?: string
  workspaceId: string
  question: string
  answer: string
  audience?: 'public' | 'internal'
  enabled?: boolean
  updatedBy?: string | null
}

const newId = () => `qa_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`

function mapRow(r: Record<string, unknown>): KnowledgeQaRow {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id ?? r.workspaceId ?? ''),
    question: String(r.question),
    answer: String(r.answer),
    audience: (r.audience === 'internal' ? 'internal' : 'public'),
    enabled: r.enabled !== false,
    updatedBy: r.updated_by != null ? String(r.updated_by) : null,
    createdAt: r.created_at != null ? String(r.created_at) : undefined,
    updatedAt: r.updated_at != null ? String(r.updated_at) : undefined,
  }
}

export function createQaStore(exec: SqlExec) {
  return {
    /** Paged, searchable list — total rides each row (window count). */
    async list(workspaceId: string, opts: { q?: string; limit?: number; offset?: number } = {}):
      Promise<{ rows: KnowledgeQaRow[]; total: number }> {
      const params: unknown[] = [workspaceId]
      let where = `workspace_id = $1`
      if (opts.q?.trim()) {
        params.push(`%${opts.q.trim()}%`)
        where += ` AND (question ILIKE $${params.length} OR answer ILIKE $${params.length})`
      }
      params.push(Math.min(opts.limit ?? 50, 200))
      const limitIdx = params.length
      params.push(Math.max(opts.offset ?? 0, 0))
      const rows = await exec(
        `SELECT *, count(*) OVER()::int AS total FROM knowledge_qa
          WHERE ${where}
          ORDER BY updated_at DESC
          LIMIT $${limitIdx} OFFSET $${params.length}`,
        params,
      )
      return { rows: rows.map(mapRow), total: rows.length ? Number(rows[0].total) : 0 }
    },

    async get(workspaceId: string, id: string): Promise<KnowledgeQaRow | undefined> {
      const rows = await exec(
        `SELECT * FROM knowledge_qa WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
        [workspaceId, id],
      )
      return rows[0] ? mapRow(rows[0]) : undefined
    },

    /** Create-or-update (id generated when absent). Returns the saved row. */
    async upsert(input: QaUpsert): Promise<KnowledgeQaRow> {
      const row: KnowledgeQaRow = {
        id: input.id ?? newId(),
        workspaceId: input.workspaceId,
        question: input.question,
        answer: input.answer,
        audience: input.audience ?? 'public',
        enabled: input.enabled ?? true,
        updatedBy: input.updatedBy ?? null,
      }
      await exec(
        `INSERT INTO knowledge_qa (id, workspace_id, question, answer, audience, enabled, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (id)
         DO UPDATE SET question = $4, answer = $5, audience = $6, enabled = $7, updated_by = $8, updated_at = now()`,
        [row.id, row.workspaceId, row.question, row.answer, row.audience, row.enabled, row.updatedBy],
      )
      return row
    },

    async remove(workspaceId: string, id: string): Promise<void> {
      await exec(
        `DELETE FROM knowledge_qa WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, id],
      )
    },
  }
}

export type QaStore = ReturnType<typeof createQaStore>
