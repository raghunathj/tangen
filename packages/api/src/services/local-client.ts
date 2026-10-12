/**
 * File Name: local-client.ts
 * Purpose: Implements TangenLocalClient — a fluent, builder-pattern API for reading and
 *   writing CMS content objects, globals, and running validation from within route handlers.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm, @tangen/db (contentTables), route-cache, rate-limiter,
 *   field-validator, globals-store, query-compiler, relation-loader, richtext-serializer.
 */
import { randomUUID, createHash } from 'node:crypto'
import { getContentSearchSync } from './search-hooks'
import { isSlugUniqueViolation } from '../lib/slugs'
import { eq, and, ne, asc, desc, sql, getTableColumns } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type {
  SchemaDefinition,
  TangenLocalClient,
  LocalObjectBuilder,
  ContentName,
  ContentRow,
  GlobalName,
  GlobalData,
  TableName,
  TableRow,
  LocalTableBuilder,
  LocalGlobalsAccessor,
  QueryResult,
  QueryFilter,
  FieldDefinition,
  CacheOptions,
  CacheStrategy,
  RateLimitResult,
  SerializeHint,
  CustomTableDefinition,
  MailConfig,
  SendMailMessage,
} from '@tangen/types'
import { sendMail as sendMailViaConfig } from './mailer'
import { enqueueTask, resolveTaskDefinition } from './task-queue'
import { runIdentityFrom } from '../kernel/run-identity'
import { jsonbParam, textArrayParam } from '../lib/sql-values'
import { RouteError } from '@tangen/types'
import type { ComponentDef } from '@tangen/types'

/** Structural stand-in for WorkspaceProject - only what the hook runner reads. */
export type WorkspaceProjectLike = { workspaceId: string; [k: string]: unknown }
import { compileBaseQuery, compileTableFilters, filterToSQL, conditionToSQL, buildSelectColumns, cursorToSQL, encodeCursor, referencedByToSQL, cursorSortSelection, cursorSortValue, CURSOR_SORT } from './query-compiler'
import { resolveCustomTablePg, assertKnownColumns, normalizeTableWriteValues, runTableSelect } from './custom-table-registry'
import { RequestError } from '../lib/errors'
import { fetchI18nRows, buildI18nMap, filterI18nMap, localizeRow, localizedFieldNames, publishedI18nSide, publishedI18nMap } from './i18n'
import { createGlobalsStore } from './globals-store'
import { validateFieldValues } from './field-validator'
import { getRelationFields, expandRelations, applyProps } from './relation-loader'
import { getObjectFields, expandObjectFields } from './object-loader'
import { expandMediaDeep, collapseMediaDeep } from './media-loader'
import { resolveLinksDeep, collapseLinksDeep } from './link-loader'
import { expandGlobalMedia, collapseGlobalMedia, globalDefinitionOf, componentRegistryOf } from './globals-media'
import { applySerialize } from './richtext-serializer'
import { withRouteCache, clearRouteCache, withQueryCache, clearTypeQueryCache, collectQueryTags, queryCacheKeyFor } from './route-cache'
import { listTags, listTagsForEntities, addTags, removeTags, setTags, filterEntityIds } from './tags'
import { checkRateLimit } from './rate-limiter'
import { applyFieldBeforeChange, applyFieldValidate, getActiveBehaviorRegistry } from './field-behavior'
import { customFieldTypeResolverFor } from '../hooks/app-hooks-registry'
import { isSafeIdent } from '@tangen/types'
import type { ExecutionContext } from '@tangen/types'
import { createExecution, systemActor, assertKernelExecution } from '../kernel'
import { readViewOf } from '../kernel/read-view'
import { applyContentSerialize } from './content-filters'
import { requireDecision, type PolicyAction } from '../kernel/policy'

/**
 * K1.5: the extension principal's client checks the actor before touching
 * storage - tables, globals, labels, enqueue, emit. A member's or a key's
 * client keeps the enforcement its routes already apply (extending `decide`
 * to every bound client needs the member-bundle audit first; see
 * tasks/plan-extension-kernel.md). Unbound = trusted site code.
 */
function guard(exec: ExecutionContext | null | undefined, action: PolicyAction): void {
  if (exec?.actor.identity.kind === 'extension') requireDecision(exec.actor, action)
}


function safeId(name: string): string {
  if (!isSafeIdent(name)) {
    throw new RouteError(422, `Invalid field name: "${name}"`)
  }
  return name
}

