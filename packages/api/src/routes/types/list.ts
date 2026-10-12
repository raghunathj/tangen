/**
 * File Name: list.ts
 * Purpose: Handles GET /api/v1/types and GET /api/v1/types/:name — returns the workspace
 *          schema's content-type definitions (fields, labels, singleton flag, admin config).
 *          GET /api/v1/types/health adds per-type drift (registry vs loaded Drizzle table vs
 *          information_schema) with the doctor / regenerate / push command that fixes it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia route handler; schema is injected via Elysia context by the
 *   workspace-schema middleware.
 */
import { Elysia } from 'elysia'
import type { SchemaDefinition, ComponentDef } from '@tangen/types'
import { resolveSchemaComponentRefs } from '@tangen/schema'
// Namespace import: test files mock this module with only `contentTables`, and a
// named import of the side-table registry would fail to link there.
import * as generatedTables from '@tangen/db/content-tables'
import { RequestError } from '../../lib/errors'
import { computeHealthDrift, findingOwner, HEALTH_COLUMNS_SQL } from '../../services/schema-drift'

/** Test hook: the Drizzle registries the health drift check reads (defaults to the loaded generated file). */
let healthTables: { content: Record<string, unknown>; i18n: Record<string, unknown> } | null = null
export function __setHealthTablesForTests(content?: Record<string, unknown>, i18n?: Record<string, unknown>): void {
  healthTables = content ? { content, i18n: i18n ?? {} } : null
}

/**
 * Expands reusable-component NAME refs (e.g. `components: ['heroBanner']`) into
 * full component defs so the admin block picker shows real labels + fields.
 * `getSchema` builds ctx.schema from the DB, which stores the raw refs; the
 * registry lives on the workspace project. Safe: on an unknown ref it returns
 * the raw types instead of throwing — a blank block beats a 500.
 */
export function resolveTypesComponents<T extends { fields: any[] }>(types: T[], registry: ComponentDef[]): T[] {
  try {
    return resolveSchemaComponentRefs(types, registry)
  } catch {
    return types
  }
}

/** Pull the component registry for the current workspace off the request ctx. */
function registryFor(ctx: any): ComponentDef[] {
  const project = (ctx.workspaceProjects as Array<{ workspaceId?: string; components?: ComponentDef[] }> | undefined)
    ?.find((p) => p.workspaceId === ctx.workspaceId)
  return (project?.components ?? []) as ComponentDef[]
}

/**
 * Maps a SchemaDefinition into the public type-list shape returned by the API.
 * @param schema - The workspace schema whose types should be serialised.
 * @returns An array of simplified type descriptors (id, name, label, singleton, admin, fields).
 */
export function formatTypesResponse(schema: SchemaDefinition) {
  return schema.types.map((t) => ({
    id: t.id,
    name: t.name,
    label: t.label,
    singleton: t.singleton ?? false,
    disabled: t.disabled === true,
    localized: (t as { localized?: boolean }).localized === true,
    /** The extension that provisioned this type, or null when the site's code declares it. */
    providedBy: (t as { providedBy?: string }).providedBy ?? null,
    admin: t.admin ?? {},
    fields: t.fields,
  }))
}

/** The last row of the per-environment push ledger, as the health route reports it. */
export interface LastPushInfo {
  status: 'running' | 'applied' | 'failed'
  startedAt: string
  finishedAt: string | null
  cliVersion: string | null
  gitSha: string | null
  error: string | null
  /** One line for a banner: "applied 2026-08-23T10:12:00.000Z by cli 0.1.99" / "FAILED ...: <error>". */
  summary: string
}

/** One line for a banner or a doctor, from a ledger row. */
export function describeLastPush(row: Omit<LastPushInfo, 'summary'>): string {
  const when = row.finishedAt ?? row.startedAt
  const by = row.cliVersion ? ` by cli ${row.cliVersion}` : ''
  if (row.status === 'applied') return `applied ${when}${by}`
  if (row.status === 'failed') return `FAILED ${when}${by}: ${row.error ?? 'unknown error'}`
  return `running since ${row.startedAt}${by}`
}

/**
 * Reads the most recent schema_pushes row for an environment through the raw
 * client. Null when there is none, or the ledger table is absent (a database
 * that predates it) - health never fails on the ledger.
 */
export async function readLastPushRecord(raw: { unsafe?: (q: string, params?: unknown[]) => Promise<unknown[]> } | null | undefined): Promise<LastPushInfo | null> {
  if (!raw?.unsafe) return null
  try {
    const rows = await raw.unsafe(
      `SELECT status, started_at, finished_at, cli_version, git_sha, error FROM schema_pushes ORDER BY started_at DESC LIMIT 1`,
    ) as Array<{ status: string; started_at: Date | string; finished_at: Date | string | null; cli_version: string | null; git_sha: string | null; error: string | null }>
    const r = rows?.[0]
    if (!r) return null
    const iso = (v: Date | string | null) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString())
    const row = {
      status: (r.status === 'applied' || r.status === 'failed' ? r.status : 'running') as LastPushInfo['status'],
      startedAt: iso(r.started_at) ?? new Date(0).toISOString(),
      finishedAt: iso(r.finished_at),
      cliVersion: r.cli_version ?? null,
      gitSha: r.git_sha ?? null,
      error: r.error ?? null,
    }
    return { ...row, summary: describeLastPush(row) }
  } catch {
    return null
  }
}

