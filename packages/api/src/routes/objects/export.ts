/**
 * File Name: export.ts
 * Purpose: Handles POST /api/v1/objects/export — streams a filtered set of content objects
 *          as an RFC-4180 CSV file, expanding relation and media fields into readable columns.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia route handler; requires @tangen/types flattenFields; relation
 *   and media expansion is done in-process via batch DB queries.
 */
import { eq, and, inArray } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { mediaAssets } from '@tangen/db'
import { contentTables } from '@tangen/db/content-tables'
import type { SchemaDefinition, FieldDefinition } from '@tangen/types'
import { flattenFields } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { assertObjectPermission } from '../../lib/permissions'
import { fieldAccessContext, restrictedReadFields } from '../../lib/field-access'
import { tiptapToText } from '../../services/richtext-serializer'

// ── Column descriptor ─────────────────────────────────────────────────────────

export interface ExportColumnDef {
  /** One or more CSV header names this column expands to. */
  headers: string[]
  /** Extracts one string per header from the (already-expanded) row value. */
  extract: (value: unknown) => string[]
}

// ── buildColumnDefs ───────────────────────────────────────────────────────────

function str(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

/**
 * Returns the CSV column definition(s) for one FieldDefinition.
 * Complex types expand to multiple columns; flat types map 1:1.
 */
export function buildColumnDefs(field: FieldDefinition): ExportColumnDef {
  const n = field.name

  switch (field.fieldType) {
    case 'richtext':
      return {
        headers: [`${n}_text`],
        extract: v => [tiptapToText(v)],
      }

    case 'media':
      return {
        headers: [`${n}_id`, `${n}_url`],
        extract: v => {
          if (!v || typeof v !== 'object') return ['', '']
          const m = v as Record<string, unknown>
          return [str(m.id), str(m.storagePath)]
        },
      }

    case 'relation': {
      const many = !!(field.config as Record<string, unknown>).many
      if (many) {
        return {
          headers: [`${n}_ids`, `${n}_titles`, `${n}_slugs`],
          extract: v => {
            const arr = Array.isArray(v) ? v : []
            const items = arr.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
            if (items.length === 0) return ['', '', '']
            return [
              items.map(x => str(x.id)).join('|'),
              items.map(x => str(x.title)).join('|'),
              items.map(x => str(x.slug)).join('|'),
            ]
          },
        }
      }
      return {
        headers: [`${n}_id`, `${n}_title`, `${n}_slug`],
        extract: v => {
          if (!v || typeof v !== 'object') return ['', '', '']
          const m = v as Record<string, unknown>
          return [str(m.id), str(m.title), str(m.slug)]
        },
      }
    }

    case 'multiselect':
      return {
        headers: [n],
        extract: v => {
          const arr = Array.isArray(v) ? v : []
          return [arr.length ? arr.map(str).join('|') : '']
        },
      }

    case 'repeater':
    case 'component':
    case 'group':
    case 'section':
      return {
        headers: [`${n}_json`],
        extract: v => [v == null ? '' : JSON.stringify(v)],
      }

    default:
      // flat types: text, textarea, email, url, phone, number, date, boolean, select, object
      return {
        headers: [n],
        extract: v => [str(v)],
      }
  }
}

// ── System columns ────────────────────────────────────────────────────────────

function sysCol(header: string, key: string): ExportColumnDef {
  return {
    headers: [header],
    extract: v => [str((v as Record<string, unknown>)?.[key] ?? v)],
  }
}

/** Always-present columns that lead every export, regardless of field selection. */
/**
 * The type's configured CSV field list (`admin.export.fields`). K0: this read
 * used to look at `adminConfig`, a key no schema has carried, so the
 * configuration was dead and every export fell back to all fields.
 */
export function configuredExportFields(typeDef: { admin?: { export?: { fields?: string[] } } } | null | undefined): string[] | undefined {
  const fields = typeDef?.admin?.export?.fields
  return Array.isArray(fields) ? fields.filter((f): f is string => typeof f === 'string') : undefined
}

export const SYSTEM_EXPORT_COLUMNS: ExportColumnDef[] = [
  { headers: ['id'],           extract: row => [str((row as Record<string,unknown>).id)] },
  { headers: ['title'],        extract: row => [str((row as Record<string,unknown>).title)] },
  { headers: ['slug'],         extract: row => [str((row as Record<string,unknown>).slug)] },
  { headers: ['status'],       extract: row => [str((row as Record<string,unknown>).status)] },
  { headers: ['created_at'],   extract: row => [str((row as Record<string,unknown>).createdAt ?? (row as Record<string,unknown>).created_at)] },
  { headers: ['updated_at'],   extract: row => [str((row as Record<string,unknown>).updatedAt ?? (row as Record<string,unknown>).updated_at)] },
  { headers: ['published_at'], extract: row => [str((row as Record<string,unknown>).publishedAt ?? (row as Record<string,unknown>).published_at)] },
]

// ── toCsv ────────────────────────────────────────────────────────────────────

function csvCell(val: string): string {
  if (val.includes('"') || val.includes(',') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

/** Converts headers + string rows into RFC-4180 CSV text. */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

// ── Relation expansion for export ─────────────────────────────────────────────

interface RelationExpand {
  fieldName: string
  many: boolean
  targetType: string
}

async function expandRelationsForExport(
  rows:     Record<string, unknown>[],
  fields:   RelationExpand[],
  db:       any,
  wsId:     string,
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0 || fields.length === 0) return rows

  const resolved = new Map<string, Map<string, Record<string, unknown>>>()

  for (const { fieldName, many, targetType } of fields) {
    const ids = new Set<string>()
    for (const row of rows) {
      const v = row[fieldName]
      if (many) {
        if (Array.isArray(v)) v.filter((x): x is string => typeof x === 'string').forEach(id => ids.add(id))
      } else {
        if (typeof v === 'string' && v) ids.add(v)
      }
    }

    const idArr = [...ids]
    const map = new Map<string, Record<string, unknown>>()
    if (idArr.length > 0) {
      const tbl = (contentTables as Record<string, any>)[targetType]
      if (tbl) {
        const fetched = await db.select().from(tbl).where(
          and(eq(tbl.workspaceId, wsId), inArray(tbl.id, idArr)),
        ) as Record<string, unknown>[]
        for (const r of fetched) map.set(r.id as string, r)
      }
    }
    resolved.set(fieldName, map)
  }

  return rows.map(row => {
    const out = { ...row }
    for (const { fieldName, many } of fields) {
      const map = resolved.get(fieldName)!
      const v = row[fieldName]
      if (many) {
        const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
        out[fieldName] = ids.map(id => map.get(id) ?? null).filter(Boolean)
      } else {
        out[fieldName] = typeof v === 'string' ? (map.get(v) ?? null) : null
      }
    }
    return out
  })
}

async function expandMediaForExport(
  rows:   Record<string, unknown>[],
  fields: string[],
  db:     any,
  wsId:   string,
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0 || fields.length === 0) return rows

  const ids = new Set<string>()
  for (const row of rows) {
    for (const f of fields) {
      const v = row[f]
      if (typeof v === 'string' && v) ids.add(v)
    }
  }

  const assetMap = new Map<string, Record<string, unknown>>()
  const idArr = [...ids]
  if (idArr.length > 0) {
    const fetched = await db.select().from(mediaAssets).where(
      and(eq(mediaAssets.workspaceId, wsId), inArray(mediaAssets.id, idArr)),
    ) as Record<string, unknown>[]
    for (const r of fetched) assetMap.set(r.id as string, r)
  }

  return rows.map(row => {
    const out = { ...row }
    for (const f of fields) {
      const id = row[f]
      out[f] = typeof id === 'string' && id ? (assetMap.get(id) ?? null) : null
    }
    return out
  })
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * Registers the POST /api/v1/objects/export route on the given Elysia app.
 * @param app - The Elysia application instance to attach the route to.
 * @returns The Elysia app with the export route mounted.
 */
export const exportObjectsRoute = (app: Elysia) =>
  app.post('/api/v1/objects/export', async (ctx: any) => {
    const { body, db, schema, workspaceId, permissions, set } = ctx

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new RequestError('VALIDATION_ERROR', 'Request body must be an object')
    }
    const input = body as Record<string, unknown>

    if (typeof input.type !== 'string' || !input.type) {
      throw new RequestError('VALIDATION_ERROR', 'Missing required field: type')
    }

    const typeDef = (schema as SchemaDefinition).types.find(t => t.name === input.type)
    if (!typeDef || typeDef.disabled) {
      throw new RequestError('TYPE_NOT_FOUND', `Type "${input.type}" not found in schema`)
    }

    assertObjectPermission(permissions, 'read', input.type)

    const table = (contentTables as Record<string, any>)[input.type]
    if (!table) {
      throw new RequestError('TYPE_NOT_FOUND', `Table for "${input.type}" not yet generated - run tangen push`)
    }

    // ── Determine which fields to export ──────────────────────────────────────

    const allFields = flattenFields(typeDef.fields)
    const allFieldMap = new Map(allFields.map(f => [f.name, f]))

    let selectedFieldNames: string[]
    const bodyFields = input.fields
    if (Array.isArray(bodyFields) && bodyFields.length > 0 && bodyFields.every(f => typeof f === 'string')) {
      // Caller-specified list (filter out unknowns silently)
      selectedFieldNames = (bodyFields as string[]).filter(n => allFieldMap.has(n))
    } else {
      // Fall back to schema export config, then all fields
      const exportCfg = configuredExportFields(typeDef)
      selectedFieldNames = exportCfg?.length
        ? exportCfg.filter(n => allFieldMap.has(n))
        : allFields.map(f => f.name)
    }

    // Field-level read access — members can't export fields they can't read
    const restrictedRead = restrictedReadFields(typeDef, fieldAccessContext(ctx))
    if (restrictedRead.size > 0) {
      selectedFieldNames = selectedFieldNames.filter(n => !restrictedRead.has(n))
    }

    const selectedFields = selectedFieldNames.map(n => allFieldMap.get(n)!).filter(Boolean)

    // ── Fetch rows ────────────────────────────────────────────────────────────

    const ids = input.ids
    const conditions = [eq(table.workspaceId, workspaceId)]
    if (Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string')) {
      conditions.push(inArray(table.id, ids as string[]))
    }

    let rows: Record<string, unknown>[] = await db
      .select()
      .from(table)
      .where(and(...conditions))

    // ── Expand relation + media fields ────────────────────────────────────────

    const relationExpands: RelationExpand[] = selectedFields
      .filter(f => f.fieldType === 'relation')
      .map(f => ({
        fieldName: f.name,
        many: !!((f.config as Record<string, unknown>).many),
        targetType: String((f.config as Record<string, unknown>).targetType ?? ''),
      }))
      .filter(r => r.targetType)

    const mediaFieldNames = selectedFields
      .filter(f => f.fieldType === 'media')
      .map(f => f.name)

    rows = await expandRelationsForExport(rows, relationExpands, db, workspaceId)
    rows = await expandMediaForExport(rows, mediaFieldNames, db, workspaceId)

    // ── Build CSV ─────────────────────────────────────────────────────────────

    const fieldColDefs = selectedFields.map(f => buildColumnDefs(f))
    const allCols = [...SYSTEM_EXPORT_COLUMNS, ...fieldColDefs]

    const headers = allCols.flatMap(c => c.headers)
    const csvRows = rows.map(row => allCols.flatMap(c => c.extract(row)))

    const csv = toCsv(headers, csvRows)

    // ── Response ──────────────────────────────────────────────────────────────

    set.headers['Content-Type'] = 'text/csv; charset=utf-8'
    set.headers['Content-Disposition'] = `attachment; filename="${input.type}-export.csv"`

    return csv
  })