function hashBuilderState(state: BuilderState): string {
  const key = JSON.stringify({
    type: state.typeName,
    status: state.statusVal,
    filters: state.filtersVal,
    sort: state.sortFieldVal ? [state.sortFieldVal, state.sortDirVal] : null,
    limit: state.limitVal,
    offset: state.offsetVal,
    after: state.afterVal,
    depth: state.depthVal,
    props: state.propsVal,
    populate: state.populateVal,
    locale: state.localeVal,
  })
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

// ─── Builder ───────────────────────────────────────────────────────────────────

interface BuilderState {
  typeName: string
  statusVal: string | null
  filtersVal: QueryFilter | null
  sortFieldVal: string | null
  sortDirVal: 'asc' | 'desc'
  limitVal: number
  offsetVal: number
  afterVal: string | null
  depthVal: number
  propsVal: string[] | null
  populateVal: Record<string, string[]> | null
  serializeVal: Record<string, SerializeHint> | null
  cacheStrategyVal: CacheStrategy | null
  noCacheVal: boolean
  localeVal: string | string[] | null
}

/** The client's error contract is RouteError (status, message); the canonical writes throw RequestError. */
function toRouteError(err: unknown): unknown {
  if (err instanceof RequestError) return new RouteError(err.statusCode, err.message, err.fieldErrors ?? err.details)
  return err
}

class LocalObjectBuilderImpl implements LocalObjectBuilder {
  constructor(
    private readonly db: any,
    private readonly redis: any,
    private readonly schema: SchemaDefinition,
    private readonly workspaceId: string,
    private readonly state: BuilderState,
    private readonly projects?: WorkspaceProjectLike[],
    /** The execution this client acts in (K3); absent = trusted site code, Tangen's own authority. */
    private readonly exec?: ExecutionContext,
  ) {}

  private fork(patch: Partial<BuilderState>): LocalObjectBuilderImpl {
    return new LocalObjectBuilderImpl(this.db, this.redis, this.schema, this.workspaceId, {
      ...this.state,
      ...patch,
    }, this.projects, this.exec)
  }

  /**
   * The execution a write runs in: the one this client was bound to (a
   * GraphQL or MCP call runs as its key, a job as its run), else Tangen's
   * own authority with the reason `local-client` - trusted site code, as
   * the client always was, now attributed and hooked like every other path.
   */
  private execution(): ExecutionContext {
    if (this.exec) return this.exec
    return createExecution({
      kind: 'request', source: 'extension', workspaceId: this.workspaceId,
      actor: systemActor({ workspaceId: this.workspaceId, reason: 'local-client' }),
    })
  }

  /** What the canonical writes need from this client. */
  private writeDeps(): import('../domain/content/write').ContentWriteDeps {
    return {
      db: this.db, redis: this.redis, schema: this.schema,
      projects: (this.projects ?? []) as never,
      searchEngineRef: getContentSearchSync() ?? undefined,
    }
  }

  /** The workspace's reusable components, for blocks declared by registry name
   *  (media inside them expands on read and folds back to ids on write). Empty
   *  without projects - inline defs, the common case, need no registry. */
  private componentRegistry(): ComponentDef[] {
    const project = this.projects?.find((p) => p.workspaceId === this.workspaceId)
    const components = project?.components
    return Array.isArray(components) ? (components as ComponentDef[]) : []
  }

  // ── Content hooks (C1) ──────────────────────────────────────────────────────
  // Local-client writes previously bypassed content hooks entirely, so a
  // beforeChange gate (e.g. a review-approval extension) could be walked
  // around by flows/custom-route/extension code. Hooks activate when the
  // client is constructed with `projects`; without them behavior is unchanged.

  private hooksEnabled(): boolean {
    return Array.isArray(this.projects) && this.projects.length > 0
  }

  /** Runs beforeChange across extension+site hooks. Throws abort the write. */
  private async runChangeGate(ctx: {
    objectId: string
    typeName: string
    operation: 'create' | 'update'
    trigger: 'manual' | 'autosave' | 'restore' | 'schedule'
    statusChange?: { from: string; to: string }
    prevData: Record<string, unknown> | null
    nextData: Record<string, unknown>
  }): Promise<Record<string, unknown> | null> {
    if (!this.hooksEnabled()) return null
    const { runBeforeChange, createExtensionDataStore } = await import('../hooks/runner')
    return runBeforeChange(this.db, this.projects as never, {
      ...ctx,
      actor: { source: 'system' as const },
      workspaceId: this.workspaceId,
      extensionData: createExtensionDataStore(this.db, this.workspaceId, this.redis),
      globals: createGlobalsStore(this.db, this.workspaceId),
      enqueue: (taskId: string, payload?: unknown) => enqueueTask({
        taskId, workspaceId: this.workspaceId, payload, ...runIdentityFrom(this.exec ?? null, resolveTaskDefinition(this.workspaceId, taskId)),
      }),
    } as never)
  }

  /** Fire-and-forget afterChange (errors are swallowed by the runner). */
  private async runAfterChangeSafe(ctx: {
    objectId: string
    typeName: string
    operation: 'create' | 'update'
    trigger: 'manual' | 'autosave' | 'restore' | 'schedule'
    statusChange?: { from: string; to: string }
    prevData: Record<string, unknown> | null
    nextData: Record<string, unknown>
    savedData: Record<string, unknown>
  }): Promise<void> {
    if (!this.hooksEnabled()) return
    const { runAfterChange, createExtensionDataStore } = await import('../hooks/runner')
    await runAfterChange(this.db, this.projects as never, {
      ...ctx,
      actor: { source: 'system' as const },
      workspaceId: this.workspaceId,
      extensionData: createExtensionDataStore(this.db, this.workspaceId, this.redis),
      globals: createGlobalsStore(this.db, this.workspaceId),
      enqueue: (taskId: string, payload?: unknown) => enqueueTask({
        taskId, workspaceId: this.workspaceId, payload, ...runIdentityFrom(this.exec ?? null, resolveTaskDefinition(this.workspaceId, taskId)),
      }),
    } as never)
  }

  /** Fetch the current row (hook prevData); null when absent. */
  private async currentRow(table: any, id: string): Promise<Record<string, unknown> | null> {
    const rows = await this.db
      .select().from(table)
      .where(and(eq(table.id, id), eq(table.workspaceId, this.workspaceId)))
      .limit(1)
    return ((rows as any[])[0] as Record<string, unknown>) ?? null
  }

  where(filters: QueryFilter): LocalObjectBuilder { return this.fork({ filtersVal: filters }) }
  status(s: string): LocalObjectBuilder           { return this.fork({ statusVal: s }) }
  depth(n: number): LocalObjectBuilder            { return this.fork({ depthVal: n }) }
  populate(field: string, props: string[]): LocalObjectBuilder {
    return this.fork({ populateVal: { ...(this.state.populateVal ?? {}), [field]: props } })
  }
  serialize(hints: Record<string, SerializeHint>): LocalObjectBuilder { return this.fork({ serializeVal: hints }) }
  sort(field: string, direction: 'asc' | 'desc' = 'asc'): LocalObjectBuilder { return this.fork({ sortFieldVal: field, sortDirVal: direction }) }
  limit(n: number): LocalObjectBuilder  { return this.fork({ limitVal: n }) }
  offset(n: number): LocalObjectBuilder { return this.fork({ offsetVal: n }) }
  after(c: string): LocalObjectBuilder  { return this.fork({ afterVal: c }) }
  props(fields: string[]): LocalObjectBuilder { return this.fork({ propsVal: fields }) }
  cacheStrategy(strategy: CacheStrategy): LocalObjectBuilder { return this.fork({ cacheStrategyVal: strategy }) }
  /**
   * Serve localized fields in this locale (per-field fallback to the default).
   * Pass 'all' or an array of codes to attach a per-row `i18n` translations
   * map instead of overlaying a single language.
   */
  locale(code: string | string[]): LocalObjectBuilder { return this.fork({ localeVal: code }) }

  /** Single-code overlay locale, or null in map/off modes. */
  private overlayLocale(): string | null {
    const v = this.state.localeVal
    return typeof v === 'string' && v !== 'all' && !v.includes(',') ? v : null
  }

  /** Locales wanted as a per-row map ('all' | codes[]), or null in overlay/off modes. */
  private mapLocales(): string[] | 'all' | null {
    const v = this.state.localeVal
    if (Array.isArray(v)) return v
    if (v === 'all') return 'all'
    if (typeof v === 'string' && v.includes(',')) return v.split(',').map(p => p.trim()).filter(Boolean)
    return null
  }

  /**
   * Overlays one locale or attaches the i18n map, per the builder's .locale().
   * A `.status('published')` read is the published web: its translations come
   * from the publish-time snapshot on the RAW rows (`published`), never from
   * the live side rows, which are draft state (K0). Other reads see live rows.
   */
  private async applyReadLocales(
    rows: Record<string, unknown>[], typeDef: any, published: Map<string, Record<string, unknown>> | null,
  ): Promise<Record<string, unknown>[]> {
    const overlay = this.overlayLocale()
    if (overlay) {
      if (published) return rows.map(r => localizeRow(r, publishedI18nSide(published.get(r.id as string) ?? {}, overlay), typeDef))
      const sideRows = await fetchI18nRows(this.db, this.state.typeName, rows.map(r => r.id as string), overlay)
      const byId = new Map(sideRows.map(r => [r.objectId, r]))
      return rows.map(r => localizeRow(r, byId.get(r.id as string), typeDef))
    }
    const wanted = this.mapLocales()
    if (wanted) {
      if (published) return rows.map(r => ({ ...r, i18n: filterI18nMap(publishedI18nMap(published.get(r.id as string) ?? {}), wanted) }))
      const sideRows = await fetchI18nRows(this.db, this.state.typeName, rows.map(r => r.id as string), 'all')
      return rows.map(r => ({
        ...r,
        i18n: filterI18nMap(buildI18nMap(sideRows.filter(sr => sr.objectId === r.id), typeDef), wanted),
      }))
    }
    return rows
  }

  /** The raw rows keyed by id when this read is the published web, else null. */
  private publishedRaw(rows: Record<string, unknown>[], statusVal: string | null | undefined): Map<string, Record<string, unknown>> | null {
    if (statusVal !== 'published') return null
    return new Map(rows.map(r => [r.id as string, r]))
  }
  noCache(): LocalObjectBuilder { return this.fork({ noCacheVal: true }) }

  private async resolveTable() {
    const { typeName } = this.state
    const typeDef = this.schema.types.find(t => t.name === typeName && (t as { disabled?: boolean }).disabled !== true)
    if (!typeDef) throw new RouteError(404, `Type "${typeName}" not found in schema`)
    const { contentTables } = await import('@tangen/db/content-tables')
    const table = (contentTables as Record<string, any>)[typeName]
    if (!table) throw new RouteError(404, `Table for type "${typeName}" not yet generated - run tangen push`)
    return { typeDef, table }
  }

  async get(): Promise<QueryResult> {
    guard(this.exec, { kind: 'object', action: 'read', type: this.state.typeName })
    const { cacheStrategyVal } = this.state
    if (cacheStrategyVal && this.redis) {
      // The key carries the SCHEMA it was answered under (Phase 6B, Unit 4).
      const queryKey = queryCacheKeyFor(this.schema, hashBuilderState(this.state))
      const tags = collectQueryTags(this.schema, this.state.typeName, this.state.depthVal)
      return withQueryCache(this.redis, this.workspaceId, this.state.typeName, queryKey, cacheStrategyVal, () => this._fetchQuery(), {
        tags,
        noCacheRead: this.state.noCacheVal,
      })
    }
    return this._fetchQuery()
  }

  /**
   * The status this read runs with. A client bound to an execution reads with
   * its actor's view (K3): a key without the draft grant gets the published
   * web whatever it asked for, and a key asking for drafts without the grant
   * is refused; an unbound client (trusted site code) reads what it asked.
   */
  private effectiveStatus(): string | null {
    if (!this.exec) return this.state.statusVal
    try {
      return readViewOf(this.exec.actor, this.state.statusVal, this.state.typeName).status
    } catch (err) { throw toRouteError(err) }
  }

  private async _fetchQuery(): Promise<QueryResult> {
    const { filtersVal, sortFieldVal, sortDirVal, limitVal, offsetVal, depthVal } = this.state
    const statusVal = this.effectiveStatus()
    const { table } = await this.resolveTable()

    let compiled
    try {
      compiled = compileBaseQuery({
        type: this.state.typeName,
        ...(statusVal !== null ? { status: statusVal as any } : {}),
        ...(filtersVal ? { query: filtersVal } : {}),
        ...(sortFieldVal ? { sort: { field: sortFieldVal, direction: sortDirVal } } : {}),
        limit: limitVal,
        offset: offsetVal,
        ...(this.state.afterVal ? { after: this.state.afterVal } : {}),
        depth: depthVal,
      }, this.schema)
    } catch (e) {
      if (e instanceof RequestError) {
        throw new RouteError(e.statusCode, e.message)
      }
      throw e
    }

    const { statusFilter, excludeArchived, fieldFilters, sortField, sortDirection, limit, offset, referencedBy, cursor } = compiled

    const conditions: SQL[] = [
      eq(table.workspaceId, this.workspaceId),
      ]
    if (statusFilter) {
      conditions.push(eq(table.status, statusFilter))
    } else if (excludeArchived) {
      conditions.push(ne(table.status, 'archived'))
    }
    const typeDefI18n = this.schema.types.find(t => t.name === this.state.typeName)
    const overlayLoc = this.overlayLocale()
    const i18nCtx = overlayLoc && typeDefI18n && localizedFieldNames(typeDefI18n).length > 0
      ? { locale: overlayLoc, localizedColumns: new Set([...localizedFieldNames(typeDefI18n), 'title']) }
      : undefined
    for (const f of fieldFilters) conditions.push(conditionToSQL(f, { workspaceId: this.workspaceId, sourceTypeName: this.state.typeName, i18n: i18nCtx }))
    if (referencedBy) conditions.push(referencedByToSQL(referencedBy, this.state.typeName, this.workspaceId))

    // Cursor pagination: keyset predicate + count without it (total stays the full set)
    const countConditions = [...conditions]
    if (cursor) conditions.push(cursorToSQL(cursor, sortField, sortDirection))

    // id tiebreak keeps ordering deterministic so cursors from any page are stable
    const orderExprs = sortDirection === 'asc'
      ? [asc(sql.raw(`"${sortField}"`)), asc(table.id)]
      : [desc(sql.raw(`"${sortField}"`)), desc(table.id)]

    // The sort column must be selected even under a props projection — the
    // next-page cursor is built from the last row's sort value.
    const sortJsKey = Object.keys(table).find(k => (table as any)[k]?.name === sortField) ?? sortField
    const propsVal = this.state.propsVal ?? undefined
    const colSelection = buildSelectColumns(table, propsVal ? [...propsVal, sortJsKey] : undefined)
    const cursorSel = cursorSortSelection(table as never, sortJsKey)
    const pageSelection = cursorSel ? { ...(colSelection ?? getTableColumns(table as never)), ...cursorSel } : colSelection
    const [rows, countRows] = await Promise.all([
      (pageSelection ? this.db.select(pageSelection as never) : this.db.select()).from(table).where(and(...conditions)).orderBy(...orderExprs).limit(limit).offset(offset),
      this.db.select({ count: sql<number>`COUNT(*)` }).from(table).where(and(...countConditions)),
    ])

    const total = Number((countRows as any[])[0]?.count ?? 0)

    const lastRow = (rows as Record<string, unknown>[])[rows.length - 1]
    const nextCursor = rows.length === limit && lastRow
      ? encodeCursor(cursorSortValue(lastRow, sortJsKey), lastRow.id as string)
      : null
    if (cursorSel) for (const r of rows as Record<string, unknown>[]) delete r[CURSOR_SORT]

    const typeDef = this.schema.types.find(t => t.name === this.state.typeName)!
    let expandedRows: Record<string, unknown>[] = rows as Record<string, unknown>[]
    const publishedRaw = this.publishedRaw(expandedRows, statusVal)

    expandedRows = applyPublishedSnapshot(expandedRows, statusVal)
    expandedRows = coerceNumericFields(expandedRows, typeDef)
    expandedRows = stripDisabledFields(expandedRows, typeDef)
    expandedRows = stripInternalColumns(expandedRows)
    if (statusVal && statusVal !== 'published') {
      expandedRows = expandedRows.map((r) => ({ ...r, hasDraftChanges: computeHasDraftChanges(r, typeDef) }))
    }
    expandedRows = await this.applyReadLocales(expandedRows, typeDef, publishedRaw)

    if (depthVal >= 1) {
      expandedRows = await expandRelations(expandedRows, getRelationFields(typeDef), this.db, this.workspaceId, {
        schema: this.schema, depth: depthVal, populate: this.state.populateVal ?? undefined,
      })
      expandedRows = await expandObjectFields(expandedRows, getObjectFields(typeDef), this.db, this.workspaceId, this.schema, depthVal)
    }
    expandedRows = await expandMediaDeep(expandedRows, typeDef, this.componentRegistry(), this.db, this.workspaceId, this.overlayLocale())
    // Trusted server-side reads (custom routes, flows) resolve links
    // editorially: this client already reads drafts, so hiding an
    // unpublished target here would hide it from its own author.
    expandedRows = await resolveLinksDeep(expandedRows, typeDef, this.componentRegistry(), this.db, this.workspaceId, { locale: this.overlayLocale() })

    const serialized = applySerialize(
      expandedRows.map(row => ({ ...row, type: this.state.typeName })),
      this.state.serializeVal ?? undefined,
    )
    // K4.4: content.serialize@1 - the rows as they will be returned (before props select).
    const shaped = await applyContentSerialize({ workspaceId: this.workspaceId, typeName: this.state.typeName, rows: serialized, status: this.state.statusVal, context: { exec: this.exec ?? null } })
    const filtered = applyProps(shaped, this.state.propsVal ?? undefined)

    return { data: filtered, meta: { total, limit, offset, nextCursor } }
  }

  async find(id: string): Promise<{ data: Record<string, unknown> }> {
    guard(this.exec, { kind: 'object', action: 'read', type: this.state.typeName })
    const { table } = await this.resolveTable()
    const rows = await this.db
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.workspaceId, this.workspaceId)))
      .limit(1)
    if (!(rows as any[]).length) throw new RouteError(404, `Object "${id}" not found`)
    return { data: await this.expandSingle((rows as any[])[0] as Record<string, unknown>) }
  }

  async findBySlug(slug: string): Promise<{ data: Record<string, unknown> }> {
    guard(this.exec, { kind: 'object', action: 'read', type: this.state.typeName })
    const { table } = await this.resolveTable()
    const rows = await this.db
      .select()
      .from(table)
      .where(and(eq(table.slug, slug), eq(table.workspaceId, this.workspaceId)))
      .limit(1)
    if (!(rows as any[]).length) throw new RouteError(404, `Object with slug "${slug}" not found`)
    return { data: await this.expandSingle((rows as any[])[0] as Record<string, unknown>) }
  }

  /**
   * Single-row read pipeline: locale overlay (when .locale() was called) plus
   * media expansion — the SAME shaping the list path does, so `find()` callers
   * (GraphQL single queries, custom routes) get asset objects, not raw ids.
   */
  private async expandSingle(row: Record<string, unknown>): Promise<Record<string, unknown>> {
    const typeDef = this.schema.types.find(t => t.name === this.state.typeName)!
    // .status('published') on single reads: 404 for other statuses, and serve
    // the published SNAPSHOT (frozen at publish) instead of live draft columns.
    const wanted = this.effectiveStatus()
    if (wanted && wanted !== 'any' && row.status !== wanted) {
      throw new RouteError(404, `Object not found`)
    }
    const publishedRaw = this.publishedRaw([row], wanted)
    let rows: Record<string, unknown>[] = applyPublishedSnapshot([row], wanted)
    rows = coerceNumericFields(rows, typeDef)
    rows = stripDisabledFields(rows, typeDef)
    rows = stripInternalColumns(rows)
    if (wanted && wanted !== 'published') {
      rows = rows.map((r) => ({ ...r, hasDraftChanges: computeHasDraftChanges(r, typeDef) }))
    }
    if (this.state.localeVal) rows = await this.applyReadLocales(rows, typeDef, publishedRaw)
    rows = await expandMediaDeep(rows, typeDef, this.componentRegistry(), this.db, this.workspaceId, this.overlayLocale())
    rows = await resolveLinksDeep(rows, typeDef, this.componentRegistry(), this.db, this.workspaceId, { locale: this.overlayLocale() })
    // K4.4: content.serialize@1 - the row as it will be returned.
    const [shaped] = await applyContentSerialize({ workspaceId: this.workspaceId, typeName: this.state.typeName, rows: [rows[0]], status: this.state.statusVal, context: { exec: this.exec ?? null } })
    return shaped!
  }

  async create(payload: { title: string; values?: Record<string, unknown> }): Promise<{ data: Record<string, unknown> }> {
    const { typeDef } = await this.resolveTable()
    const { title } = payload
    // Input normalisation is the client's: expanded media and links fold back
    // to ids, disabled fields drop, unknown fields are refused as they always
    // were. The write itself is the canonical operation (K3).
    const values = collapseLinksDeep(collapseMediaDeep(dropDisabledWrites(payload.values ?? {}, typeDef), typeDef, this.componentRegistry()), typeDef, this.componentRegistry())
    if (!title || !title.trim()) throw new RouteError(422, 'title is required')
    const knownFields = new Set(typeDef.fields.map(f => f.name))
    for (const key of Object.keys(values)) {
      if (!knownFields.has(key)) {
        throw new RouteError(422, `Unknown field: "${key}" is not defined on type "${typeDef.name}"`)
      }
    }
    const { contentCreate } = await import('../domain/content/write')
    try {
      const r = await contentCreate(this.execution(), { typeName: typeDef.name, title: title.trim(), values }, this.writeDeps())
      return { data: r.data }
    } catch (err) { throw toRouteError(err) }
  }

  async update(id: string, rawUpdates: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    const { typeDef } = await this.resolveTable()
    const updates = collapseLinksDeep(collapseMediaDeep(dropDisabledWrites(rawUpdates, typeDef), typeDef, this.componentRegistry()), typeDef, this.componentRegistry())
    const knownFields = new Set(typeDef.fields.map(f => f.name))
    const allowedSystemKeys = new Set(['title', 'slug'])
    for (const key of Object.keys(updates)) {
      if (!knownFields.has(key) && !allowedSystemKeys.has(key)) {
        throw new RouteError(422, `Unknown field: "${key}" is not defined on type "${typeDef.name}"`)
      }
    }
    const { contentUpdate } = await import('../domain/content/write')
    try {
      const r = await contentUpdate(this.execution(), { typeName: typeDef.name, id, updates }, this.writeDeps())
      return { data: r.data }
    } catch (err) { throw toRouteError(err) }
  }

  async delete(id: string): Promise<{ data: { id: string } }> {
    const { typeDef } = await this.resolveTable()
    const { contentDelete } = await import('../domain/content/write')
    try {
      const r = await contentDelete(this.execution(), { typeName: typeDef.name, id }, this.writeDeps())
      return { data: { id: String(r.data.id) } }
    } catch (err) { throw toRouteError(err) }
  }

  /** What the canonical lifecycle operations need from this client. */
  private lifecycleDeps(): import('../domain/lifecycle').LifecycleDeps {
    return { db: this.db, redis: this.redis, schema: this.schema, projects: (this.projects ?? []) as never, searchEngineRef: getContentSearchSync() ?? undefined }
  }

  /** The cascade plan plus whether this client's actor may publish now, and why not (K4). */
  async publishPreflight(id: string): Promise<{ data: import('@tangen/types').PublishPlan }> {
    const { lifecyclePreflight } = await import('../domain/lifecycle')
    try { return await lifecyclePreflight(this.execution(), { typeName: this.state.typeName, id }, this.lifecycleDeps()) }
    catch (err) { throw toRouteError(err) }
  }

  /** Publish: the one implementation (validation, hooks, snapshot, revision, event, attribution), as this client's actor. */
  async publish(id: string, opts?: { cascade?: boolean }): Promise<{ data: Record<string, unknown> }> {
    const { lifecyclePublish } = await import('../domain/lifecycle')
    try { return await lifecyclePublish(this.execution(), { typeName: this.state.typeName, id, cascade: opts?.cascade }, this.lifecycleDeps()) }
    catch (err) { throw toRouteError(err) }
  }

  async unpublish(id: string): Promise<{ data: Record<string, unknown> }> {
    const { lifecycleUnpublish } = await import('../domain/lifecycle')
    try { return await lifecycleUnpublish(this.execution(), { typeName: this.state.typeName, id }, this.lifecycleDeps()) }
    catch (err) { throw toRouteError(err) }
  }

  /** Schedule a future publish: the scheduler publishes it AS this client's actor, with the authority held then. */
  async schedule(id: string, at: string | Date): Promise<{ data: Record<string, unknown> }> {
    const when = at instanceof Date ? at : new Date(at)
    if (Number.isNaN(when.getTime())) throw new RouteError(422, 'schedule: `at` must be a valid date')
    const { lifecycleSchedule } = await import('../domain/lifecycle')
    try { return await lifecycleSchedule(this.execution(), { typeName: this.state.typeName, id, at: when }, this.lifecycleDeps()) }
    catch (err) { throw toRouteError(err) }
  }
}

