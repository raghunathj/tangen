/**
 * File Name: query-builder.ts
 * Purpose: Provides ObjectQueryBuilder — a chainable, immutable query builder for
 * the Tangen SDK. Each method returns a new builder instance so queries can be
 * composed safely without mutating shared state.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types (QueryFilter, QueryResult, SerializeHint), ./client (HttpClient)
 */
import type { QueryFilter, WhereFilter, FieldKey, SystemColumnKey, LocaleCode, QueryResult, SerializeHint } from '@tangen/types'
import type { HttpClient, RequestOptions } from './client'

/** One object in a publish plan (a required-relation dependency or a blocker). */
export interface PublishPlanNode {
  typeName: string
  /** Human label for the type (e.g. "Pin Code City"). */
  typeLabel: string
  id: string
  title: string
  status: string
  /** Set on a blocker — why it can't be published. */
  reason?: string
}

/** The publish cascade preview returned by {@link ObjectQueryBuilder.publishPreflight}. */
export interface PublishPlan {
  needsCascade: boolean
  /** Non-published required-relation targets that would be published with the object. */
  dependencies: PublishPlanNode[]
  /** Targets that cannot be published (their own required fields fail). */
  blockers: PublishPlanNode[]
}

/** Internal accumulator for query state — passed immutably between builder instances. */
interface QueryState {
  query?: QueryFilter
  depth?: number
  populate?: Record<string, string[]>
  serialize?: Record<string, SerializeHint>
  sort?: { field: string; direction: 'asc' | 'desc' }
  limit?: number
  offset?: number
  after?: string
  props?: string[]
  locale?: string
  status?: 'published' | 'draft' | 'archived' | 'any'
  /** false skips the exact total; meta.total is null and meta.hasMore is exact. */
  total?: boolean
}

/**
 * Chainable, immutable query builder for a single Tangen content type.
 * Construct one via TangenClient.objects(typeName).
 */
export class ObjectQueryBuilder<T = Record<string, unknown>> {
  constructor(
    private readonly http: HttpClient,
    private readonly typeName: string,
    private readonly state: QueryState = {},
  ) {}

  /**
   * Apply filter conditions to the query.
   * @param filters - Field-keyed filter map (e.g. { status: { eq: 'published' } }).
   * @returns A new ObjectQueryBuilder with the filter applied.
   */
  where(filters: WhereFilter<T>): ObjectQueryBuilder<T> {
    return new ObjectQueryBuilder<T>(this.http, this.typeName, { ...this.state, query: filters })
  }

  /**
   * Set relation expansion depth. 0 = IDs only, 1 = one level of relations expanded.
   * @param n - Depth level.
   * @returns A new ObjectQueryBuilder with the depth set.
   */
  depth(n: number): ObjectQueryBuilder<T> {
    return new ObjectQueryBuilder<T>(this.http, this.typeName, { ...this.state, depth: n })
  }

  /**
   * Project an expanded relation to specific columns (id is always included).
   * Combine with .depth(1+) — projection alone does not trigger expansion.
   * @param field - The relation field name on this type.
   * @param props - Column names to return for the expanded records.
   * @returns A new ObjectQueryBuilder with the projection applied.
   */
  populate(field: FieldKey<T>, props: string[]): ObjectQueryBuilder<T> {
    return new ObjectQueryBuilder<T>(this.http, this.typeName, {
      ...this.state,
      populate: { ...(this.state.populate ?? {}), [field]: props },
    })
  }

  /**
   * Provide serialization hints for richtext fields (e.g. render as HTML or plain text).
   * @param hints - Field-keyed serialize hints.
   * @returns A new ObjectQueryBuilder with serialize hints applied.
   */
  serialize(hints: Record<string, SerializeHint>): ObjectQueryBuilder<T> {
    return new ObjectQueryBuilder<T>(this.http, this.typeName, { ...this.state, serialize: hints })
  }

  /**
   * Sort results by a field.
   * @param field - The field name to sort by.
   * @param direction - Sort direction. Defaults to 'desc'.
   * @returns A new ObjectQueryBuilder with the sort applied.
   */
  sort(field: FieldKey<T> | SystemColumnKey, direction: 'asc' | 'desc' = 'desc'): ObjectQueryBuilder<T> {
    return new ObjectQueryBuilder<T>(this.http, this.typeName, { ...this.state, sort: { field, direction } })
  }

  /**
   * Limit the number of results returned.
   * @param n - Maximum number of results.
   * @returns A new ObjectQueryBuilder with the limit applied.
   */
  limit(n: number): ObjectQueryBuilder<T> {
    return new ObjectQueryBuilder<T>(this.http, this.typeName, { ...this.state, limit: n })
  }

