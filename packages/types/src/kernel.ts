/**
 * File Name: kernel.ts
 * Purpose: The public subsets of the framework kernel's execution model
 *          (tasks/plan-framework-kernel.md §4, §7, §11): who is acting
 *          (ActorContext), where and why the code runs (ExecutionContext),
 *          and the locale the execution reads and writes (LocaleContext).
 *          Site code meets these on RouteContext.exec and JobContext.exec;
 *          nothing here is a credential, a session or a secret.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Authority is explicit on the actor: the admin and
 *          superadmin fast paths are flags, never inferred from a member id
 *          or a role string inside a guard. `system` is an actor kind with a
 *          reason, reserved for work where Tangen itself holds the authority.
 */
import type { ApiKeyPermissions } from './api-keys'
import type { MemberPermissions } from './member-permissions'

/** Who can act. `service` and `agent` are identities (K8): records that hold authority and own keys as credentials; `extension` is an extension acting as itself under its compiled grants (Extension Kernel K1). */
export type ActorKind = 'member' | 'api_key' | 'system' | 'site_user' | 'service' | 'agent' | 'extension'

/** The record an actor resolves from. For `system` the id is the reason. */
export interface ActorIdentity {
  kind: ActorKind
  id: string
}

/** Which locales an actor may write: every locale, the base locale only, or a list of codes. */
export type LocaleScope = 'all' | 'base' | string[]

/**
 * What the actor may do, stated in full. The bundle carries grants and
 * never the admin sentinel; `admin` and `superadmin` are the two fast paths
 * as flags; `capabilities` are the member-only management rights.
 */
export interface ActorAuthority {
  bundle: ApiKeyPermissions | MemberPermissions
  admin: boolean
  superadmin: boolean
  capabilities: string[]
  locales: LocaleScope
  /**
   * Facility grants an extension holds (`db:own`, `ai:generate`,
   * `jobs:enqueue`, `events:emit`, `delegation:act-as`, `network:<host>`;
   * Extension Kernel K1). Absent for every other kind: a member, a key or
   * the system are never facility-gated.
   */
  facilities?: string[]
}

/** Whose authority one execution exercises. Exactly one per execution. */
export interface ActorContext {
  identity: ActorIdentity
  /** The one workspace this actor acts in. */
  workspaceId: string
  /** The member's role slug; null for every other kind. */
  role: string | null
  authority: ActorAuthority
  /** The identity whose authority is used when it differs from the credential (the Playground's member behind a key, a site user behind a site key). */
  onBehalfOf: ActorIdentity | null
  /** Why a `system` actor exists: `scheduler`, `release`, `porter`, `cli`, `job:<id>`, `extension:<id>`. Null for the other kinds. */
  reason: string | null
}

/** Where the code runs. Jobs, flows and the scheduler are executions, not actors. */
export type ExecutionKind = 'request' | 'job' | 'flow' | 'scheduler' | 'release' | 'porter' | 'cli' | 'agent'

/** The transport the execution came through. */
export type ExecutionSource =
  | 'admin' | 'rest' | 'sdk' | 'graphql' | 'mcp' | 'extension' | 'site'
  | 'flow' | 'job' | 'scheduler' | 'cli' | 'release' | 'porter'

/** How a read resolves locales: the base row, one locale overlaid, or the translations map. */
export type LocaleRead =
  | { mode: 'base' }
  | { mode: 'overlay'; locale: string }
  | { mode: 'map'; locales: string[] | 'all' }

/** The locale axis of one execution, resolved once from the request and the workspace. */
export interface LocaleContext {
  /** What the request asked for, verbatim; null when it named none. */
  requested: string | null
  /** Whether the workspace has localization on. */
  enabled: boolean
  /** The workspace's default locale; null when localization is off. */
  default: string | null
  read: LocaleRead
  /** The one locale a localized write targets; null for the base row. */
  write: string | null
  /**
   * The refusal, when the request named a locale this execution cannot use
   * (an unknown code, localization off, `all` on a workspace without it for
   * a key). `read` and `write` are then the base; an operation refuses on it.
   */
  invalid: string | null
}

/** One execution: a request, a job run, a flow run, a scheduler tick, an agent call. */
export interface ExecutionContext {
  /** The execution's own id: the request id, the job run id, the tick id. */
  id: string
  kind: ExecutionKind
  /** Exactly one workspace. */
  workspaceId: string
  actor: ActorContext
  /** Who caused this execution when that differs from the actor (the member who enqueued, the approver of a release). */
  initiator: ActorIdentity | null
  /** The first execution in the chain; equals `id` at the head. */
  correlationId: string
  /** The execution or event that caused this one; null at the head. */
  causationId: string | null
  locale: LocaleContext
  source: ExecutionSource
  startedAt: string
}

/** The run a job context is built for (task, scheduled or cron), so its execution has a reason and an id. */
export interface JobRunRef {
  kind: 'task' | 'scheduled' | 'cron'
  /** The task or job id. */
  id: string
  /** The run's own id when the runner has one; otherwise the execution mints one. */
  runId?: string
  /** The actor the run uses (K6), resolved at execution; absent = Tangen's own with the reason job:<id>. */
  actor?: ActorContext
  /** Who caused the run when that differs from the actor. */
  initiator?: ActorIdentity | null
  correlationId?: string | null
  causationId?: string | null
  attempt?: number
}

// ── The lifecycle action policy (kernel plan §6; GET /objects/:type/:id/actions) ──

export type LifecycleActionId = 'save' | 'publish' | 'unpublish' | 'schedule' | 'unschedule' | 'stage' | 'archive' | 'restore' | `ext:${string}`

/** Why an action is not available: no grant, the object is new, the status forbids it, validation fails, a required relation cannot publish, an extension's policy stands in the way. */
export type LifecycleBlockerCode = 'FORBIDDEN' | 'NEW' | 'STATE' | 'VALIDATION' | 'CASCADE' | 'POLICY'

export interface LifecycleBlocker {
  code: LifecycleBlockerCode
  reason: string
  /** The extension whose policy blocks (POLICY). */
  extensionId?: string
  /** The label the extension asks the surface to put on the fallback (POLICY, "Save as draft" by default). */
  actionLabel?: string
  /** The cascade plan (CASCADE): what would publish alongside and what cannot. */
  plan?: import('./custom-routes').PublishPlan
}

export interface LifecycleAction {
  id: LifecycleActionId
  label: string
  /** May this actor perform it on this object now. */
  available: boolean
  blockers: LifecycleBlocker[]
  /** The REST call that performs it, relative to /api/v1 (an extension's action is relative to /api/v1/admin/ext/<id>/). */
  method: 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: Record<string, unknown>
  /** When publishing needs the cascade: the dependencies that publish alongside. */
  cascade?: { dependencies: import('./custom-routes').PublishPlan['dependencies'] }
  /** Offered by an extension in place of a blocked action. */
  replaces?: LifecycleActionId
  extensionId?: string
}

/** The server's answer for one type (id null: a new object) or one object, for the calling actor. */
export interface LifecycleActions {
  type: string
  id: string | null
  state: {
    status: import('./object-types').ObjectStatus | null
    scheduledAt: string | null
    /** Live values ahead of the published snapshot (null for a new object). */
    hasDraftChanges: boolean | null
  }
  actions: LifecycleAction[]
}