// ─── Custom table builder ─────────────────────────────────────────────────────

interface TableBuilderState {
  tableName: string
  filtersVal: QueryFilter | null
  sortFieldVal: string | null
  sortDirVal: 'asc' | 'desc'
  limitVal: number
  offsetVal: number
  propsVal: string[] | null
}

class LocalTableBuilderImpl implements LocalTableBuilder {
  constructor(
    private readonly db: any,
    private readonly workspaceId: string,
    private readonly customTables: CustomTableDefinition[],
    private readonly state: TableBuilderState,
    private readonly exec?: ExecutionContext,
  ) {}

  private fork(patch: Partial<TableBuilderState>): LocalTableBuilderImpl {
    return new LocalTableBuilderImpl(this.db, this.workspaceId, this.customTables, { ...this.state, ...patch }, this.exec)
  }

  private allow(action: 'read' | 'write'): void {
    guard(this.exec, { kind: 'table', action, table: this.state.tableName })
  }

  /** Definition (boot-loaded config) + Drizzle table (generated registry, or
   *  built from the definition) — custom tables execute through Drizzle, the
   *  same layer content tables use. */
  private async resolveTable(): Promise<{ def: CustomTableDefinition; table: Record<string, any> }> {
    const def = this.customTables.find(t => t.name === this.state.tableName)
    if (!def) throw new RouteError(404, `Custom table "${this.state.tableName}" is not registered in customTables`)
    return { def, table: await resolveCustomTablePg(def) }
  }