  /**
   * Whether to compute the exact `meta.total` (default true). Pass false when
   * paginating by cursor or when only `meta.hasMore` is needed: the server then
   * skips the count, which is the dominant cost of a list over a large type.
   * @param include - false to skip the exact total.
   * @returns A new ObjectQueryBuilder with the setting applied.
   */
  total(include: boolean): ObjectQueryBuilder<T> {
    return new ObjectQueryBuilder<T>(this.http, this.typeName, { ...this.state, total: include })
  }

  /**
   * Skip the first N results (for pagination).
   * @param n - Number of results to skip.
   * @returns A new ObjectQueryBuilder with the offset applied.
   */
  offset(n: number): ObjectQueryBuilder<T> {
    return new ObjectQueryBuilder<T>(this.http, this.typeName, { ...this.state, offset: n })
  }

  /**
   * Paginate by cursor: pass meta.nextCursor from the previous page.
   * Mutually exclusive with .offset() — keyset pagination stays stable
   * under concurrent inserts, unlike offsets.
   * @param cursor - The nextCursor value from the previous QueryResult.
   * @returns A new ObjectQueryBuilder starting after that cursor.
   */
  after(cursor: string): ObjectQueryBuilder<T> {
    return new ObjectQueryBuilder<T>(this.http, this.typeName, { ...this.state, after: cursor })
  }

  /**
   * Restrict the fields returned in each result object.
   * @param fields - Array of field names to include in the response.
   * @returns A new ObjectQueryBuilder with the field projection applied.
   */
  props(fields: FieldKey<T>[]): ObjectQueryBuilder<T> {
    return new ObjectQueryBuilder<T>(this.http, this.typeName, { ...this.state, props: fields })
  }

  /**
   * Serve localized fields in this locale (translations fall back to the
   * default locale per field). Requires the workspace localization module.
   * @param code - A locale code from the workspace config, e.g. 'ta'.
   * @returns A new ObjectQueryBuilder scoped to that locale.
   */
  locale(code: LocaleCode): ObjectQueryBuilder<T> {
    return new ObjectQueryBuilder<T>(this.http, this.typeName, { ...this.state, locale: code })
  }

  /**
   * Which lifecycle state to read. API keys serve 'published' (the snapshot
   * frozen at publish) by default; 'draft' / 'any' require the key's
   * objects `read_draft` grant — preview keys.
   * @param s - 'published' (default) | 'draft' | 'archived' | 'any'.
   * @returns A new ObjectQueryBuilder scoped to that status.
   */
  status(s: 'published' | 'draft' | 'archived' | 'any'): ObjectQueryBuilder<T> {
    return new ObjectQueryBuilder<T>(this.http, this.typeName, { ...this.state, status: s })
  }

  /**
   * Execute the query and return a paginated list of results.
   * @returns A QueryResult containing data and pagination meta.
   */
  async get(opts?: RequestOptions): Promise<QueryResult<T>> {
    return this.http.post(`/objects/${this.typeSegment()}/query`, { ...this.state }, opts)
  }

  /** URL-encoded type segment for resource-style paths. */
  private typeSegment(): string {
    return encodeURIComponent(this.typeName)
  }

  /**
   * Fetch a single object by its ID.
   * @param id - The object UUID.
   * @returns The object wrapped in a data envelope.
   */
  async find(id: string, opts?: RequestOptions): Promise<{ data: T }> {
    const params = new URLSearchParams()
    if (this.state.depth !== undefined) params.set('depth', String(this.state.depth))
    if (this.state.serialize !== undefined) params.set('serialize', JSON.stringify(this.state.serialize))
    if (this.state.locale !== undefined) params.set('locale', this.state.locale)
    if (this.state.status !== undefined) params.set('status', this.state.status)
    const qs = params.size > 0 ? `?${params}` : ''
    return this.http.get(`/objects/${this.typeSegment()}/${encodeURIComponent(id)}${qs}`, opts)
  }

  /**
   * Fetch a single object by its slug.
   * @param slug - The URL-safe slug.
   * @returns The object wrapped in a data envelope.
   */
  async findBySlug(slug: string, opts?: RequestOptions): Promise<{ data: T }> {
    const params = new URLSearchParams()
    if (this.state.depth !== undefined) params.set('depth', String(this.state.depth))
    if (this.state.serialize !== undefined) params.set('serialize', JSON.stringify(this.state.serialize))
    if (this.state.locale !== undefined) params.set('locale', this.state.locale)
    if (this.state.status !== undefined) params.set('status', this.state.status)
    const qs = params.size > 0 ? `?${params}` : ''
    return this.http.get(`/objects/${this.typeSegment()}/by-slug/${encodeURIComponent(slug)}${qs}`, opts)
  }

