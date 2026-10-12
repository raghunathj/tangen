/**
 * File Name: k5-write-cost.ts
 * Purpose: The cost of the kernel's durable event record on the write path
 *          (tasks/plan-framework-kernel.md K5): N creates and N updates
 *          through the real handlers on the in-process PostgreSQL the test
 *          harness uses, and how many records landed, how many inside the
 *          transaction. A relative measurement: run it before and after a
 *          change to the write path, on the same machine.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Usage: bun run packages/api/bench/k5-write-cost.ts
 */
import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { permissionsForRole } from '@tangen/types'
import { createPgHarness } from '../src/__tests__/helpers/pg-harness'
import * as ct from '@tangen/db/content-tables'
import { makeCreateHandler } from '../src/routes/objects/create'
import { makeUpdateHandler } from '../src/routes/objects/update'
import { eventBus } from '../src/services/event-bus'
const TYPE = 'benchpost', WS = 'ws_bench'
const t = pgTable(TYPE, { id: text('id').notNull(), workspaceId: text('workspace_id').notNull(), title: text('title'), slug: text('slug'), status: text('status').notNull().default('draft'), publishedValues: jsonb('published_values'), body: text('body'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), createdBy: text('created_by'), updatedBy: text('updated_by'), createdByKind: text('created_by_kind'), updatedByKind: text('updated_by_kind'), publishedByKind: text('published_by_kind') })
const schema = { types: [{ id: 'oty_b', name: TYPE, label: 'B', singleton: false, fields: [{ name: 'body', label: 'Body', fieldType: 'text', config: {} }] }] } as never
const h = await createPgHarness()
await h.createContentTable(TYPE, `"body" TEXT`)
await h.sql(`CREATE TABLE IF NOT EXISTS _revisions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, type_id TEXT NOT NULL, type_name TEXT NOT NULL, object_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, version_type TEXT, snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT, locale TEXT)`)
await h.sql(`CREATE TABLE IF NOT EXISTS workspace_installed_apps (id TEXT, workspace_id TEXT NOT NULL, app_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'installed', enabled BOOLEAN NOT NULL DEFAULT true, version TEXT, options JSONB NOT NULL DEFAULT '{}')`)
await h.sql(`CREATE TABLE IF NOT EXISTS extension_data (id TEXT PRIMARY KEY, extension_id TEXT NOT NULL, object_id TEXT NOT NULL, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}', published_data JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
;(ct.contentTables as Record<string, unknown>)[TYPE] = t
const who = { memberId: 'mem_b', memberRole: 'editor', apiKeyId: null, permissions: permissionsForRole('editor') }
const base = () => ({ db: h.db, redis: null, eventBus, schema, workspaceId: WS, workspaceProjects: [{ workspaceId: WS }], set: { headers: {} }, request: new Request('http://localhost/x') })
const N = 200
const ids: string[] = []
let t0 = performance.now()
for (let i = 0; i < N; i++) { const r = await makeCreateHandler([])({ ...base(), ...who, body: { type: TYPE, title: `T${i}`, body: 'x' }, query: {}, params: {} } as never) as Response; ids.push((await r.json()).data.id) }
const createMs = (performance.now() - t0) / N
t0 = performance.now()
for (let i = 0; i < N; i++) await makeUpdateHandler([])({ ...base(), ...who, params: { id: ids[i] }, query: { type: TYPE }, body: { body: 'y' } } as never)
const updateMs = (performance.now() - t0) / N
const recs = await h.sql(`SELECT count(*)::int AS n, count(*) FILTER (WHERE recorded_in_transaction) ::int AS in_tx FROM audit_log`)
console.log(JSON.stringify({ N, createMs: +createMs.toFixed(2), updateMs: +updateMs.toFixed(2), records: recs[0] }))
await h.close()