  where(filters: QueryFilter): LocalTableBuilder { return this.fork({ filtersVal: filters }) }
  sort(field: string, direction: 'asc' | 'desc' = 'asc'): LocalTableBuilder { return this.fork({ sortFieldVal: field, sortDirVal: direction }) }
  limit(n: number): LocalTableBuilder  { return this.fork({ limitVal: n }) }
  offset(n: number): LocalTableBuilder { return this.fork({ offsetVal: n }) }
  props(fields: string[]): LocalTableBuilder { return this.fork({ propsVal: fields }) }

  private buildWhereConditions(def: CustomTableDefinition, table: Record<string, any>): SQL[] {
    const conditions: SQL[] = [eq(table.workspace_id, this.workspaceId)]
    if (this.state.filtersVal) {
      const allowedCols = new Set([
        'id', 'workspace_id',
        ...Object.keys(def.columns),
      ])
      const compiled = compileTableFilters(this.state.filtersVal, allowedCols)
      for (const f of compiled) conditions.push(filterToSQL(f))
    }
    return conditions
  }

  async find(): Promise<QueryResult> {
    this.allow('read')
    const { def, table } = await this.resolveTable()
    const { sortFieldVal, sortDirVal, limitVal, offsetVal, propsVal } = this.state
    return runTableSelect(this.db, table, {
      conditions: this.buildWhereConditions(def, table),
      sortField: sortFieldVal ?? 'id',
      sortDir: sortDirVal,
      limit: limitVal,
      offset: offsetVal,
      props: propsVal,
    })
  }