  /**
   * Create a new object of this type.
   *
   * `title` and `slug` are properties of the object itself; everything else
   * goes in `values`, which carries the type's declared fields. Omit `slug`
   * and the server derives one from the title, appending `-1`, `-2` … if it
   * is taken.
   *
   * @param payload - Title, optional slug, and optional field values.
   * @returns The created object wrapped in a data envelope.
   */
  async create(payload: { title: string; slug?: string; values?: Partial<T> }, opts?: RequestOptions): Promise<{ data: T }> {
    return this.http.post(`/objects/${this.typeSegment()}`, {
      title: payload.title,
      // Only when given: an explicit `slug: undefined` in the body would be
      // dropped by JSON anyway, but sending the key at all invites a reader to
      // think an empty slug means something. It does not - absence does.
      ...(payload.slug !== undefined ? { slug: payload.slug } : {}),
      ...payload.values,
    }, opts)
  }

  /**
   * Update an existing object by ID.
   * @param id - The object UUID.
   * @param updates - Partial field values to merge into the object.
   * @param opts.ifMatch - The object's ETag, from the `ETag` header of the
   *   read this edit is based on. With it the write is conditional: if the
   *   object changed since, it is refused with `STALE_OBJECT` (409) instead
   *   of overwriting the newer version. Without it the write is blind.
   * @returns The updated object wrapped in a data envelope.
   */
  async update(id: string, updates: Partial<T>, opts?: { ifMatch?: string } & RequestOptions): Promise<{ data: T }> {
    return this.http.patch(
      `/objects/${this.typeSegment()}/${encodeURIComponent(id)}`,
      updates,
      opts?.ifMatch ? { 'If-Match': opts.ifMatch } : undefined,
      opts,
    )
  }

  /**
   * Delete an object by ID.
   * @param id - The object UUID.
   * @returns The deleted object's ID wrapped in a data envelope.
   */
  async delete(id: string, opts?: RequestOptions): Promise<{ data: { id: string } }> {
    return this.http.delete(
      `/objects/${this.typeSegment()}/${encodeURIComponent(id)}`,
      opts,
    )
  }

  /**
   * Publish a draft object, moving it to 'published' status.
   *
   * If the object has **required `relation`** fields pointing at draft targets,
   * a plain publish rejects with a 409 `NEEDS_CASCADE` error carrying the plan —
   * call {@link publishPreflight} to inspect it, then publish with
   * `{ cascade: true }` to publish those dependencies too (dependency order).
   * @param id - The object UUID.
   * @param opts.cascade - Also publish required-relation dependencies.
   * @returns The published object wrapped in a data envelope.
   */
  async publish(id: string, opts?: { cascade?: boolean } & RequestOptions): Promise<{ data: T }> {
    const q = opts?.cascade ? '?cascade=true' : ''
    return this.http.post(
      `/objects/${this.typeSegment()}/${encodeURIComponent(id)}/publish${q}`,
      {},
      opts,
    )
  }

  /**
   * Preview the publish cascade without writing: which non-published
   * required-relation targets would be published ({@link PublishPlan.dependencies})
   * and which cannot be ({@link PublishPlan.blockers}).
   * @param id - The object UUID.
   */
  async publishPreflight(id: string, opts?: RequestOptions): Promise<{ data: PublishPlan }> {
    return this.http.post(
      `/objects/${this.typeSegment()}/${encodeURIComponent(id)}/publish/preflight`,
      {},
      opts,
    )
  }

  /**
   * Unpublish a published object, moving it back to 'draft' status.
   * @param id - The object UUID.
   * @returns The unpublished object wrapped in a data envelope.
   */
  async unpublish(id: string, opts?: RequestOptions): Promise<{ data: T }> {
    return this.http.post(
      `/objects/${this.typeSegment()}/${encodeURIComponent(id)}/unpublish`,
      {},
      opts,
    )
  }

  /**
   * Schedule this object to publish at a future time. The scheduler performs
   * the publish with no caller, so scheduling needs the same rights as
   * publishing.
   *
   * NOTE: this is the one content route Phase 6A did not canonicalize - the
   * server takes the object id in the path and the type in `?type=`. The SDK
   * calls it as it stands rather than inventing a second shape; see
   * docs/archive/pre-v1/phase-7-inventory.md, finding 7-4.
   *
   * @param id - The object UUID.
   * @param at - When to publish: a Date, or an ISO 8601 string. Must be in the future.
   */
  async schedule(id: string, at: Date | string, opts?: RequestOptions): Promise<{ data: T }> {
    const scheduledAt = typeof at === 'string' ? at : at.toISOString()
    return this.http.post(
      `/objects/${encodeURIComponent(id)}/schedule?type=${this.typeSegment()}`,
      { scheduledAt },
      opts,
    )
  }

  /** Clear a scheduled publish. The object keeps its current status. */
  async unschedule(id: string, opts?: RequestOptions): Promise<{ data: T }> {
    return this.http.delete(
      `/objects/${encodeURIComponent(id)}/schedule?type=${this.typeSegment()}`,
      opts,
    )
  }
}
