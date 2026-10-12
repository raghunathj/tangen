/**
 * File Name: write.ts
 * Purpose: The canonical content writes (kernel plan §2, K3): one
 *          implementation of create, update and delete that every transport
 *          calls with an ExecutionContext. Policy, field access, validation,
 *          the before-change hooks, the transaction with attribution and the
 *          revision, the event, the after-change hooks and cache invalidation
 *          happen here for a REST call, the local client, GraphQL and MCP
 *          alike - the local client's own copies that skipped revision,
 *          event and attribution are gone.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The implementation is the REST handler body
 *          (routes/objects/{create,update,delete}.ts), which the REST route
 *          still calls directly for its Response shaping; this module hands
 *          it a context built from the execution (legacyIdentityOf) so the
 *          handler reads the same decorations it always read. When the
 *          handlers move onto `exec` the seam disappears; the operation
 *          signature does not change.
 */
import type { ExecutionContext, SchemaDefinition, WorkspaceProject } from '@tangen/types'
import { legacyIdentityOf } from '../../kernel/actor'
import { eventBus as processEventBus } from '../../services/event-bus'
import { makeCreateHandler } from '../../routes/objects/create'
import { makeUpdateHandler } from '../../routes/objects/update'
import { makeDeleteHandler } from '../../routes/objects/delete'

export interface ContentWriteDeps {
  db: any
  redis: any
  schema: SchemaDefinition
  /** The workspace projects: content hooks, components, localization. */
  projects: WorkspaceProject[] | any[]
  /** The bus to emit on; the process bus when absent. */
  eventBus?: { emit(event: unknown): void }
  /** The search projection to keep in step inside the transaction, when the runtime has one. */
  searchEngineRef?: unknown
  /** The transport's response sink and request, when there is one (restricted-field header, If-Match). */
  transport?: { request?: Request; set?: { headers: Record<string, string>; status?: number } }
}

export interface ContentWriteResult {
  data: Record<string, unknown>
  /** Non-blocking guidance per field (B4). */
  warnings?: Record<string, string>
}

function contextFor(exec: ExecutionContext, deps: ContentWriteDeps, extra: Record<string, unknown>): Record<string, unknown> {
  if (!exec?.actor) throw new Error('A content write needs an execution with an actor')
  return {
    ...legacyIdentityOf(exec.actor),
    exec,
    workspaceId: exec.workspaceId,
    db: deps.db, redis: deps.redis, schema: deps.schema,
    eventBus: deps.eventBus ?? processEventBus,
    workspaceProjects: deps.projects,
    searchEngineRef: deps.searchEngineRef,
    request: deps.transport?.request,
    set: deps.transport?.set ?? { headers: {} },
    ...extra,
  }
}

/** Creates one object in the base locale. `status` defaults to draft; `published` needs the publish grant. */
export async function contentCreate(
  exec: ExecutionContext,
  input: { typeName: string; title: string; slug?: string | null; status?: 'draft' | 'published' | 'archived'; values?: Record<string, unknown> },
  deps: ContentWriteDeps,
): Promise<ContentWriteResult> {
  const body = {
    type: input.typeName, title: input.title,
    ...(input.slug ? { slug: input.slug } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.values ?? {}),
  }
  const res = await makeCreateHandler(deps.projects)(contextFor(exec, deps, { body, query: {}, params: {} }))
  // The handler answers a 201 Response for the REST transport; the operation answers data.
  if (res instanceof Response) return (await res.json()) as ContentWriteResult
  return res as ContentWriteResult
}

/** Updates one object: the base row, or one locale's translation when `locale` is set. */
export async function contentUpdate(
  exec: ExecutionContext,
  input: { typeName: string; id: string; updates: Record<string, unknown>; locale?: string | null; trigger?: 'manual' | 'autosave' },
  deps: ContentWriteDeps,
): Promise<ContentWriteResult> {
  const query: Record<string, unknown> = { type: input.typeName }
  if (input.locale) query.locale = input.locale
  if (input.trigger === 'autosave') query.noRevision = '1'
  return (await makeUpdateHandler(deps.projects)(contextFor(exec, deps, { body: input.updates, query, params: { id: input.id } }))) as ContentWriteResult
}

/** Archives one object (content is never hard-deleted). */
export async function contentDelete(
  exec: ExecutionContext,
  input: { typeName: string; id: string },
  deps: ContentWriteDeps,
): Promise<{ data: Record<string, unknown> }> {
  return (await makeDeleteHandler(deps.projects)(contextFor(exec, deps, { query: { type: input.typeName }, params: { id: input.id } }))) as { data: Record<string, unknown> }
}