  async findOne(id: string): Promise<{ data: Record<string, unknown> }> {
    this.allow('read')
    const { def, table } = await this.resolveTable()
    const rows = await this.db
      .select()
      .from(table)
      .where(and(
        eq(table.id, id),
        eq(table.workspace_id, this.workspaceId),
      ))
      .limit(1)
    if (!(rows as any[]).length) throw new RouteError(404, `Row "${id}" not found in table "${def.name}"`)
    return { data: (rows as Record<string, unknown>[])[0] }
  }

  async create(data: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    this.allow('write')
    const { def, table } = await this.resolveTable()
    assertKnownColumns(def, data)
    const payload: Record<string, unknown> = {
      id: randomUUID(),
      workspace_id: this.workspaceId,
      ...normalizeTableWriteValues(def, data),
    }
    const rows = await this.db.insert(table).values(payload).returning()
    return { data: ((rows as Record<string, unknown>[])[0] ?? payload) }
  }

  async update(id: string, data: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    this.allow('write')
    const { def, table } = await this.resolveTable()
    assertKnownColumns(def, data)
    if (Object.keys(data).length === 0) throw new RouteError(422, 'No values to update')
    const rows = await this.db
      .update(table)
      .set(normalizeTableWriteValues(def, data))
      .where(and(
        eq(table.id, id),
        eq(table.workspace_id, this.workspaceId),
      ))
      .returning()
    if (!(rows as any[]).length) throw new RouteError(404, `Row "${id}" not found in table "${def.name}"`)
    return { data: (rows as Record<string, unknown>[])[0] }
  }