/**
 * Registers GET /api/v1/types and GET /api/v1/types/:name routes on the given Elysia app.
 * @param app - The Elysia application instance to attach the routes to.
 * @returns The Elysia app with both type-listing routes mounted.
 */
export const typesRoute = (app: Elysia) =>
  app
    .get('/api/v1/types', (ctx: any) => {
      const { schema } = ctx
      const types = resolveTypesComponents(schema.types, registryFor(ctx))
      return { data: formatTypesResponse({ types } as SchemaDefinition) }
    })
    // Health: a type registered in the schema whose content table is missing
    // means the last push didn't complete — the admin surfaces a warning
    // instead of letting editors discover it as a 404 in the editor.
    // (Registered before /:name so "health" isn't captured as a type name.)
    .get('/api/v1/types/health', async (ctx: any) => {
      const { schema, db, workspaceProjects, workspaceId } = ctx
      const raw = db?.$rawClient ?? db?.session?.client
      const data: Record<string, { tableExists: boolean; issues?: string[]; drift?: Array<{ code: string; severity: string; subject: string; cause: string; fix: string }> }> = {}
      for (const t of schema.types as { name: string }[]) {
        // Only identifier characters reach the quoted to_regclass string below.
        // Type names are camelCase (code-first) or snake_case, so uppercase must
        // pass, or their tables read as missing when they are really there.
        if (!/^[A-Za-z0-9_]+$/.test(t.name)) { data[t.name] = { tableExists: true }; continue }
        try {
          const rows = raw?.unsafe ? await raw.unsafe(`SELECT to_regclass('public."${t.name}"') AS t`) : null
          data[t.name] = { tableExists: Boolean(rows?.[0]?.t) }
        } catch {
          data[t.name] = { tableExists: true }   // uncertain - do not cry wolf
        }
      }
      // Dangling cross-type references (relation/object/taxonomy) — grouped per
      // owning type so the schema page can badge each one.
      const project = (workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === workspaceId)
      try {
        const { validateCrossReferences } = await import('@tangen/schema')
        const issues = validateCrossReferences(schema.types as never, (project?.components ?? []) as never)
        for (const issue of issues) {
          const owner = issue.at.split(/[ .(]/)[0]
          if (!data[owner]) continue
          const msg = `"${issue.reference}" (${issue.kind}) doesn't exist${issue.suggestion ? ` - did you mean "${issue.suggestion}"?` : ''}`
          ;(data[owner].issues ??= []).push(msg)
        }
      } catch { /* validator optional - never fail health */ }
      // Drift: the registry against the Drizzle tables this process loaded and
      // a one-query information_schema read - the in-process subset of
      // `tangen doctor`, memoised per schema fingerprint. A registry field the
      // generated file lacks means the API silently drops its writes; the
      // finding names the field and the command that fixes it.
      try {
        const tables = healthTables ?? { content: (generatedTables as { contentTables?: Record<string, unknown> }).contentTables ?? {}, i18n: (generatedTables as { contentI18nTables?: Record<string, unknown> }).contentI18nTables ?? {} }
        const queryColumns = raw?.unsafe
          ? async (names: string[]) => (await raw.unsafe(HEALTH_COLUMNS_SQL, [names])) as Array<Record<string, unknown>>
          : null
        const report = await computeHealthDrift({
          schema,
          contentTables: tables.content,
          contentI18nTables: tables.i18n,
          queryColumns,
          localizationEnabled: (project?.localization ?? project?.config?.localization)?.enabled === true,
          components: project?.components ?? [],
        })
        const typeNames = new Set(Object.keys(data))
        for (const f of report.findings) {
          if (f.severity === 'info') continue
          const owner = findingOwner(f.subject, typeNames)
          if (!owner) continue
          ;(data[owner].drift ??= []).push({ code: f.code, severity: f.severity, subject: f.subject, cause: f.cause, fix: f.fix })
          ;(data[owner].issues ??= []).push(`${f.subject}: ${f.cause} - run: ${f.fix}`)
        }
      } catch { /* drift is advisory - never fail health */ }
      // The last push recorded for this environment (the schema_pushes ledger):
      // "applied ... by cli x" or "FAILED: ..." - so the builder banner can say
      // whether the last push finished instead of guessing from a missing table.
      return { data, lastPush: await readLastPushRecord(raw) }
    })
    .get('/api/v1/types/:name', (ctx: any) => {
      const { schema, params } = ctx
      const typeDef = schema.types.find((t: any) => t.name === params.name)
      if (!typeDef) throw new RequestError('NOT_FOUND', `Type "${params.name}" not found`, 404)
      const [resolved] = resolveTypesComponents([typeDef], registryFor(ctx))
      return { data: formatTypesResponse({ types: [resolved] } as SchemaDefinition)[0] }
    })
