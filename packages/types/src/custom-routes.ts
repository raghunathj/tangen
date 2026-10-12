/**
 * File Name: custom-routes.ts
 * Purpose: Type definitions for custom REST routes and the TangenLocalClient API
 *   available inside route handler functions.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Imports from object-types, query, logger, and site-auth.
 */

import type { FieldDefinition, ObjectStatus } from "./object-types";
import type { ContentName, ContentRow, FieldKey, SystemColumnKey, GlobalName, GlobalData, TableName, TableRow, LocaleCode } from "./registry";
import type {
  QueryFilter,
  WhereFilter,
  QueryResult,
  SerializeHint,
  CacheStrategy,
} from "./query";
import type { TangenLogger } from "./logger";
import type { SiteUser } from "./site-auth";

/**
 * Supported HTTP methods for custom route definitions.
 */
export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * Result returned by the rate-limiter check for a given key and window.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Options for route-level response caching via the TangenLocalClient cache helper.
 */
export interface CacheOptions {
  /** Developer-provided cache key — namespaced internally to workspace+env */
  key: string;
  /** TTL in seconds */
  ttl: number;
}

/**
 * Error thrown inside a route handler to return a specific HTTP status code and message.
 */
export class RouteError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = "RouteError";
  }
}

/** One object in a publish plan (a required-relation dependency or a blocker). */
export interface PublishPlanNode {
  typeName: string;
  /** Human label for the type (e.g. "Pin Code City"). */
  typeLabel: string;
  id: string;
  title: string;
  status: string;
  /** Set on a blocker — why it can't be published. */
  reason?: string;
}

/** Publish cascade preview: which draft required-relation targets would be
 * published with an object, and which cannot be. */
export interface PublishPlan {
  needsCascade: boolean;
  dependencies: PublishPlanNode[];
  blockers: PublishPlanNode[];
  /** Whether the CALLER may publish the object now (kernel K4: the preflight asks the action policy). */
  publishAvailable?: boolean;
  /** Every reason it may not: no grant, base-language rights, validation, the cascade, an extension's policy. */
  refusals?: import('./kernel').LifecycleBlocker[];
}

/**
 * Fluent builder for querying and mutating a single content type inside a route handler.
 */
export interface LocalObjectBuilder<T = Record<string, unknown>> {
  where(filters: WhereFilter<T>): LocalObjectBuilder<T>;
  /** A stored status, or `'any'` to read every status (docs/tangenql.md). */
  status(s: ObjectStatus | 'any'): LocalObjectBuilder<T>;
  depth(n: number): LocalObjectBuilder<T>;
  populate(field: FieldKey<T>, props: string[]): LocalObjectBuilder<T>;
  serialize(hints: Record<string, SerializeHint>): LocalObjectBuilder<T>;
  sort(field: FieldKey<T> | SystemColumnKey, direction?: "asc" | "desc"): LocalObjectBuilder<T>;
  limit(n: number): LocalObjectBuilder<T>;
  offset(n: number): LocalObjectBuilder<T>;
  after(cursor: string): LocalObjectBuilder<T>;
  props(fields: FieldKey<T>[]): LocalObjectBuilder<T>;
  cacheStrategy(strategy: CacheStrategy): LocalObjectBuilder<T>;
  /** Serve localized fields in this locale (per-field fallback to the default locale). */
  locale(code: LocaleCode): LocalObjectBuilder<T>;
  noCache(): LocalObjectBuilder<T>;
  get(): Promise<QueryResult<T>>;
  find(id: string): Promise<{ data: T }>;
  findBySlug(slug: string): Promise<{ data: T }>;
  create(payload: {
    title: string;
    values?: Partial<T>;
  }): Promise<{ data: T }>;
  update(id: string, updates: Partial<T>): Promise<{ data: T }>;
  delete(id: string): Promise<{ data: { id: string } }>;
  /** Publish a draft. Pass `{ cascade: true }` to also publish required-relation
   * dependencies (draft targets). Without it, an object with draft required
   * relations rejects with a 409 whose `details` is the {@link PublishPlan}. */
  publish(id: string, opts?: { cascade?: boolean }): Promise<{ data: T }>;
  /** Preview the publish cascade without writing. */
  publishPreflight(id: string): Promise<{ data: PublishPlan }>;
  unpublish(id: string): Promise<{ data: T }>;
}