  async delete(id: string): Promise<{ data: { id: string } }> {
    this.allow('write')
    const { def, table } = await this.resolveTable()
    const rows = await this.db
      .delete(table)
      .where(and(
        eq(table.id, id),
        eq(table.workspace_id, this.workspaceId),
      ))
      .returning({ id: table.id })
    if (!(rows as any[]).length) throw new RouteError(404, `Row "${id}" not found in table "${def.name}"`)
    return { data: { id: (rows as any[])[0].id as string } }
  }
}

// ─── Globals accessor ──────────────────────────────────────────────────────────

/**
 * Media in a global reads and writes like media in an object: a read expands
 * ids to asset objects at every position the global's definition declares
 * (so a kit.image in a header surface carries its url), a write folds an
 * echoed asset object back to its id. The definition and the component
 * registry come from the workspace projects; without them (a client built
 * without `projects`) the historical raw read is kept - there is no field
 * list to walk.
 */
class LocalGlobalsAccessorImpl implements LocalGlobalsAccessor {
  private readonly store: ReturnType<typeof createGlobalsStore>
  constructor(
    private readonly db: any,
    private readonly workspaceId: string,
    private readonly name: string,
    private readonly projects?: WorkspaceProjectLike[],
    private readonly exec?: ExecutionContext,
  ) {
    this.store = createGlobalsStore(db, workspaceId)
  }

  private allow(action: 'read' | 'write'): void {
    guard(this.exec, { kind: 'globals', action, name: this.name })
  }

  private project(): WorkspaceProjectLike | undefined {
    return this.projects?.find((p) => p.workspaceId === this.workspaceId)
  }

  async get(): Promise<Record<string, unknown>> {
    this.allow('read')
    const stored = await this.store.get(this.name)
    const project = this.project()
    return expandGlobalMedia(stored, globalDefinitionOf(project, this.name), componentRegistryOf(project), this.db, this.workspaceId)
  }
  patch(data: Record<string, unknown>): Promise<void> {
    this.allow('write')
    const project = this.project()
    return this.store.patch(this.name, collapseGlobalMedia(data, globalDefinitionOf(project, this.name), componentRegistryOf(project)))
  }
  set(data: Record<string, unknown>): Promise<void> {
    this.allow('write')
    const project = this.project()
    return this.store.set(this.name, collapseGlobalMedia(data, globalDefinitionOf(project, this.name), componentRegistryOf(project)))
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Options required to construct a TangenLocalClient instance.
 */
/**
 * Keep search in step with a content mutation made through this client.
 *
 * The routes get this seam decorated onto the request; the local client has no
 * request - three of its ten construction sites are an extension context, a job
 * context and the form worker - so it asks `search-hooks` for the same object
 * the search capability published. No sync means search is not enabled in this
 * deployment, and the mutation simply proceeds.
 *
 * `row` must be the row the authoritative write RETURNED. Projecting a copy the
 * caller was already holding would reindex whatever it happened to contain.
 */
async function syncSearch(
  schema: SchemaDefinition,
  tx: unknown,
  args: { workspaceId: string; typeName: string; objectId: string; row: Record<string, unknown> },
): Promise<void> {
  await getContentSearchSync()?.onWrite({ schema: schema as never }, tx, args)
}

/**
 * Run `fn` in a transaction where the handle has one, so a content write and its
 * search projection land together or not at all - the same guarantee the publish
 * routes make. Tests and a few embedded callers hand in a stand-in without
 * `transaction`; a content mutation is not worth refusing over that.
 */
async function withTx<T>(db: any, fn: (tx: any) => Promise<T>): Promise<T> {
  try {
    return typeof db?.transaction === 'function' ? await db.transaction(fn) : await fn(db)
  } catch (err) {
    // The database's unique index on (slug) is the authority for slug
    // uniqueness; through this client the refusal is the same 409 the routes give.
    if (isSlugUniqueViolation(err)) throw new RouteError(409, 'Slug is already in use')
    throw err
  }
}

export interface LocalClientOptions {
  db: any
  redis: any
  schema: SchemaDefinition
  workspaceId: string
  customTables?: CustomTableDefinition[]
  /** Workspace mail sender — enables tangen.sendMail (absent → sendMail throws). */
  mail?: MailConfig
  /** Workspace projects — enables content hooks on mutating methods (C1).
   *  Absent → historical no-hook behavior. */
  projects?: WorkspaceProjectLike[]
  /**
   * The execution this client acts in (K3): a GraphQL or MCP call binds its
   * key's execution so the canonical writes enforce that key's grants and
   * attribute to it; a job binds its run. Absent, the client is trusted site
   * code acting with Tangen's own authority (reason `local-client`).
   */
  exec?: ExecutionContext
}

/**
 * Creates a TangenLocalClient bound to a specific workspace and environment.
 * Exposes fluent builders for objects/globals and helpers for validation, rate-limiting, and caching.
 * @param options - DB, Redis, schema, workspace, and environment configuration.
 * @returns A fully-configured TangenLocalClient.
 */
/**
 * When a read asked for `.status('published')`, serve the SNAPSHOT taken at
 * publish time (`published_values`) over the live columns — otherwise draft
 * edits made after publishing leak into public reads. System columns stay
 * live; the snapshot's embedded i18n map is dropped (translations serve from
 * the side tables). Fail-open: rows without a snapshot pass through.
 */
/**
 * "Is what I'm looking at ahead of what the public sees?" — for preview reads
 * (status draft/any). Draft rows are unpublished by definition; published rows
 * compare their live working columns against the publish-time snapshot.
 */
/** Canonical JSON — keys sorted recursively, undefined dropped — so two blobs
 *  with the same content but different key order compare equal. */
function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const val = (v as Record<string, unknown>)[k]
        if (val !== undefined) out[k] = norm(val)
      }
      return out
    }
    return v
  }
  return JSON.stringify(norm(value))
}

