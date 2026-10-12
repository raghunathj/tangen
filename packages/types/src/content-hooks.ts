/**
 * File Name: content-hooks.ts
 * Purpose: Content lifecycle hook contracts (beforeChange, afterChange, beforeDelete,
 *   afterDelete) plus the context shapes passed into every hook.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None — pure TypeScript interfaces with no runtime dependencies.
 */

/**
 * Workspace-level globals store — passed into every hook so extensions and
 * site hooks can read/write globally-scoped settings without knowing about
 * Drizzle. The workspaceId is already bound by the factory.
 *
 * `name` is the global slug defined in config/globals.ts, e.g. 'site-settings'.
 */
export interface GlobalsStore {
  /** Read all field values for a named global. Returns {} when not yet saved. */
  get(name: string): Promise<Record<string, unknown>>
  /** Merge-update a named global's data (shallow patch — existing keys not in data are preserved). */
  patch(name: string, data: Record<string, unknown>): Promise<void>
  /** Full replace — overwrites all field values for the named global. */
  set(name: string, data: Record<string, unknown>): Promise<void>
}

/**
 * Abstraction over the extension_data store — passed into every hook so
 * extensions can persist their own data without knowing about Drizzle or raw SQL.
 * The workspaceId is already bound by the factory in the hook runner.
 */
export interface ExtensionDataStore {
  get(extensionId: string, objectId: string): Promise<Record<string, unknown>>
  /**
   * The extension's PUBLISHED state for this object, or null when the object
   * has no published version - it was never published, or it was unpublished.
   *
   * The platform maintains this: publishing an object copies `data` here,
   * and anything else clears it. So an extension that needs to know what the
   * public sees asks for it rather than keeping its own second copy inside
   * `data`, which is what SEO had to do before this existed.
   *
   * Null and `{}` are different answers on purpose: `{}` is a published
   * object whose extension state is empty.
   */
  getPublished(extensionId: string, objectId: string): Promise<Record<string, unknown> | null>
  set(extensionId: string, objectId: string, data: Record<string, unknown>): Promise<void>
  delete(extensionId: string, objectId: string): Promise<void>
}

/**
 * Context passed to beforeChange / afterChange hooks.
 *
 * Check ctx.operation to distinguish create vs update.
 * Check ctx.trigger to detect auto-save ('autosave') vs manual save ('manual').
 * Check ctx.statusChange to detect publish/unpublish transitions.
 *
 * ## Hook execution order
 * Extension hooks run first (in install order), then site hooks. This ordering
 * is guaranteed — site hooks can rely on extension hooks having already written
 * to extension_data. For example: a site hook can call
 * ctx.extensionData.get('seo', objectId) and know the SEO extension's
 * afterChange has already persisted the latest panel data.
 *
 * ## panelData
 * When a save originates from the admin editor, any sidebar panel that has
 * pending changes sends its data keyed by panel ID. The hook runner extracts
 * these and exposes them here as a convenience — you do not need to parse
 * ctx.nextData yourself. For extension hooks this will contain your own panel's
 * data. For site hooks it contains all panels' data, useful for cross-extension logic.
 *
 * Example — reading SEO panel data in a site hook:
 *   const seoPanel = ctx.panelData?.['seo']
 *
 * Note: panelData holds the in-flight values from the current save. To read
 * previously-persisted values use ctx.extensionData.get(extensionId, objectId) instead.
 */
/**
 * Who performed the write that triggered this hook. Absent only on contexts
 * built before the platform threaded identity through (older callers).
 */
export interface ContentHookActor {
  /** Present when an admin member performed the write. */
  memberId?: string
  /** Present when an API key performed the write. */
  apiKeyId?: string
  /** Present when a service or agent identity performed the write (kernel K8); `apiKeyId` is absent then. */
  identityId?: string
  identityKind?: 'service' | 'agent'
  /** The member's role slug, when known. */
  role?: string
  /** admin = member session, rest = API key, system = scheduler / in-process (local client). */
  source: 'admin' | 'rest' | 'system'
}

export interface ContentHookCtx<T = Record<string, unknown>> {
  /**
   * Enqueues a background task (defineTask) — the way to do slow work from a
   * hook without stalling the save. Present on platform-built contexts.
   */
  enqueue?: (taskId: string, payload?: unknown) => Promise<void>