/**
 * Accessor for reading and writing workspace globals from within a route handler.
 */
export interface LocalGlobalsAccessor<T = Record<string, unknown>> {
  get(): Promise<T>;
  patch(data: Partial<T>): Promise<void>;
  set(data: T): Promise<void>;
}

export interface LocalTableBuilder<T = Record<string, unknown>> {
  where(filters: WhereFilter<T>): LocalTableBuilder<T>;
  sort(field: FieldKey<T> | SystemColumnKey, direction?: "asc" | "desc"): LocalTableBuilder<T>;
  limit(n: number): LocalTableBuilder<T>;
  offset(n: number): LocalTableBuilder<T>;
  props(fields: FieldKey<T>[]): LocalTableBuilder<T>;
  find(): Promise<QueryResult<T>>;
  findOne(id: string): Promise<{ data: T }>;
  create(data: Partial<T>): Promise<{ data: T }>;
  update(id: string, data: Partial<T>): Promise<{ data: T }>;
  delete(id: string): Promise<{ data: { id: string } }>;
}

/**
 * Server-side Tangen client injected into every route handler via ctx.tangen.
 */
/** Message shape for ctx.tangen.sendMail. */
export interface SendMailMessage {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  /** Override the configured from address ("Name <addr>" or plain address). */
  from?: string;
}


export interface TangenLocalClient {
  /** Publish a custom platform event ('custom:<name>') — Flow triggers can subscribe. */
  emit?: (name: string, payload?: Record<string, unknown>) => void
  objects<K extends ContentName>(type: K): LocalObjectBuilder<ContentRow<K>>;
  table<K extends TableName>(name: K): LocalTableBuilder<TableRow<K>>;
  globals<K extends GlobalName>(name: K): LocalGlobalsAccessor<GlobalData<K>>;
  validate(
    values: Record<string, unknown>,
    fields: FieldDefinition[],
  ): Record<string, string>;
  rateLimit(
    key: string,
    max: number,
    windowSec: number,
  ): Promise<RateLimitResult>;
  cache<T>(options: CacheOptions, fn: () => Promise<T>): Promise<T>;
  clearCache(key: string): Promise<void>;
  /**
   * Sends an email through the workspace mail config (config/mail.ts, with
   * formsConfig.mail as fallback). Throws a 500 RouteError when no mail
   * service is configured for the workspace.
   */
  sendMail(message: SendMailMessage): Promise<void>;
  /**
   * Operational labels (system tags) for any entity. `entityType` is namespaced:
   * `'content:<type>'` | `'submission'` | `'member'` | `'media'`. Free-form; writes
   * are recorded with source 'api'. Lets hooks/flows/routes tag + read labels on
   * any record programmatically (mirrors the admin Labels UI + REST /entity-labels).
   */

  labels: {
    list(entityType: string, entityId: string): Promise<string[]>;
    /** The labels of many entities of one type at once, by id (a list, an export); an entity without labels is absent. */
    listMany(entityType: string, entityIds: string[]): Promise<Record<string, string[]>>;
    add(entityType: string, entityId: string, labels: string[]): Promise<string[]>;
    remove(entityType: string, entityId: string, labels: string[]): Promise<void>;
    set(entityType: string, entityId: string, labels: string[]): Promise<string[]>;
    /** The ids of the entities carrying the labels: `all` of them (default), `any`, `none`, or one label by `contains` / `starts` / `ends`. */
    find(entityType: string, labels: string[], op?: 'all' | 'any' | 'none' | 'contains' | 'starts' | 'ends'): Promise<string[]>;
  };
  /**
   * Enqueues a background task (defineTask in app/jobs/tasks/). Runs on the
   * task worker with retries when a queue is available; otherwise executes
   * inline (logged) so work is never silently dropped.
   */
  enqueue(taskId: string, payload?: unknown): Promise<void>;
  /**
   * Whether an extension is installed and active for this workspace -
   * config-resolved (the workspace config's `extensions:` entries) or
   * installed from the admin (a `workspace_installed_apps` row). Use it to
   * depend on another extension conditionally (e.g. only contribute or call
   * something when `review` is present). Cheap single-row lookup, no cache.
   */
  hasExtension(extensionId: string): Promise<boolean>;
  error(status: number, message: string, details?: unknown): RouteError;
}