export function computeHasDraftChanges(
  row: Record<string, unknown>,
  typeDef: { fields: Array<{ name: string; fieldType?: string }> },
  liveI18n?: Record<string, Record<string, unknown>> | null,
): boolean {
  if (row.status === 'draft') return true
  if (row.status !== 'published') return false
  const snap = row.publishedValues as Record<string, unknown> | null | undefined
  if (!snap || typeof snap !== 'object') {
    // Legacy rows without a snapshot: fall back to the timestamps
    const up = row.updatedAt instanceof Date ? row.updatedAt.getTime() : Date.parse(String(row.updatedAt ?? 0))
    const pub = row.publishedAt instanceof Date ? row.publishedAt.getTime() : Date.parse(String(row.publishedAt ?? 0))
    return Number.isFinite(up) && Number.isFinite(pub) && up > pub
  }
  const live: Record<string, unknown> = { title: row.title, slug: row.slug }
  for (const f of typeDef.fields) live[f.name] = row[f.name]
  const { i18n: snapI18n, ...snapValues } = snap
  // Compare like-for-like: coerce NUMERIC fields on BOTH sides (the live row
  // may already be number-coerced while the stored snapshot holds strings), and
  // compare canonically so key order never triggers a phantom "draft changes".
  const [liveNorm] = coerceNumericFields([live], typeDef)
  const [snapNorm] = coerceNumericFields([snapValues], typeDef)
  if (canonicalJson(liveNorm) !== canonicalJson(snapNorm)) return true
  // K3: translations count. When the caller has the live i18n map (the shape
  // buildI18nMap produces, which is what publish froze), a translation edited
  // since publish is a draft change too.
  if (liveI18n) return canonicalJson(liveI18n) !== canonicalJson((snapI18n ?? {}) as Record<string, unknown>)
  return false
}

/**
 * Internal row columns that must never appear in an API/SDK/custom-route
 * response: the published-values snapshot (an admin/preview implementation
 * detail) and the tenant/env identifiers. Stripped at the final serialization
 * step, after processing that needs them (published overlay, draft-changes
 * comparison, relation loading) has run.
 */
const INTERNAL_RESPONSE_COLUMNS = ['publishedValues', 'workspaceId', '__title'] as const

/**
 * Keeps only the columns the generated table declares. A raw `RETURNING *`
 * hands back whatever the TABLE holds, which includes a guarded column that a
 * destructive push put aside (`_dropped__<name>__<id>`) - a recovery artifact,
 * never content, and never part of a response (Phase 6B, Unit 8).
 */
export function projectToTableColumns(rows: Record<string, unknown>[], table: Record<string, unknown> | undefined): Record<string, unknown>[] {
  if (!table) return rows
  const known = new Set(Object.keys(table))
  if (known.size === 0) return rows
  return rows.map((r) => {
    let out: Record<string, unknown> | null = null
    for (const key of Object.keys(r)) {
      if (known.has(key) || key === 'type') continue
      if (!out) out = { ...r }
      delete out[key]
    }
    return out ?? r
  })
}

/** Drop internal columns from response rows. Rows are copied only when needed. */
export function stripInternalColumns(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => {
    let out: Record<string, unknown> | null = null
    for (const c of INTERNAL_RESPONSE_COLUMNS) {
      if (c in r) { if (!out) out = { ...r }; delete out[c] }
    }
    return out ?? r
  })
}

/**
 * Remove soft-disabled fields from response rows. A `disabled` field keeps its
 * column and data but is hidden from every read surface — this is the read-side
 * enforcement, applied wherever rows are serialized for output (REST get/query/
 * by-slug, expanded relations, the local client). Rows are copied only when a
 * disabled key is actually present.
 */
export function stripDisabledFields(
  rows: Record<string, unknown>[],
  typeDef: { fields: Array<{ name: string; disabled?: boolean }> } | undefined,
): Record<string, unknown>[] {
  if (!typeDef) return rows
  const disabled = typeDef.fields.filter((f) => f.disabled).map((f) => f.name)
  if (disabled.length === 0) return rows
  return rows.map((r) => {
    let out: Record<string, unknown> | null = null
    for (const name of disabled) {
      if (name in r) { if (!out) out = { ...r }; delete out[name] }
    }
    return out ?? r
  })
}

/** Drop writes to soft-disabled fields (silently ignored — kept in schema,
 *  hidden from every surface). Returns the same object when nothing is dropped. */
export function dropDisabledWrites<T extends Record<string, unknown>>(
  values: T,
  typeDef: { fields: Array<{ name: string; disabled?: boolean }> },
): T {
  const disabled = typeDef.fields.filter((f) => f.disabled)
  if (disabled.length === 0) return values
  const out = { ...values }
  for (const f of disabled) delete (out as Record<string, unknown>)[f.name]
  return out
}

/** Field types stored in a Postgres NUMERIC column — the driver returns those
 *  as strings (to preserve precision), so reads must coerce back to numbers. */
const NUMERIC_FIELD_TYPES = new Set(['number', 'currency', 'rating'])

/**
 * Convert NUMERIC-backed field values from the driver's string form back to JS
 * numbers, driven by the type's schema. Without this a `number`/`currency`/
 * `rating` field reads as "20" instead of 20 (REST, SDK, GraphQL). Non-numeric
 * strings and nulls pass through untouched; rows are copied only when changed.
 */
export function coerceNumericFields(
  rows: Record<string, unknown>[],
  typeDef: { fields: Array<{ name: string; fieldType?: string }> } | undefined,
): Record<string, unknown>[] {
  if (!typeDef) return rows
  const numericNames = typeDef.fields.filter((f) => NUMERIC_FIELD_TYPES.has(f.fieldType)).map((f) => f.name)
  if (numericNames.length === 0) return rows
  return rows.map((r) => {
    let out: Record<string, unknown> | null = null
    for (const name of numericNames) {
      const v = r[name]
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
        out ??= { ...r }
        out[name] = Number(v)
      }
    }
    return out ?? r
  })
}

export function applyPublishedSnapshot(
  rows: Record<string, unknown>[],
  statusVal: string | null | undefined,
): Record<string, unknown>[] {
  if (statusVal !== 'published') return rows
  return rows.map((r) => {
    const snap = r.publishedValues as Record<string, unknown> | null | undefined
    if (!snap || typeof snap !== 'object') return r
    const { i18n: _i18n, ...values } = snap
    return { ...r, ...values }
  })
}