  objectId: string
  typeName: string
  workspaceId: string
  /** Who performed the write (member / API key / system). */
  actor?: ContentHookActor
  /** Whether this is the initial object creation or an update to an existing one */
  operation: 'create' | 'update'
  /** What triggered the change */
  trigger: 'manual' | 'autosave' | 'restore' | 'schedule'
  /** Present only when the object's status changed (e.g. draft → published) */
  statusChange?: { from: string; to: string }
  /**
   * The one locale a localized update writes (K3); null or absent for the
   * base row. `prevData` and `nextData` are then the localized view (the base
   * row with that locale's translations overlaid), and a mutation a hook
   * returns applies to that locale's translation of the field.
   */
  locale?: string | null
  /** Field values before the change — null on create */
  prevData: T | null
  /** Field values being written (excludes internal __panelData_* keys) */
  nextData: T
  /**
   * Panel data submitted alongside this save, keyed by panel ID.
   * Only present when the save originated from the admin editor and at least
   * one sidebar panel had pending changes. Undefined on API-only saves.
   */
  panelData?: Record<string, Record<string, unknown>>
  /** Typed access to extension-scoped persistent storage */
  extensionData: ExtensionDataStore
  /**
   * A per-extension MAC for a value this extension must store somewhere a
   * member can reach. `extension_data` serves both ctx.store and the Admin's
   * panel-data route on one key tuple, so a member with content write can
   * overwrite the row. Sign anything whose integrity a decision depends on -
   * an approval, a verdict - and compare the signature, never the bare value.
   * Absent only in a host that predates it: treat that as "cannot verify" and
   * fail closed.
   */
  sign?: (payload: string) => string
  /**
   * The hook's own extension's typed manifest settings (K7.1, E.7): defaults
   * under the operator's saved values, secrets opened. Present only for a
   * hook contributed by an extension whose manifest declares `settings`;
   * a site hook has none.
   */
  settings?: { get<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T> }
  /** Typed access to workspace-level globals */
  globals: GlobalsStore
}

/**
 * Context passed to beforeDelete / afterDelete hooks.
 * Note: Tangen soft-deletes by setting status='archived'. Hard-deletes are
 * rare admin operations; operation='delete' covers both.
 */
export interface ContentDeleteCtx {
  /** Enqueues a background task (defineTask) — see ContentHookCtx.enqueue. */
  enqueue?: (taskId: string, payload?: unknown) => Promise<void>

  objectId: string
  typeName: string
  workspaceId: string
  /** Who performed the delete (member / API key / system). */
  actor?: ContentHookActor
  operation: 'archive' | 'delete'
  objectData: Record<string, unknown>
  extensionData: ExtensionDataStore
  /**
   * A per-extension MAC for a value this extension must store somewhere a
   * member can reach. `extension_data` serves both ctx.store and the Admin's
   * panel-data route on one key tuple, so a member with content write can
   * overwrite the row. Sign anything whose integrity a decision depends on -
   * an approval, a verdict - and compare the signature, never the bare value.
   * Absent only in a host that predates it: treat that as "cannot verify" and
   * fail closed.
   */
  sign?: (payload: string) => string
  /**
   * The hook's own extension's typed manifest settings (K7.1, E.7): defaults
   * under the operator's saved values, secrets opened. Present only for a
   * hook contributed by an extension whose manifest declares `settings`;
   * a site hook has none.
   */
  settings?: { get<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T> }
  globals: GlobalsStore
}

/**
 * Server-side content lifecycle hooks. Extensions and site developers both
 * implement this interface — it is registered in the extension manifest and
 * in tangen.config.ts.
 *
 * Execution order: extension hooks (in install order) → site hooks.
 *
 * beforeChange may return a partial object to mutate fields before they are
 * written to the database. Return void / undefined to leave data unchanged.
 */
export interface ContentHooks<T = Record<string, unknown>> {
  /**
   * Called before any write (create or update, including publish/unpublish).
   * Return a partial record to override specific fields before the DB write.
   * Throw to abort the operation.
   */
  beforeChange?: (
    ctx: ContentHookCtx<T>,
  ) => Promise<Partial<T> | void> | Partial<T> | void

  /**
   * Called after a successful write. savedData is the row returned by the DB.
   * Use this to sync external systems, save app data, send notifications, etc.
   */
  afterChange?: (
    ctx: ContentHookCtx<T> & { savedData: T },
  ) => Promise<void> | void

  /** Called before archive/delete. Throw to abort. */
  beforeDelete?: (ctx: ContentDeleteCtx) => Promise<void> | void

  /** Called after archive/delete. Use to clean up extension_data rows, external resources, etc. */
  afterDelete?: (ctx: ContentDeleteCtx) => Promise<void> | void
}