/**
 * Accessor for reading and updating a site user's profile fields from a route handler.
 */
export interface LocalProfileAccessor {
  /** Read name + all profile field values for a user. */
  get(
    userId: string,
  ): Promise<{ name: string | null; profileMeta: Record<string, unknown> }>;
  /**
   * Write name and/or profile field values for a user.
   * Validates profileMeta against the configured profile fields.
   * Throws RouteError 422 on validation failure.
   */
  update(
    userId: string,
    data: { name?: string | null; profileMeta?: Record<string, unknown> },
  ): Promise<void>;
}

/**
 * Request context injected into every custom route handler, providing request data
 * and the full TangenLocalClient API.
 */
/** Augment this from a site to type `ctx.config.site` (`declare module '@tangen/cms' { interface TangenSiteConfig { checkoutMode: string } }`). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TangenSiteConfig {}

export interface RouteConfig {
  /** A non-secret value by full registry key ('site.checkoutMode', 'cache.defaultTtl'); undefined when unset or secret. */
  get<T = unknown>(key: string): T | undefined
  /** Where a value came from: state, layer and the source that won. */
  explain(key: string): unknown
  /** The site's own non-secret values by declared name. */
  site: TangenSiteConfig & Record<string, unknown>
}

export interface SecretAccessorLike {
  get(name: string): string | undefined
  has(name: string): boolean
  readonly provider: string
}

export interface RouteContext {
  body: unknown;
  query: Record<string, string>;
  params: Record<string, string>;
  headers: Record<string, string>;
  tangen: TangenLocalClient;
  logger: TangenLogger;
  workspaceId: string;
  /**
   * The resolved configuration of this workspace × environment
   * (app/config/site.ts declares the site's keys; values live in the
   * workspace config, per environment, and in the deployment). Non-secret
   * values only; `explain` says where a value came from.
   *
   * @example
   * const mode = ctx.config.site.checkoutMode          // 'live' in production
   * const ttl = ctx.config.get<number>('cache.defaultTtl')
   */
  config: RouteConfig;
  /** A declared integration (`app/config/integrations.ts`), resolved for this workspace and environment; undefined when not declared. */
  integration(name: string): import('./integrations').ResolvedIntegration | undefined;
  /**
   * The privileged boundary for secret material: a site secret by its
   * declared name (`stripeApiKey` → `site.stripeApiKey`), read from THIS
   * deployment's secret provider. Never serializable, never logged.
   *
   * @example
   * const key = ctx.secrets.get('stripeApiKey')
   */
  secrets: SecretAccessorLike;
  sign(payload: Record<string, unknown>, ttl?: string): Promise<string>;
  verify(token: string): Promise<Record<string, unknown> | null>;
  /** The currently authenticated site user, or null if not yet resolved. Populated after requireAuth(). */
  currentUser: SiteUser | null;
  /** Throws RouteError 401 if the site identity provider does not resolve a user from the request (or none is installed). Returns the authenticated user. */
  requireAuth(): Promise<SiteUser>;
  /** Throws RouteError 401 if not authenticated, 403 if role does not match. */
  requireRole(role: string | string[]): Promise<SiteUser>;
  /** Throws RouteError 401 if not authenticated, 403 if user is anonymous. */
  requireIdentified(): Promise<SiteUser>;
  /**
   * Throws 401 if not authenticated, 403 if anonymous, 403 if neither the owner
   * nor a member of an admin role.
   *
   * Pass the `ownerId` of the resource (e.g. `post.createdBy`). Users whose
   * `id` matches are always allowed through. Roles listed in `adminRoles`
   * (default `['admin']`) bypass the ownership check.
   *
   * @example
   * const user = await ctx.requireOwner(post.createdBy)
   * const user = await ctx.requireOwner(order.userId, { adminRoles: ['admin', 'support'] })
   */
  requireOwner(
    ownerId: string | null | undefined,
    options?: { adminRoles?: string[] },
  ): Promise<SiteUser>;
  /** Read and write the authenticated user's profile fields. */
  profile: LocalProfileAccessor;
  /**
   * The validated API key when the route was called with one (auth 'key' or
   * 'any' with a tgn_ token). Null for site-user JWTs and custom auth guards.
   */
  apiKey: { keyId: string; permissions: import("./api-keys").ApiKeyPermissions } | null;
  /**
   * The execution this request is (kernel): the one actor whose authority
   * it exercises (a member, an API key, or the site user), the one workspace,
   * the locale it asked for, and the ids that correlate it with what it
   * causes. Null only when the route admitted the call with no credential.
   */
  exec?: import('./kernel').ExecutionContext | null;
  /**
   * Whether the calling key may perform `action` on this route's apiGroup
   * resource. With `itemKey`, a per-item override in permissions.resources
   * replaces the resource-wide grant. Returns false for keyless callers and
   * for routes without an apiGroup.
   */
  hasPermission(action: string, itemKey?: string): boolean;
  /**
   * The authenticated admin-panel member (auth: 'member' routes). Null for
   * API keys and site users.
   */
  member: { id: string; role: string; permissions: import("./member-permissions").MemberPermissions | { admin: true } } | null;
  /**
   * RBAC check against the member's resolved bundle — same semantics the
   * admin UI uses. resource defaults to 'objects'; item = type name / form
   * slug for per-item overrides. False for non-member callers.
   */
  can(action: string, resource?: 'objects' | 'media' | 'search' | 'schema', item?: string): boolean;
  /** Throws RouteError(403) unless can(...) passes. */
  requireCan(action: string, resource?: 'objects' | 'media' | 'search' | 'schema', item?: string): void;
  /** Throws RouteError(403) unless the member holds the capability (admin passes). */
  requireMemberCapability(capability: import("./member-permissions").Capability): void;
}