export function createLocalClient(options: LocalClientOptions): TangenLocalClient {
  const { db, redis, schema, workspaceId, customTables = [], mail, projects, exec } = options
  // An execution decides this client's authority - `guard` reads
  // exec.actor.identity.kind, and `execution()` falls back to Tangen's own
  // authority when there is none. So an execution handed in from outside the
  // kernel cannot be trusted: an extension holds `clientFor` and could
  // otherwise pass an object whose actor claims any kind it liked, which the
  // extension-only branch of `guard` would then never check.
  //
  // Absent is still fine and unchanged: that is the documented trusted
  // site-code path (a custom route, a field-options lookup).
  if (exec !== undefined && exec !== null) assertKernelExecution(exec)

  return {
    // Custom platform events — site code (custom routes, hooks) publishes
    // 'custom:<name>' through the bus; Flow triggers can subscribe.
    emit(name: string, payload?: Record<string, unknown>): void {
      guard(exec, { kind: 'facility', facility: 'events:emit' })
      const { eventBus } = require('./event-bus') as typeof import('./event-bus')
      eventBus.emit({
        id: globalThis.crypto.randomUUID(), type: `custom:${name}`, workspaceId, timestamp: new Date().toISOString(), actorId: null, actorType: null, source: 'custom-route',
        payload: payload ?? {},
      } as never)
    },

    objects<K extends ContentName>(typeName: K): LocalObjectBuilder<ContentRow<K>> {
      // Runtime is name-based; the row type comes from the registry (or loose).
      return new LocalObjectBuilderImpl(db, redis, schema, workspaceId, {
        typeName,
        statusVal: null,
        filtersVal: null,
        sortFieldVal: null,
        sortDirVal: 'desc',
        limitVal: 20,
        offsetVal: 0,
        afterVal: null,
        depthVal: 0,
        propsVal: null,
        populateVal: null,
        serializeVal: null,
        cacheStrategyVal: null,
        noCacheVal: false,
      }, projects, exec) as unknown as LocalObjectBuilder<ContentRow<K>>
    },

    table<K extends TableName>(name: K): LocalTableBuilder<TableRow<K>> {
      return new LocalTableBuilderImpl(db, workspaceId, customTables, {
        tableName: name,
        filtersVal: null,
        sortFieldVal: null,
        sortDirVal: 'desc',
        limitVal: 20,
        offsetVal: 0,
        propsVal: null,
      }, exec) as unknown as LocalTableBuilder<TableRow<K>>
    },

    globals<K extends GlobalName>(name: K): LocalGlobalsAccessor<GlobalData<K>> {
      return new LocalGlobalsAccessorImpl(db, workspaceId, name, projects, exec) as unknown as LocalGlobalsAccessor<GlobalData<K>>
    },

    validate(values: Record<string, unknown>, fields: FieldDefinition[]): Record<string, string> {
      // Strict mode: this helper exists for handlers to validate user input,
      // so required-field checks must run (draft mode skips them).
      return validateFieldValues(fields, values, 'publish', customFieldTypeResolverFor(workspaceId))
    },

    rateLimit(key: string, max: number, windowSec: number): Promise<RateLimitResult> {
      return checkRateLimit(redis, workspaceId, key, max, windowSec)
    },

    cache<T>(cacheOptions: CacheOptions, fn: () => Promise<T>): Promise<T> {
      if (!redis) return fn()
      return withRouteCache(redis, workspaceId, cacheOptions, fn)
    },

    clearCache(key: string): Promise<void> {
      if (!redis) return Promise.resolve()
      return clearRouteCache(redis, workspaceId, key)
    },

    enqueue(taskId: string, payload?: unknown): Promise<void> {
      guard(exec, { kind: 'facility', facility: 'jobs:enqueue' })
      // K6: the run carries who asked and runs with their authority by default.
      return enqueueTask({ workspaceId, taskId, payload, ...runIdentityFrom(exec ?? null, resolveTaskDefinition(workspaceId, taskId)) })
    },

    // Active = installed and enabled in THIS environment (Phase 4): the
    // per-environment row is the truth, the same answer the hook gates give.
    async hasExtension(extensionId: string): Promise<boolean> {
      if (!extensionId) return false
      const { workspaceInstalledApps } = await import('@tangen/db')
      const rows = await db
        .select({ appId: workspaceInstalledApps.appId })
        .from(workspaceInstalledApps)
        .where(and(
          eq(workspaceInstalledApps.workspaceId, workspaceId),
          eq(workspaceInstalledApps.appId, extensionId),
          eq(workspaceInstalledApps.state, 'installed'),
          eq(workspaceInstalledApps.enabled, true),
        ))
        .limit(1)
      return rows.length > 0
    },

    async sendMail(message: SendMailMessage): Promise<void> {
      if (!mail) {
        throw new RouteError(500, 'No mail service configured - add mail (defineMailConfig) to the workspace config')
      }
      await sendMailViaConfig({ ...mail, workspaceId }, message)
    },

    // Operational labels (system tags) for any entity — entityType is namespaced:
    // 'content:<type>' | 'submission' | 'member' | 'media'. Source recorded as 'api'.

    // K1.5: labels ride on the entity's type - reading them is an object read, changing them an object write.
    labels: {
      list: (entityType: string, entityId: string) => { guard(exec, { kind: 'object', action: 'read', type: entityType }); return listTags(db, { workspaceId, entityType, entityId }) },
      listMany: (entityType: string, entityIds: string[]) => { guard(exec, { kind: 'object', action: 'read', type: entityType }); return listTagsForEntities(db, { workspaceId, entityType, entityIds }) },
      add: (entityType: string, entityId: string, labels: string[]) => {
        guard(exec, { kind: 'object', action: 'write', type: entityType })
        return addTags(db, { workspaceId, entityType, entityId }, labels, { source: 'api' })
      },
      remove: (entityType: string, entityId: string, labels: string[]) => {
        guard(exec, { kind: 'object', action: 'write', type: entityType })
        return removeTags(db, { workspaceId, entityType, entityId }, labels)
      },
      set: (entityType: string, entityId: string, labels: string[]) => {
        guard(exec, { kind: 'object', action: 'write', type: entityType })
        return setTags(db, { workspaceId, entityType, entityId }, labels, { source: 'api' })
      },
      find: (entityType: string, labels: string[], op?: 'all' | 'any' | 'none' | 'contains' | 'starts' | 'ends') => {
        guard(exec, { kind: 'object', action: 'read', type: entityType })
        return filterEntityIds(db, { workspaceId, entityType, tags: labels, op })
      },
    },

    error(status: number, message: string, details?: unknown): RouteError {
      return new RouteError(status, message, details)
    },
  }
}