/**
 * Custom auth guard function. Throw RouteError to reject; return normally to allow.
 * Use this for HMAC webhooks, third-party token verification, etc.
 */
export type CustomAuthFn = (ctx: RouteContext) => Promise<void> | void;

/**
 * API Manager group declaration for a route.
 * Routes with apiGroup are permission-checked: the caller's key must have
 * permissions.customRoutes[id] containing the declared action.
 */
export interface RouteApiGroup {
  /** Unique ID used as the permission key in the API manager, e.g. 'pincode' */
  id: string;
  /** Display name shown in the API key creation UI */
  label: string;
  /** Action required on the key. Defaults to HTTP-method-derived: GET→read, POST/PUT/PATCH→write, DELETE→delete */
  action?: string;
  /** Optional description shown in the API key creation UI */
  description?: string;
}

/**
 * A single developer-defined REST route registered in a workspace config.
 */
export interface CustomRoute {
  method: HttpMethod;
  path: string;
  /**
   * Auth guard for this route — required, every route must declare its auth posture.
   *
   * - 'key'   — Requires a valid API Manager key (tgn_...). If apiGroup is set, the key
   *             must also have the matching customRoutes permission.
   * - 'user'  — Requires a logged-in site user, resolved by the workspace's site identity
   *             provider (Tangen Auth, or Supabase / Firebase / Clerk through an extension).
   *             ctx.currentUser is guaranteed populated.
   * - 'any'   — Accepts either a valid API Manager key or a site user credential.
   * - 'member' — Requires an admin-panel member session (JWT). ctx.member is
   *              populated with the resolved role + permission bundle; use
   *              ctx.can()/ctx.requireCan()/ctx.requireMemberCapability() for
   *              RBAC checks. The way to build role-aware admin endpoints.
   * - fn      — Custom guard. Throw RouteError to reject; return to allow.
   *             Use for HMAC webhooks (Stripe, Razorpay) or third-party token systems.
   */
  auth: "key" | "user" | "any" | "member" | CustomAuthFn;
  /**
   * Declares this route as a named resource in the API Manager.
   * Only meaningful when auth is 'key' or 'any'.
   * When set, callers need permissions.customRoutes[id] containing the action.
   *
   * String shorthand: the id of a resource declared via defineApiResource()
   * in TangenConfig.apiResources — label/description/action resolve from the
   * declaration (a single-action resource supplies its action; otherwise the
   * action derives from the HTTP method).
   */
  apiGroup?: RouteApiGroup | string;
  /**
   * Logical group name for inheritance control in child workspaces.
   * Routes with a group can be collectively excluded by a child workspace via
   * `excludeRouteGroups` in its TangenConfig. Ungrouped routes are always inherited.
   *
   * @example
   * group: 'payments-stripe'  // child can excludeRouteGroups: ['payments-stripe']
   */
  group?: string;
  handler(ctx: RouteContext): Promise<unknown> | unknown;
}
