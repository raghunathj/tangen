/**
 * File Name: extension.ts
 * Purpose: Extension manifest and lifecycle types; every Tangen extension exports
 *   a TangenExtensionManifest as its default via defineExtension().
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Imports ContentHooks from content-hooks and ExtensionDashboardWidget from dashboard.
 */

/**
 * Extension context passed to lifecycle hooks — identifies which workspace/env
 * the extension is being installed into.
 */
import type { ExtensionSettingsDefinition } from './extension-settings'
import type { ExtensionSlotContribution } from './admin-slots'

export interface ExtensionContext {
  workspaceId: string
}

/**
 * A custom field type contributed by an extension. The admin panel discovers
 * these at startup and makes them available alongside built-in field types.
 */
export interface CustomFieldTypeDef {
  /** Unique machine name, e.g. 'seo-metadata'. Must be globally unique across all installed extensions. */
  name: string
  /** Human-readable label shown in the field type picker */
  label: string
  /** Optional description shown as a tooltip */
  description?: string
  /** Icon for the field-type picker — an @tangen/icons name (e.g. 'IconSearch') or a custom `{ src }` image. */
  icon?: import('./object-types').IconRef
  /**
   * The built-in primitive this custom type inherits — drives physical storage
   * shape, baseline validation (min/max, pattern, required…), filter operators
   * and the AI value-shape. Custom validation + a custom input are layered on top
   * (server entry `fieldTypes` + admin `defineFieldTypeUI`). Defaults to `'text'`.
   */
  inherits?: import('./object-types').FieldType
  /** JSON-serialisable schema describing the per-field config options this type accepts */
  configSchema?: Record<string, unknown>
  /**
   * Content AI participation for fields of this type. valueShape tells the
   * AI coercion layer what the field stores ('string' default); hint explains
   * what to write; enabled:false opts the type out of AI entirely.
   */
  ai?: { enabled?: boolean; hint?: string; valueShape?: 'string' | 'string[]' | 'json' }
  /**
   * Schema-builder controls to hide for fields of this type (general option
   * suppression). Each entry is a control PATH/prefix — hides the control whose
   * path equals it or starts with `<entry>.`, e.g. `'config.ai'` (whole AI
   * section), `'config.localized'`, `'config.default'`. `ai.enabled: false` is
   * sugar for `'config.ai'`. Mirrors `SiteFieldTypeDef.hideControls`.
   */
  hideControls?: string[]
}

/**
 * How an extension panel is rendered in the object editor center stage.
 *
 * - `'inline'`  — the component is rendered directly as a collapsible section
 *                 below the main content fields (default).
 * - `'modal'`   — a card with the extension label + a button is rendered; clicking
 *                 opens a full Dialog containing the component.
 */
export type ExtensionPanelRenderMode = 'inline' | 'modal'

/**
 * A panel contributed by an extension. Panels always render in the center
 * stage of the object editor (below the main content fields), never in the sidebar.
 */
/** A field an extension panel exposes to Content AI (tangen field types). */
export interface PanelAIField {
  name: string
  label: string
  fieldType: string
  config?: Record<string, unknown>
}

export interface ExtensionSidebarPanel {
  /** Unique panel ID within this extension */
  id: string
  /** Label shown in the panel header / card title */
  label: string
  /** Panel icon — an @tangen/icons name (e.g. 'IconSearch') or a custom `{ src }` image. */
  icon?: import('./object-types').IconRef
  /**
   * Content AI participation — OFF by default. Set enabled: true and declare
   * the panel's data fields using tangen field types; the AI Assistant can
   * then generate all of them in one shot (the panel gets an AI affordance
   * that opens the assistant tagged with this panel). `instructions` is the
   * extension developer's guardrail — it is appended to the system prompt of
   * every generation for this panel.
   */
  ai?: { enabled?: boolean; instructions?: string; fields: PanelAIField[] }
  /**
   * Object type slugs this panel appears on. Omit (or pass an empty array) to
   * show on every object type.
   */
  types?: string[]
  /**
   * NAMED EXPORT of the extension's client entry (src/index.ts) that renders
   * this panel — e.g. 'SeoPanel'. The admin build resolves it from the
   * extension's resolve path at build time.
   */
  component: string
  /**
   * Controls how the panel is presented in the center stage.
   * Defaults to `'inline'`.
   */
  renderMode?: ExtensionPanelRenderMode
  /** Where the panel renders in the object editor: 'main' (default) is a
   *  center-stage card below the fields; 'sidebar' is a compact card in the
   *  right rail (renderMode 'modal' is ignored there). */
  placement?: 'main' | 'sidebar'
  /**
   * Label for the call-to-action button shown when `renderMode` is `'modal'`.
   * Defaults to `'Open'`.
   */
  buttonLabel?: string
}

/**
 * The manifest that every Tangen extension must export as its default export
 * from `tangen.extension.ts`. Describes what the extension contributes to the
 * platform.
 */
/**
 * A single route entry for breadcrumb resolution.
 * `path` uses `:param` to match any dynamic segment (UUID, slug, etc.).
 * Segments are matched positionally after the extension root.
 *
 * @example
 *   { path: '',            label: 'Forms' }       // /extensions/forms
 *   { path: ':id',         label: 'Form' }         // /extensions/forms/{uuid}
 *   { path: 'submissions', label: 'Submissions' }  // /extensions/forms/submissions
 *   { path: 'settings',    label: 'Settings' }     // /extensions/forms/settings
 */
export interface ExtensionRoute {
  path: string
  label: string
}

/**
 * A full admin page contributed by a package extension. Pages mount at
 * `/:workspaceId/:env/extensions/<extensionId>/<path>` and only exist while
 * the extension is installed and active in the workspace.
 *
 * Like sidebar panels, `component` is the NAME of an export of the
 * extension's browser-safe client entry (src/index.ts) — the admin build
 * resolves it statically; the manifest itself never holds function values.
 */
export interface ExtensionPageDef {
  /**
   * Path relative to the extension root — '' mounts at
   * /extensions/<extensionId> itself; may include React Router params
   * (e.g. 'records/:id'). Must not start with '/'.
   */
  path: string
  /** Named export of src/index.ts that renders the page (no injected props — use useParams()). */
  component: string
  /** When present, a nav entry appears in the sidebar's Extensions section. */
  nav?: import('./admin-extension').AdminNavEntry
  /** Who can open this page — others get the No-permission state and lose the nav item. */
  access?: import('./admin-extension').AdminAccessRule
}

/**
 * An RBAC capability declared by an extension manifest. Merged into the
 * roles editor's option list for workspaces where the extension is
 * installed, and honored by the server's capability checks. Browser-safe
 * JSON only — ids are namespaced `scope:name` strings.
 */
export interface ExtensionCapabilityDef {
  /** Namespaced capability id, e.g. 'review:approve'. */
  id: import('./member-permissions').ExtensionCapabilityId
  /** Label shown in the roles editor. */
  label: string
  /** Optional longer explanation for the roles editor. */
  description?: string
  /**
   * Capabilities a holder of THIS capability also gets (superset ⇒ subset),
   * e.g. `manage:flows` implies `read:flows`.
   */
  implies?: import('./member-permissions').ExtensionCapabilityId[]
  /**
   * Platform gates this capability opens (kernel K7), so core never names
   * an extension's capability: `content.rawCss` lets a holder write raw CSS
   * on a block's reserved `_studio` bag.
   */
  gates?: string[]
}

/**
 * One realtime channel an extension publishes on (Realtime R4). Clients
 * subscribe to the topic `ext:<extensionId>:<name>`; the server publishes
 * through `ctx.realtime.publish({ channel: name, ... })`.
 */
export interface ExtensionRealtimeChannel {
  /** Channel name: lowercase, `[a-z][a-z0-9_-]*`, at most 64 characters, unique within the extension. */
  name: string
  /**
   * The capability a member must hold to subscribe (an id the extension
   * declares in `capabilities`, or a platform one). Omitted: any member of
   * the workspace may subscribe. API keys never may: extension channels are
   * an admin surface.
   */
  capability?: string
}

/**
 * A dependency on another extension (manifest v1). A bare id means any
 * version; `version` is a range the installed extension's version must
 * satisfy: `1.2.3`, `^1.2`, `~1.2.3`, `>=1.2.0`, `>=1.0.0 <2.0.0`, `*`.
 */
export type ExtensionDependency = string | { id: string; version?: string }

/** One grant, bare or with the publisher's reason (K5): `'content:read'` or `{ grant: 'content:read', reason: 'Reads titles to analyse SEO' }`. */
export type ExtensionGrantItem = string | {
  grant: string
  /** Why the extension needs it - shown identically at install, in inspect, in the Admin and in a listing. MEDIUM and HIGH grants without one are warned. */
  reason?: string
  /** An optional grant's feature, so a denial reads "Search Console disabled" rather than "network:... denied". */
  enables?: string
}

/** The grants an extension runs with (manifest `grants`, Extension Kernel K1). */
export interface ExtensionGrants {
  /** Grants the extension cannot work without; an install that refuses one refuses the extension. */
  required: ExtensionGrantItem[]
  /** Grants that unlock more when approved; the extension degrades without them (the grant engine, K5). */
  optional?: ExtensionGrantItem[]
}

/** What an extension needs before it can be ACTIVE here (manifest v1, Unit 4 evaluates it). */
export interface ExtensionRequires {
  /**
   * Tangen runtime capabilities that must be available in the process
   * (registry ids such as 'media', 'search', 'mail', 'knowledge', 'redis',
   * 'realtime', 'scheduler', 'webhooks'). One missing makes the extension
   * `unavailable` with a safe reason; it never starts.
   */
  capabilities?: string[]
  /** Extensions that must be installed and enabled in the same workspace. */
  extensions?: ExtensionDependency[]
  /**
   * Typed services another extension must provide here (Extension Kernel
   * K3): `<ns>.<name>@<range>`, e.g. `seo.service@^1`. No active provider
   * whose declared major satisfies the range → this extension is `blocked`.
   */
  services?: string[]
}

/** Extensions this one uses when present and works without (manifest v1). */
export interface ExtensionOptional {
  extensions?: ExtensionDependency[]
  /** Typed services used when present (`ctx.services.get` answers undefined otherwise); reported as `service:<ref>` in missingOptional. */
  services?: string[]
}

/** What an extension offers to others (Extension Kernel K3). */
export interface ExtensionProvides {
  /**
   * Typed services this extension provides: `<its id>.<name>@<major>`,
   * fulfilled at runtime by `ctx.services.provide(ref, impl)` (usually from
   * `onStart`, so the impl closes over the provider's own ctx and authority).
   */
  services?: string[]
}

/**
 * One key of the extension's install options (manifest v1). Declared so the
 * platform can validate `options` at install and upgrade, show them in the
 * Admin, and never log a secret one.
 */
export interface ExtensionConfigField {
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'json'
  label?: string
  description?: string
  required?: boolean
  default?: unknown
  /** The value is a credential: redacted in logs and diagnostics, never echoed. */
  secret?: boolean
}

/**
 * One ledgered schema migration of an extension (manifest v1, Unit 5). SQL
 * only, so its checksum is the truth of what ran; applied in declared
 * order at INSTALL and UPGRADE through the platform's migration ledger,
 * never at import, REGISTER, ENABLE or START.
 */
export interface ExtensionMigration {
  /** Stable id, e.g. '0001_create_reviews'; ordered by position, never renamed after it ran. */
  id: string
  sql: string
}

export interface TangenExtensionManifest {
  /** Globally unique extension ID: `[a-z0-9][a-z0-9._-]*`, e.g. 'seo' or 'acme.analytics'. */
  id: string
  /** Human-readable display name */
  name: string
  /** Semver version string */
  version: string
  /** Short description shown in the extension registry */
  description?: string
  /**
   * Who wrote it, for the Extensions screen: a person, a team or a company.
   * An operator deciding whether to trust an extension asks this first.
   */
  author?: string
  /** Where to read about it - docs, a repository, a product page. http(s). */
  homepage?: string
  /** The licence it is published under, as an SPDX id ('MIT', 'Apache-2.0'). */
  license?: string
  /**
   * The framework contract this extension is written against (kernel K9):
   * `1` means every server surface it uses receives an execution and a
   * client bound to it (`ctx.exec`, `ctx.tangen`), its capabilities may
   * declare gates, its routes may declare `access` and `authority`, and it
   * imports nothing from the internal set (`docs/public-contract.md`).
   */
  contract?: 1
  /** What must be available (capabilities) and active (extensions) for this one to be active. */
  requires?: ExtensionRequires
  /** Extensions used when present; absence is not an error. */
  optional?: ExtensionOptional
  /** Typed services this extension provides to others (`<id>.<name>@<major>`); see ExtensionProvides. */
  provides?: ExtensionProvides
  /**
   * The connectors this extension offers (plan-connectors A1): declared here
   * so the install review and the provider-ownership preflight can see a
   * provider and its hosts without importing the server entry, and fulfilled
   * by the server's `connectors@1` contribution. The kernel validates that the
   * two agree.
   */
  connectors?: import('./connections').ConnectorDeclaration[]
  /**
   * What this extension IS, for framing rather than behaviour (C1):
   * `connector-pack` is an extension whose whole job is offering connectors,
   * so the Admin shows it under Connections, the CLI words its install as a
   * connector, and Doctor reports it as one. It changes no capability, no
   * lifecycle and no release class - a pack installs, enables, upgrades and
   * ports exactly like any other extension.
   */
  kind?: 'extension' | 'connector-pack'
  /**
   * The authority this extension RUNS WITH (Extension Kernel K1). Declaring
   * it binds every surface the extension owns - event handlers,
   * `runAs: 'extension'` tasks, lifecycle hooks - to an extension actor that
   * holds exactly these grants (`content:read`, `content:update:types(post)`,
   * `media:write`, `capability:<id>`, `db:own`, ...; see extension-grants.ts)
   * and never the admin fast path. Without it the extension keeps Tangen's
   * own authority, attributed `extension:<id>`. Distinct from `permissions`
   * (the capabilities it DEFINES for roles) and `requires` (dependencies).
   */
  grants?: ExtensionGrants
  /** The install options this extension understands, by key. */
  config?: Record<string, ExtensionConfigField>
  /**
   * Operator-editable settings (Extension Kernel K7.1): plain descriptors
   * built with `settings.boolean()`, `.number()`, `.string()`, `.select()`,
   * `.secret()`, `.connection()`. The platform validates, stores (secrets
   * sealed), serves `GET/POST /admin/ext/<id>/settings` and draws the form;
   * the server reads them through `ctx.settings.get()`.
   */
  settings?: ExtensionSettingsDefinition
  /** Bumped when the shape of `settings` changes; the server entry's `migrateSettings` carries stored values forward. Default 1. */
  settingsVersion?: number
  /**
   * Admin slots this extension fills (Extension Kernel K7.2): descriptor
   * items - the core slot (`admin.settings.sections@1`,
   * `admin.extension.overview@1`), an id, the client module's export name,
   * a priority and an access rule. A grants-declaring manifest needs
   * `admin:contribute`.
   */
  slots?: ExtensionSlotContribution[]
  /**
   * The built Admin bundle (Extension Kernel K7.3): a relative `.js`/`.mjs`
   * path, produced by `tangen extension bundle-ui`, that the Admin loads at
   * runtime so installing this extension needs no rebuild. Absent: the UI
   * ships through the Admin build (local extensions).
   */
  ui?: string
  /**
   * The environment variables (secrets) the server entry reads, by NAME
   * only: `['ACME_API_KEY']`. Doctor reports a missing one; values are
   * never part of any manifest, row or diagnostic.
   */
  secrets?: string[]
  /**
   * The environment ROLES this extension may be active in; absent means every
   * environment. A developer tool declares `['development']`, a non-production
   * helper `['development', 'staging']`. Honoured by install, enable, boot
   * adoption and the activation gate: in an environment of another role the
   * extension is never active and contributes nothing, whatever its rows say.
   */
  deploymentRoles?: ReadonlyArray<'development' | 'staging' | 'production'>
  /**
   * Path to the extension's migrations module, relative to the extension
   * dir (e.g. './src/migrations.ts'), default-exporting
   * `ExtensionMigration[]`. See ExtensionMigration.
   */
  migrations?: string
  /**
   * Path to the extension's push hook module, default-exporting
   * `{ afterPush(ctx) }`: runs after `tangen push` committed the content
   * schema, with `{ db, workspaceId, configCwd, options, log }` - code-first
   * definitions the extension owns (forms in app/forms) are upserted here.
   */
  push?: string
  /**
   * The API key grants this extension defines: actions a key may hold on
   * the extension's resources, optionally scoped per item. Stored under
   * `permissions.extensions[<extensionId>]`, rendered by the key and role
   * editors, checked in the extension's key routes with `req.keyCan`.
   */
  apiKeyScope?: ExtensionApiKeyScope
  /**
   * RBAC capabilities this extension declares (e.g. gates for its admin
   * routes/pages). Surfaced in the roles editor while the extension is
   * installed; `implies` grants are honored by the server's checks.
   */
  capabilities?: ExtensionCapabilityDef[]
  /** Declarative resources x actions; compiles to capabilities (extension-permissions.ts). */
  permissions?: import('./extension-permissions').ExtensionPermissionsDef
  /** Custom field types this extension contributes */
  fieldTypes?: CustomFieldTypeDef[]
  /**
   * Content types this extension PROVISIONS. `tangen push` merges them with
   * the site's own types and creates them through the ordinary pipeline -
   * preflight, plan, one transaction, ledger, codegen - so installing the
   * extension is the only thing anyone has to do for its types to exist.
   *
   * Two forms, both valid:
   *
   * - The definitions inline, like `capabilities` and `pages`:
   *   `contentTypes: [defineObjectType({ … })]`. Use this when they are small.
   * - A MODULE PATH relative to the extension dir, like `server`:
   *   `contentTypes: './src/content-types.ts'`, default-exporting
   *   `ObjectTypeDefinition[]`. **Prefer this** for anything substantial: the
   *   manifest is statically imported into the admin's entry chunk, and a
   *   referenced module is not, so a large declaration stays out of the
   *   bundle the whole admin waits for.
   *
   * Rules the push enforces (docs/extensions.md, "Declaring content types"):
   * a type the SITE also declares is the site's - it is their database, and
   * the plan says whose definition won; a type that stops being declared is
   * an ORPHAN, never a silent DROP TABLE.
   */
  contentTypes?: import('./object-types').ObjectTypeDefinition[] | string
  /**
   * Custom tables this extension needs. DECLARATIVE only: the extension
   * describes the structure it wants and `tangen push` decides whether, when
   * and how to create it, through the same planner, risk classification,
   * confirmation and transaction as any other schema change. An extension never
   * executes DDL.
   *
   * A physical table is instance-global, so a second workspace enabling the
   * same extension finds the table already there rather than creating another;
   * the rows inside remain workspace-scoped. Ownership is
   * recorded in `custom_table_owners` and never transferred by declaring a
   * name: a table another extension or the site already owns is refused.
   *
   * Additive only for now - tables and columns are created, never dropped or
   * retyped, and an extension that stops declaring one leaves an orphan that is
   * reported and kept.
   */
  customTables?: import('./config').CustomTableDefinition[]
  /** Sidebar panels this extension adds to the object editor */
  sidebarPanels?: ExtensionSidebarPanel[]
  /**
   * When true, this extension's data is snapshotted alongside content revisions
   * and restored when a revision is restored. Set this for extensions that store
   * content metadata (SEO, custom fields). Leave false (default) for extensions
   * that store accumulative data (analytics, view counts) that should never roll back.
   */
  versionedData?: boolean
  /**
   * Path to the extension's SERVER entry, relative to the extension dir
   * (e.g. './src/server.ts'). The entry default-exports
   * defineExtensionServer({ contentHooks, onInstall, onUninstall }).
   * The manifest itself must stay browser-safe (no function values, no
   * server imports) — the admin build bundles it for panel resolution.
   */
  server?: string
  /** @deprecated Moved to the server entry (defineExtensionServer). Ignored by loaders. */
  onInstall?: (ctx: ExtensionContext) => Promise<void> | void
  /** @deprecated Moved to the server entry (defineExtensionServer). Ignored by loaders. */
  onUninstall?: (ctx: ExtensionContext) => Promise<void> | void
  /** @deprecated Moved to the server entry (defineExtensionServer). Ignored by loaders. */
  contentHooks?: import('./content-hooks').ContentHooks
  /** Dashboard widgets this extension contributes. Frontend fetches each widget's data independently. */
  dashboardWidgets?: import('./dashboard').ExtensionDashboardWidget[]
  /**
   * Breadcrumb route definitions for this extension's admin pages.
   * The admin shell uses these to show accurate, human-readable breadcrumbs
   * instead of guessing from URL segments.
   */
  routes?: ExtensionRoute[]
  /**
   * Full admin pages this extension contributes, mounted under
   * /extensions/<id>/ and gated on the extension being installed + active.
   */
  pages?: ExtensionPageDef[]
  /**
   * Quick actions this extension contributes to the command palette (⌘K) —
   * its "important suggestions". Declarative and browser-safe: each navigates
   * to a path. **At most 3** are surfaced (extras are dropped) to keep the
   * palette's suggestions curated. `to` is resolved **within the extension's
   * own routes** — a bare path like `'settings'` becomes
   * `/extensions/<id>/settings`; paths escaping the extension are rejected.
   */
  commands?: ExtensionCommand[]
  /**
   * Realtime channels this extension publishes on (Realtime R4). Declaring
   * a channel is what makes `ext:<id>:<name>` subscribable (by the declared
   * capability, else any member) and what lets the server entry publish on
   * it; an undeclared channel is refused on both sides. Validated at boot:
   * a bad declaration is a boot error naming the extension.
   */
  realtime?: { channels: ExtensionRealtimeChannel[] }
}

/** A declarative command-palette quick action contributed by an extension. */
export interface ExtensionCommand {
  /** Label shown in the palette (e.g. "New coupon"). */
  label: string
  /** @tangen/icons name (defaults to a generic action icon) or a custom `{ src }` image. */
  icon?: import('./object-types').IconRef
  /** Target path, resolved under the extension's own routes (/extensions/<id>/…). */
  to: string
}

/**
 * Identity builder — call `defineExtension({ ... })` in `tangen.extension.ts`
 * to get TypeScript inference and IDE completions for the manifest shape.
 */
export function defineExtension(manifest: TangenExtensionManifest): TangenExtensionManifest {
  return manifest
}

/**
 * Workspace-scoped key-value collection for an extension (backed by the
 * platform's extension_data table — no DDL, no migrations). Keys are free
 * text; use prefixes as collections (e.g. 'flow:<id>').
 */
export interface ExtensionStore {
  get(key: string): Promise<Record<string, unknown> | undefined>
  put(key: string, data: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
  /** All entries whose key starts with prefix ('' / omitted = everything). */
  list(prefix?: string, opts?: {
    /** Order by a top-level key INSIDE data (SQL-side; e.g. 'startedAt'). Defaults to updated_at. */
    orderByDataKey?: string
    desc?: boolean
    limit?: number
    offset?: number
  }): Promise<Array<{ key: string; data: Record<string, unknown> }>>
  /** Row count for a prefix without fetching payloads. Optional for custom/fake stores. */
  count?(prefix?: string): Promise<number>
}

/** The slice of a field definition the extension AI bridge reads (top-level fields and sub-fields both satisfy it). */
export interface ExtensionAIField {
  name: string
  label: string
  fieldType: string
  config?: Record<string, unknown>
  required?: boolean
}

/** Arguments for one structured extension AI generation. */
export interface ExtensionAIGenerateArgs {
  /** System prompt (role, rules). */
  system?: string
  /** User prompt (task + context). */
  prompt: string
  /** JSON schema the provider's structured-output mode must satisfy. */
  jsonSchema: Record<string, unknown>
  /** Output token cap (runtime default applies when omitted). */
  maxTokens?: number
}

/** One retrieved knowledge fact (workspace RAG). */
export interface ExtensionAIFact {
  content: string
  title: string | null
}

/**
 * AI surface handed to extension server code — structured generation bound to
 * the workspace's Settings > AI provider choice, plus the platform's own
 * field bridge (the same schema/coercion code the editor's AI fill uses) so
 * extensions never fork field semantics. Absent on ctx when the runtime does
 * not wire AI.
 */
export interface ExtensionAIClient {
  /** Structured generation constrained to `jsonSchema`; throws the platform's client-facing errors (no provider available, upstream failures). */
  generateJSON(args: ExtensionAIGenerateArgs): Promise<{ value: unknown; usage?: unknown; provider: string; model: string }>
  /** Unwrapped JSON schema for one field's VALUE; null when the field type cannot be generated (media, relations, …). */
  fieldSchema(field: ExtensionAIField): Record<string, unknown> | null
  /** Coerce raw provider output into a valid stored value for the field; throws when it cannot be made valid. */
  coerceField(field: ExtensionAIField, raw: unknown): unknown
  /** Best-effort knowledge retrieval (workspace RAG) — empty when knowledge is not configured/indexed; never throws. */
  retrieve(query: string, opts?: { k?: number }): Promise<ExtensionAIFact[]>
  /** Describe an image with a provider advertising `vision.describe` (K8.1); needs `ai:vision`. */
  vision?: { describe(args: { image: { url?: string; base64?: string; mimeType?: string }; prompt?: string; model?: string; maxTokens?: number }): Promise<{ text: string; usage?: unknown; provider: string; model: string }> }
  /** Embeddings from a provider advertising `embeddings.generate` (K8.1); needs `ai:embed`. */
  embeddings?: { generate(args: { input: string[]; model?: string }): Promise<{ vectors: number[][]; model: string; provider: string }> }
  /** The providers this workspace can use and what each advertises (K8.1). */
  providers?(): Array<{ id: string; label: string; capabilities: string[]; models: string[]; available: boolean }>
}

/** What `ctx.media.read(id)` answers: the asset's row and its bytes (S3). */
export interface ExtensionMediaAsset {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  altText: string | null
  bytes: Uint8Array
}

/** The platform event types an extension may emit as its own (see `ExtensionServerCtx.emitPlatform`). */
export type ExtensionPlatformEventType =
  | 'publish.started' | 'publish.completed' | 'publish.failed'
  // Forms (an extension since 2026-09-13) announces a submission under the platform type the realtime bridge and Flows key on.
  | 'form.submitted'
  // Realtime R3: Studio's design changes, so the editor can say "changed elsewhere" before the stale-write guard.
  | 'studio.class.changed' | 'studio.tag.changed'
  // A workspace theme write (one token or one font), so an open Variables panel hears it.
  | 'studio.theme.changed'

/**
 * Rich per-invocation context handed to extension event handlers, tasks,
 * and admin-route handlers. Everything is scoped to one workspace.
 */
export interface ExtensionServerCtx {
  extensionId: string
  workspaceId: string
  /**
   * The extension's resolved options: the Admin-typed installed option, else
   * the workspace's config entry, else the manifest default - through the
   * common resolver, validated against the manifest's `config`. Secret
   * fields are not here; read them through `secrets`.
   */
  options?: Record<string, unknown>
  /**
   * The privileged boundary for the extension's credentials: a manifest
   * `secrets` name, or a `config` field declared `secret: true`, read from
   * THIS deployment's secret provider. Never serializable, never logged.
   *
   * @example
   * const key = ctx.secrets?.get('ACME_REVIEWS_KEY')
   */
  secrets?: { get(name: string): string | undefined; has(name: string): boolean; readonly provider: string }
  /**
   * Outbound HTTP with the extension's reach (Extension Kernel K1.4):
   * fetch's shape, bound to the manifest's `network:<host>` grants. A host
   * the grants do not name, or one that resolves to a private address
   * without `network:private`, is refused before any request is made
   * (`code: 'NETWORK_REFUSED'`); redirects are followed hop by hop under the
   * same check; every call is audited (host, method, status, duration - never
   * the query or the body). An extension without `grants` reaches any host,
   * audited. Prefer it over the global fetch: that is what an install review
   * and an operator's audit can see.
   */
  http?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  /**
   * The workspace's loaded config (workspace.config.ts as resolved at
   * boot) - lets an extension read site-declared settings it defines a
   * config key for (e.g. Studio's `studio.tokens`). Read it defensively:
   * the shape is whatever the site authored, and the seam is absent on
   * runtimes that load no workspace config. Read-only by contract.
   */
  workspaceConfig?: () => Record<string, unknown> | undefined
  /** Content/table/mail client (same client custom routes get). */
  tangen?: import('./custom-routes').TangenLocalClient
  /**
   * Resolved content-type definitions for this env — reusable-component name
   * refs expanded into full defs (what GET /types serves the admin), so an
   * extension can read a type's real component vocabulary server-side.
   */
  types?: () => import('./object-types').ObjectTypeDefinition[]
  /**
   * Structured AI generation + the platform's field schema/coercion bridge,
   * bound to this workspace's Settings > AI provider choice. Absent when the
   * runtime doesn't wire AI (extensions must degrade honestly).
   */
  ai?: ExtensionAIClient
  /**
   * A media asset's row and bytes from this workspace (SEO Manager S3), for
   * an extension that hands an image to a provider or reads a file it was
   * pointed at. Under the key-model `media:read` grant; absent without it.
   */
  media?: { read(mediaId: string): Promise<ExtensionMediaAsset | null> }
  /** The extension's workspace-scoped storage. */
  store: ExtensionStore
  /**
   * The deployment's database handle (a drizzle instance over postgres-js),
   * for an extension whose `migrations` created tables of its own - the same
   * handle a Porter provider receives. Typed loosely so @tangen/types stays
   * free of drizzle; the extension declares `drizzle-orm` as a peer and
   * defines its own `pgTable`s. Never used for the platform's own tables.
   */
  db?: unknown
  /**
   * The role of the deployment this extension runs in - `development`,
   * `staging` or `production` (TANGEN_DEPLOYMENT_ROLE). Phase 5A settled
   * that production safety keys on the role and never on a label or a slug;
   * this seam is how an extension obeys that. Absent on a runtime that
   * predates the seam: treat that as unknown and choose the cautious answer.
   */
  deploymentRole?: () => 'development' | 'staging' | 'production'
  /**
   * The public URL of THIS deployment's API (`server.url`, SERVER_URL), for an
   * extension that prints links back to itself - an embed page, a callback
   * URL. Absent when the deployment declares none; fall back to the
   * request's own origin then.
   */
  publicUrl?: () => string | undefined
  /**
   * The CURRENT authority of a recorded member or key id (kernel K6), for
   * work that runs later on someone's behalf (a flow as its owner): refused
   * when that authority is gone. Provided by the host; absent in a minimal
   * embedding, where such work runs with the framework's authority.
   */
  /**
   * The CURRENT authority of a member or key you recorded earlier, plus an
   * execution bound to it.
   *
   * Use the returned `exec` with `clientFor`: an execution you assemble
   * yourself is refused, because a client's authority comes from its
   * execution and the kernel cannot vouch for one it did not mint. Pass the
   * chaining this run needs through `opts` rather than copying the execution
   * and editing it - a copy loses the kernel's mark.
   */
  resolveActor?: (
    actorId: string,
    opts?: {
      kind?: import('./kernel').ExecutionKind
      source?: import('./kernel').ExecutionSource
      initiator?: import('./kernel').ActorIdentity | null
      correlationId?: string | null
      causationId?: string | null
      locale?: import('./kernel').LocaleContext
    },
  ) => Promise<
    { ok: true; actor: import('./kernel').ActorContext; exec: import('./kernel').ExecutionContext }
    | { ok: false; reason: string }
  >
  /** A content client bound to an execution: every read and write carries that execution's actor and attribution (kernel K6). */
  clientFor?: (exec: import('./kernel').ExecutionContext) => import('./custom-routes').TangenLocalClient
  /**
   * The execution this context serves (kernel K7): the member's or key's
   * request on a route, the run on a task, the event's execution on an
   * event handler (Tangen's own authority with the reason `extension:<id>`
   * and the event's actor as initiator), the extension's own on lifecycle
   * hooks. `tangen` is bound to it: an extension does what its caller may,
   * never more.
   */
  exec?: import('./kernel').ExecutionContext
  /**
   * Every role slug this workspace has - built-ins, code-seeded roles, and
   * roles created in the admin. For extensions that gate on org structure
   * (e.g. "only Legal may advance this step") so a saved restriction can be
   * validated against roles that actually exist. Cached per request-ish
   * call; treat it as a read.
   */
  roles?: () => Promise<string[]>
  /**
   * Each member's role FOR THIS ENVIRONMENT (a per-env override where one is
   * set, otherwise their workspace role), keyed by member id. Members with no
   * access to this environment are omitted.
   *
   * For extensions that gate on org structure and need to check somebody
   * OTHER than the caller - e.g. refusing to assign a review stage to a
   * person whose role that stage does not admit. `req.memberRole` answers
   * only for the caller.
   */
  memberRoles?: (memberIds?: string[]) => Promise<Record<string, string>>
  /** Enqueues a task through the durable queue ('ext:<id>:<name>' or app ids). */
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
  enqueue: (taskId: string, payload?: unknown, opts?: { delaySeconds?: number }) => Promise<void>
  /**
   * Publishes a custom platform event through the bus (extension events
   * and Flow triggers can subscribe). Types are namespaced automatically:
   * 'ext:<extensionId>:<name>'.
   */
  emit?: (name: string, payload?: Record<string, unknown>, opts?: { actorId?: string | null; actorType?: 'member' | 'api_key' | null }) => void
  /**
   * Publishes one of the few PLATFORM-typed events an extension is allowed
   * to own - today the Studio publish lifecycle (`publish.started`,
   * `publish.completed`, `publish.failed`), which the realtime bridge fans
   * to `object:<id>` and `studio:<id>`. Unlike `emit` the type is NOT
   * namespaced; in exchange it is allow-listed, so an extension can never
   * forge `object.published` and trigger a workspace's webhooks or flows.
   * Throws on a type outside the list.
   */
  emitPlatform?: <T extends ExtensionPlatformEventType>(
    type: T,
    payload: Extract<import('./events').TangenEvent, { type: T }>['payload'],
    opts?: { actorId?: string | null; actorType?: 'member' | 'api_key' | null },
  ) => void
  /**
   * The platform's delivery store for this workspace and environment - the
   * three-method contract published Studio artifacts go through (see
   * `DeliveryProvider` in @tangen/studio-compiler, typed structurally here
   * so this package stays free of it). The platform resolves the backend
   * from `studio.delivery`; the extension only writes. Absent on a runtime
   * that predates the store, where the extension falls back to its own KV
   * store - which the platform delivery route still reads.
   */
  delivery?: {
    read(path: string): Promise<string | null>
    write(path: string, body: string): Promise<void>
    list(prefix: string): Promise<string[]>
  }
  /**
   * LEGACY (Extension Kernel K2): the walk over every loaded server entry for
   * conventions that predate contribution points. New code reads
   * `contributions(point)` below, which knows the point's multiplicity and
   * grant. Kept for hosts and contributors written against it.
   *
   * Read-only view of every loaded extension server entry (id + entry) — lets
   * extensions discover each other's contribution conventions. Each entry's
   * optional `ctx` lazily builds THAT extension's own ExtensionServerCtx for
   * the same workspace × env, so a host extension (e.g. Flows) can execute a
   * contributed handler with the contributor's store/identity/emit instead of
   * its own.
   */
  registry?: () => Array<{
    id: string
    server: Record<string, unknown>
    ctx?: () => ExtensionServerCtx | Promise<ExtensionServerCtx>
  }>
  /**
   * The contribution registry (Extension Kernel K2): every item the ACTIVE
   * extensions of this scope contribute to a point (`'flow.actions@1'`),
   * in registration order, each with its contributor's id and a lender for
   * that contributor's own ctx. Prefer it over `registry()`: it knows the
   * point's multiplicity and grant, reads the legacy keys and runtime
   * contributions alike, and refuses an unknown point.
   */
  contributions?: <T = unknown>(point: string, opts?: { except?: string }) => Array<{
    extensionId: string
    item: T
    ctx?: () => ExtensionServerCtx | Promise<ExtensionServerCtx>
  }>
  /**
   * Contribute at runtime (from `onStart`), scoped to the workspace this ctx
   * serves; the handle withdraws early, and the host withdraws when the
   * scope stops.
   */
  contribute?: (point: string, items: readonly unknown[]) => () => void
  /**
   * Typed services between extensions (Extension Kernel K3). `provide` offers
   * one of this extension's declared services (`<id>.<name>@<major>`) for the
   * workspace this ctx serves - from `onStart`, so the implementation closes
   * over this ctx and runs under this extension's authority; the handle
   * withdraws early, the host withdraws when the scope stops. `get` answers a
   * consumer's `<ns>.<name>@<range>` from the active providers, undefined
   * when none satisfies (an `optional` service: degrade honestly; a
   * `required` one: the platform never starts you without it); `resolve`
   * adds who provides it.
   */
  /**
   * Connections (Extension Kernel K6): an operator's credentials for a
   * connector, used as an AUTHED CLIENT - `get('google-search-console')`
   * returns the connector's `request` bound to the sealed credentials and to
   * an http that reaches only the connector's declared hosts; the token
   * itself never reaches you. Needs `connections:<connector>` in your grants
   * (an extension without grants runs with the platform's authority). A
   * connector nobody active offers, or a connection nobody configured,
   * answers undefined; `list` shows the connections you may use, without
   * material.
   */
  /**
   * The extension's typed settings (Extension Kernel K7.1): defaults, then
   * what the operator saved in Settings, secrets opened. Absent when the
   * manifest declares no `settings`.
   */
  settings?: {
    get<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T>
  }
  connections?: {
    list(): Promise<Array<{ id: string; connectorId: string; label: string; kind: 'oauth2' | 'apiKey' | 'basic'; status: string; meta: Record<string, unknown> }>>
    /**
     * Why an integration is or is not usable here, WITHOUT failing: takes a
     * provider (`google`) or a qualified capability (`google.sheets.append`)
     * and answers the one derivation every surface renders, so an optional
     * integration can degrade with the sentence the operator will also see.
     */
    availability(ref: string): Promise<import('./connection-state').IntegrationVerdict>
    /**
     * A connection of a PROVIDER (`google`), by id (what a
     * `settings.connection()` field stores), else the one labelled so, else
     * the first active one. A connector id is still accepted, for consumers
     * written before providers existed.
     *
     * `capabilities` names what you are about to do in the provider's own
     * vocabulary (`sheets.append`) - never an OAuth scope string. A
     * connection that was never authorized for one is REFUSED by name before
     * the provider is called; an absent pack or an unconfigured provider is
     * `undefined`, which is a degrade, not an error.
     */
    get(providerOrConnector: string, options?: { id?: string; label?: string; capabilities?: readonly string[] }): Promise<{
      id: string; connectorId: string; label: string; kind: 'oauth2' | 'apiKey' | 'basic'; meta: Record<string, unknown>
      request: (path: string, init?: RequestInit) => Promise<Response>
      /**
       * One of the connector's named operations, for a provider that is not
       * HTTP (SMTP, a queue). The material stays with the connector, exactly
       * as for `request`: a consumer never holds a credential.
       */
      invoke: <T = unknown>(operation: string, input?: unknown) => Promise<T>
      /** Whether it still works, with the provider's reason when it does not. `transient`: the provider could not answer, which says nothing about the credential. */
      health: () => Promise<{ ok: boolean; message?: string; transient?: boolean }>
      /** False for a legacy connection with no recorded scope: authorization unknown, not unrestricted. */
      authorizationKnown: boolean
    } | undefined>
  }
  /**
   * Filters (Extension Kernel K4). `register` adds a transform for the
   * workspace this ctx serves (the handle withdraws; the host withdraws on
   * stop); `apply` runs one of YOUR points (declared with `declare`) over a
   * value for a scope, the way core runs `content.beforeWrite@1`; `declare`
   * declares a point in your namespace (`seo.structuredData@1`) that peers
   * may register against.
   */
  filters?: {
    register(registration: { point: string; priority?: number; when?: Record<string, string>; timeoutMs?: number; isolation?: 'skip' | 'abort'; transform: (value: never, context: never) => unknown }): () => void
    apply<T>(point: string, value: T, opts?: { scope?: Record<string, string>; context?: Record<string, unknown> }): Promise<{ value: T; trace: Array<{ extensionId: string; outcome: string; ms: number }> }>
    declare(def: { id: string; version: number; scope?: string[]; mode: 'value' | 'draft' | 'collect'; isolation: 'skip' | 'abort'; sync?: boolean; empty?: () => unknown; merge?: (acc: unknown, next: unknown) => unknown; description?: string }): void
  }
  services?: {
    provide<T>(ref: string, impl: T): () => void
    get<T = unknown>(ref: string): T | undefined
    /**
     * Whether anyone active provides it. `get` already answers undefined, so
     * this is a readable probe for an optional integration:
     * `if (!ctx.services?.has('google.sheets@1')) return degrade(...)`.
     */
    has(ref: string): boolean
    resolve<T = unknown>(ref: string): { extensionId: string; ref: string; impl: T } | undefined
    /**
     * K3.2: instantiate a service for a caller. A provider written as a
     * FACTORY (`provide(ref, ({ exec, tangen, caller }) => impl)`) is
     * instantiated under provider ∩ caller (the caller's execution `as`),
     * with a client bound to that execution: a viewer cannot read drafts
     * through a provider that may. A plain-object service is returned as it
     * is and runs with the provider's authority. Undefined when no provider
     * satisfies.
     */
    dispatch<T = unknown>(ref: string, opts: { as: import('./kernel').ExecutionContext }): Promise<T | undefined>
  }
  /**
   * Whether ANOTHER extension is installed + active for this workspace
   * (config-resolved or a workspace_installed_apps row) - the bound
   * convenience over `tangen.hasExtension`. Use it to depend on a peer
   * extension conditionally (contributions, optional integrations).
   */
  hasExtension?: (extensionId: string) => Promise<boolean>
  /**
   * Realtime R4: publish an event to connected clients on one of the
   * channels the manifest declares (`realtime.channels`). The topic clients
   * subscribe to is `ext:<extensionId>:<channel>`; the envelope carries
   * `type` and `data` (ids, counters, changed names - never documents).
   * Refused (rejects) for an undeclared channel; indifferent to whether
   * Core fans out through memory, Postgres or Redis. Resolves to null on a
   * runtime that mounts no realtime server. Absent on older hosts.
   */
  realtime?: {
    publish(input: { channel: string; type: string; data?: Record<string, unknown> }): Promise<unknown>
  }
  log: (message: string) => void
}

/** Subscribe to platform events (installed workspaces only). */
export interface ExtensionEventSubscription {
  /** Event type names (e.g. 'object.published') or '*' for everything. */
  types: string[] | '*'
  handler: (event: import('./events').TangenEvent, ctx: ExtensionServerCtx) => Promise<void> | void
}

/** The API key grants an extension defines (manifest `apiKeyScope`). */
export interface ExtensionApiKeyScope {
  /** Section label in the key editor ("Forms"). */
  label: string
  description?: string
  /** The actions a key may hold ("read", "submit"); `label` defaults to the id. */
  actions: Array<{ id: string; label?: string }>
  /** When set, the editor offers per-item overrides; the items come from the server's `apiKeyScopeItems`. */
  items?: { label: string }
}

/** A queue task owned by an extension — runs as `ext:<extensionId>:<name>`. */
export interface ExtensionTaskDef {
  /** Short name; the platform namespaces it as ext:<extensionId>:<name>. */
  name: string
  description?: string
  /**
   * Whose authority the task runs with. `'initiator'` (default): the actor
   * that enqueued it, re-resolved at run time (K6). `'extension'`: the
   * extension's own authority (system, `extension:<id>`), for work a public
   * submit or a webhook sets in motion that must still write content - a
   * form hook creating a lead, a notification reading a whole submission.
   */
  runAs?: 'initiator' | 'extension'
  handler: (payload: unknown, ctx: ExtensionServerCtx) => Promise<void> | void
}

/**
 * A server API route contributed by an extension. Auth decides the mount:
 *
 * - `'member'` (default) — /api/v1/admin/ext/<extensionId>/<path>;
 *   admin-panel member sessions, optional `capability` RBAC gate.
 * - `'key'`    — /api/v1/ext/<extensionId>/<path>; requires a workspace API
 *   key (workspace + env resolve from the key binding; req.apiKeyId set).
 * - `'public'` — /api/v1/ext/<extensionId>/<path>; unauthenticated. The
 *   workspace resolves from the `X-Tangen-Workspace` header (or the sole
 *   loaded workspace); unresolvable → 404.
 *
 * Every mount 404s while the extension is uninstalled (indistinguishable
 * from an absent route). Rate limiting: `ctx.tangen.rateLimit(key, max,
 * windowSec)` is available to key/public handlers like custom routes.
 */
export interface ExtensionAdminRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** Relative path, ':param' segments allowed (e.g. 'flows/:id'). */
  path: string
  /** Who may call this route. Default 'member'. */
  auth?: 'member' | 'key' | 'public'
  /** RBAC capability required for this route (member routes; e.g. 'manage:settings'). */
  capability?: string
  /**
   * The page rule this route backs (kernel K7), evaluated on the server with
   * the same semantics the Admin applies to a page: owner and admin pass, a
   * listed role passes, a held capability passes.
   */
  access?: import('./admin-extension').AdminAccessRule
  /**
   * What a PUBLIC route's handler is declared to do (kernel K7): the grants
   * its `ctx.tangen` holds. Default: read published content only. A public
   * route never carries the framework's authority.
   */
  authority?: import('./api-keys').ApiKeyPermissions
  handler: (
    req: {
      params: Record<string, string>; query: Record<string, string>; body: unknown
      /** Calling member id — set on 'member' routes only. */
      memberId?: string
      /** Validated API key id — set on 'key' routes only. */
      apiKeyId?: string
      /**
       * On a `key` route: whether the calling key holds `action` under this
       * extension's `apiKeyScope`, for `item` when given (an item override
       * replaces the global grant for that item, matched by id or slug).
       */
      keyCan?: (action: string, item?: { id: string; slug?: string | null }) => boolean
      /** On a public or key route: the caller's address as the Gateway resolved it (trusted proxies honoured). */
      ip?: string
      /** On a public or key route: the full request URL, for a handler that builds absolute links back to itself. */
      url?: string
      /** Request headers (lowercased) — set on 'key'/'public' routes. */
      headers?: Record<string, string>
      /**
       * The request correlation id (the Gateway's, echoed as
       * X-Tangen-Request-Id on the response). Put it in your own log lines;
       * an unhandled throw is reported to the client under the same id.
       */
      requestId?: string
      /** RBAC check for the calling member (route-level `capability` is enforced before the handler). */
      can?: (capability: string) => boolean
      /**
       * The calling member's role for THIS environment - a per-env override
       * where one is set, otherwise their workspace role. Member routes only.
       * Lets an extension gate on org structure (e.g. only Legal may advance
       * a Legal review stage) rather than only on capabilities.
       */
      memberRole?: string | null
      /**
       * Does the caller satisfy a role restriction? `null` means "no
       * restriction", so it is satisfied by everyone; `owner` always
       * satisfies one, including an EMPTY list, so a restriction that ends up
       * naming nobody still leaves a recovery path.
       *
       * This answers only the ROLE question - capability checks stay with
       * `can()`, so an extension composes the two however it needs.
       */
      actAsRole?: (roles: string[] | null) => boolean
      /**
       * May the caller WRITE content in this language? `null` (the default)
       * asks about the base / default language, which is what a write to a
       * shared document is. A translate-only role
       * (`MemberPermissions.locales`) is refused there, exactly as it is on
       * every platform write path; admin sessions and API keys pass.
       *
       * Any extension route that writes content should ask: a capability
       * grant must never become a way around the locale model. Member routes
       * only; absent on runtimes that do not wire it, so treat an absent
       * helper as "not asked" rather than as permission.
       */
      canWriteLocale?: (locale?: string | null) => boolean
    },
    ctx: ExtensionServerCtx,
  ) => Promise<unknown> | unknown
}

/**
 * An extension's answer to "can this be published directly right now?".
 * `blocked: false` is the answer for everything that does not care, which is
 * why an absent policy and an empty registry both mean "publish normally".
 */
export interface PublishPolicy {
  blocked: boolean
  /** Shown to the user in place of the action, e.g. why it is unavailable. */
  reason?: string
  /** Label for what they should do instead, e.g. 'Save as draft'. */
  actionLabel?: string
  /**
   * What the user can DO about it, offered in place of the blocked action.
   * The path is relative to this extension's own admin mount, so an
   * extension can only ever point at its own routes.
   *
   * Without this a blocked publish is a dead end: the UI can say why, but
   * the thing that would unblock it lives somewhere the user has to go and
   * find.
   */
  action?: {
    label: string
    /** e.g. `submit/<objectId>` - no leading slash, no traversal. */
    path: string
    method?: 'POST' | 'PATCH'
    body?: Record<string, unknown>
  }
}

/**
 * Everything an extension contributes SERVER-side, exported as the default
 * of the file named by manifest.server. Kept separate from the manifest so
 * the manifest stays browser-safe for the admin build.
 */
/**
 * Context handed to a custom field type's server-side validator. Validation is
 * synchronous (it gates the save) and authoritative — the admin's client-side
 * validator is only for instant feedback and is never trusted.
 */
export interface FieldTypeValidateContext {
  field: import('./object-types').FieldDefinition
  mode: 'draft' | 'publish'
}

/** A custom field type's authoritative server validator — error message or null/undefined when valid. */
export type FieldTypeServerValidate = (value: unknown, ctx: FieldTypeValidateContext) => string | null | undefined

/** Server behaviour a custom field type contributes (currently validation). */
export interface ExtensionFieldTypeServer {
  validate?: FieldTypeServerValidate
}

/** A Flow trigger an extension contributes (manifest v1: declared on the server entry, typed here). */
export interface ExtensionFlowTrigger {
  /** Event type: `ext:<id>:<name>` for the extension's own events, or a platform type. */
  type: string
  label: string
  description?: string
  /** RBAC capability required to see and use the trigger in the builder. */
  capability?: string
  /** Payload shape for the builder's picker and test-run seeds. */
  payloadFields?: Array<{ path: string; label: string; sample?: unknown }>
  /**
   * What a MATCHED flow may read of this event, resolved by the contributor
   * after the match (a submission's values, which never ride the bus). The
   * result is merged into `trigger`; Flows itself never reaches into the
   * contributor's data.
   */
  hydrate?: (event: Record<string, unknown>, ctx: ExtensionServerCtx) => Promise<Record<string, unknown>> | Record<string, unknown>
}

export interface ExtensionFlowActionMeta {
  flowId?: string
  flowName?: string
  trigger?: Record<string, unknown>
}

/** A Flow action an extension contributes; the handler runs with the CONTRIBUTOR's own ctx. */
export interface ExtensionFlowAction {
  /** Action name, namespaced by convention (e.g. 'coupon_disable'). */
  name: string
  label: string
  description?: string
  capability?: string
  configFields?: Array<{ key: string; label: string; kind?: 'text' | 'number' | 'json' }>
  /**
   * The fields this action's result exposes, so the builder can offer
   * `{{steps.<id>.output.<key>}}` instead of asking an author to remember it.
   *
   * `key` is a dot-path INTO the returned object, which is how every built-in
   * already declares its own (`response.status`, `updated.typeName`). It
   * described a `path` here until Stage G5 - a spelling nothing has ever
   * consumed, so a contribution that followed this type registered and then
   * silently never appeared in the picker (DOC-AUDIT-12).
   */
  output?: Array<{ key: string; label?: string; type?: 'string' | 'number' | 'boolean' | 'json' | 'array' }>
  handler: (config: Record<string, unknown>, ctx: ExtensionServerCtx, meta?: ExtensionFlowActionMeta) => Promise<unknown> | unknown
}

export interface ExtensionPorterProviderResult {
  created: number
  updated: number
  counts?: Record<string, number>
  refused?: { key: string; reason: string }[]
  warnings?: { key: string; reason: string }[]
}

/**
 * A Porter provider an extension contributes: rows it exports and imports
 * with a workspace (its extension_data families, its own
 * tables). Registered at REGISTER under the extension's id; offered and
 * run only where the extension is active.
 */
/** What Porter hands an extension provider besides the rows (E.4): the extension's own store for the workspace. */
export interface ExtensionPorterScope {
  store: ExtensionStore
}

export interface ExtensionPorterProvider {
  /** Provider key, unique in the process (namespace it: 'reviews.workflows'). */
  key: string
  label: string
  /** Provider keys whose rows import before this one. */
  dependsOn?: string[]
  /** `db` is the platform handle only under `db:own` (undefined otherwise); `scope.store` is always your own store for the workspace (E.4). */
  count(db: unknown, workspaceId: string, scope?: ExtensionPorterScope): Promise<number>
  exportRows(db: unknown, workspaceId: string, scope?: ExtensionPorterScope): Promise<Record<string, unknown>[]>
  importRows(db: unknown, workspaceId: string, rows: Record<string, unknown>[], ctx?: { idRemap?: Record<string, string> } & Partial<ExtensionPorterScope>): Promise<ExtensionPorterProviderResult>
  /** Media ids the rows reference, so the bytes ride the bundle and the import remaps them. */
  mediaIds?(rows: Record<string, unknown>[]): string[]
}

/** What `onStart` returns to undo itself at STOP. */
export type ExtensionCleanup = () => void | Promise<void>

export interface TangenExtensionServer {
  /**
   * Carries stored settings forward when `settingsVersion` moved (Extension
   * Kernel K7.1): receives the values as stored under the older version
   * (secrets opened) and the version they were written at; returns the
   * values for the current definition. Runs once per stored entry.
   */
  migrateSettings?: (values: Record<string, unknown>, fromVersion: number) => Record<string, unknown> | Promise<Record<string, unknown>>
  /**
   * An operator SAVED the extension's settings, and these keys moved
   * (Extension Kernel K7.1). What it exists for: a setting is usually a
   * pointer at the outside world - which Search Console property, which
   * channel, which spreadsheet - and until this hook there was no way for an
   * extension to act on one changing, so a screen kept showing a state that
   * a save had already fixed.
   *
   * The hook is told the KEYS, not the values: it reads what it needs through
   * `ctx.settings.get()`, which applies the same sealing and grant rules as
   * everywhere else, so no secret is ever handed to a hook payload.
   *
   * It runs AFTER the write is stored, under the extension's own authority,
   * and its failure never fails the operator's save. It must not block:
   * enqueue the work (`ctx.enqueue`) rather than calling a provider inline,
   * or the Save button waits on someone else's API. A write the extension
   * makes itself does not call it back, so a hook cannot loop.
   */
  onSettingsChange?: (ctx: ExtensionServerCtx, change: { changed: string[] }) => void | Promise<void>
  /**
   * Server behaviour for the extension's custom field types, keyed by the type
   * `name` declared in the manifest's `fieldTypes`. Runs after the inherited
   * primitive's baseline validation. Functions live here (not the browser-safe
   * manifest).
   */
  fieldTypes?: Record<string, ExtensionFieldTypeServer>
  /**
   * Contributions by point (Extension Kernel K2): `{ 'flow.actions@1': [...],
   * 'mcp.tools@1': [...] }`. The typed well-known keys below (`flowActions`,
   * `mcpTools`, `searchProviders`, ...) are the same thing under their legacy
   * names; a host reads both through `ctx.contributions(point)`.
   */
  contributions?: Record<string, unknown[]>
  /**
   * Filter registrations (Extension Kernel K4): `{ point: 'content.beforeWrite@^1',
   * priority?, when?: { contentType }, timeoutMs?, isolation?, transform(value, c) }`.
   * The same items under `contributions['filters@1']`. A grants-declaring
   * extension needs `filters:<point namespace>` (`filters:content`).
   */
  filters?: Array<{
    point: string
    priority?: number
    when?: Record<string, string>
    timeoutMs?: number
    isolation?: 'skip' | 'abort'
    transform: (value: never, context: never) => unknown
  }>
  /** Platform-event subscriptions — fired for installed workspaces only. */
  events?: ExtensionEventSubscription[]
  /**
   * Custom webhook triggers this extension contributes — declare events the
   * extension emits via `ctx.emit(name, payload)` so a workspace's webhooks can
   * subscribe to them (bus id `ext:<extensionId>:<name>`). Surfaced in the admin
   * webhook picker with the extension's badge.
   */
  webhookTriggers?: import('./webhook-triggers').WebhookTriggerDefinition[]
  /** Durable-queue tasks (auto-namespaced ext:<extensionId>:<name>). */
  tasks?: ExtensionTaskDef[]
  /** Admin API routes under /api/v1/admin/ext/<extensionId>/. */
  adminRoutes?: ExtensionAdminRoute[]
  /**
   * The items a key may be scoped to under the manifest's `apiKeyScope`
   * (the workspace's forms, say), for the key editor's per-item overrides.
   */
  apiKeyScopeItems?: (ctx: ExtensionServerCtx) => Promise<Array<{ id: string; name: string; slug?: string }>>
  /**
   * The site identity provider this extension contributes (who the END USER
   * behind a site request is): Tangen Auth, or a Supabase / Firebase / Clerk
   * verifier. A provider, or a factory from the extension's ctx (to read a
   * vendor secret through `ctx.secrets`). Registered where the extension is
   * active; exactly one provider may serve a workspace. Core's `requireAuth`,
   * `auth: 'user'` custom routes and the realtime ticket's site path ask it.
   */
  siteIdentity?: import('./site-identity').SiteIdentityProvider
    | ((ctx: ExtensionServerCtx) => import('./site-identity').SiteIdentityProvider | Promise<import('./site-identity').SiteIdentityProvider>)
  /**
   * Whether this extension is currently standing between a type (or one
   * object) and being published, so a SURFACE can stop offering an action
   * that cannot succeed. Purely advisory: content hooks remain the thing
   * that actually refuses a publish, and a surface that ignores this - or
   * an extension that declares nothing - behaves exactly as before.
   *
   * Called only for workspaces where this extension is installed. Anything
   * thrown is treated as "not blocked": a broken hint must never be the
   * reason someone cannot reach a button, because the real gate is still
   * there to refuse honestly.
   */
  publishPolicy?: (
    ctx: ExtensionServerCtx,
    input: { typeName: string; objectId?: string },
  ) => PublishPolicy | Promise<PublishPolicy>
  /** Content lifecycle hooks — fired for workspaces with the extension installed. */
  /**
   * The panel-data contract (SEO Manager slice 1). A sidebar panel's bag is
   * either stored VERBATIM by your afterChange hook, or transformed only
   * through this codec: `write(current, panel)` is what you store,
   * `read(stored)` is what the panel edits. The repo's contract test drives
   * every bundled extension's hook and refuses any other transform, so the
   * Admin's dirty check and publish snapshot can never drift from storage.
   */
  panelDataCodec?: {
    read(stored: unknown): Record<string, unknown>
    write(current: unknown, panel: Record<string, unknown>): Record<string, unknown>
  }
  contentHooks?: import('./content-hooks').ContentHooks
  /** Called when the extension is installed into a workspace (non-schema work only; migrations run before it). */
  onInstall?: (ctx: ExtensionContext) => Promise<void> | void
  /** Called when the extension is uninstalled from a workspace (advisory; data is retained). */
  onUninstall?: (ctx: ExtensionContext) => Promise<void> | void
  /**
   * START (runtime lifecycle v1): called once per workspace
   * where the extension is active, when the process starts its runtime (and
   * when a scope becomes active while the process runs). Start timers,
   * subscribers, consumers and connections here - never at import, and
   * never in `onInstall`. Return a cleanup and it runs at STOP; a throw
   * marks the extension's runtime as failed for that scope and starts
   * nothing else of it.
   */
  onStart?: (ctx: ExtensionServerCtx) => void | ExtensionCleanup | Promise<void | ExtensionCleanup>
  /** STOP: called per started scope before its cleanup runs; new work must cease. Idempotent by contract. */
  onStop?: (ctx: ExtensionServerCtx) => void | Promise<void>
  /** DISPOSE: called once per process at shutdown, after every scope stopped; release what `onStart` shared across scopes. */
  onDispose?: () => void | Promise<void>
  /**
   * UPGRADE: called per workspace after the pending
   * migrations applied and before the new version is recorded, for
   * non-schema work (re-index, migrate stored options, warm a cache). Not
   * a schema escape hatch: DDL belongs in `migrations`. A throw leaves the
   * old version on the row; the next upgrade retries the hook alone.
   */
  onUpgrade?: (ctx: ExtensionServerCtx, info: { from: string | null; to: string }) => void | Promise<void>
  /**
   * MCP tools this extension contributes. Exposed as `ext_<extensionId>_<name>`
   * only while the extension is installed AND the workspace has MCP enabled
   * (app/config/mcp.ts — OFF by default). Handlers run server-side.
   */
  mcpTools?: ExtensionMcpTool[]
  /**
   * Flow triggers this extension contributes (one declaration path, Unit
   * 11): Flows reads them from the registry of extensions active in the
   * workspace, so a disabled extension leaves none behind.
   */
  flowTriggers?: ExtensionFlowTrigger[]
  /** Flow actions this extension contributes; each runs with this extension's own ctx. */
  flowActions?: ExtensionFlowAction[]
  /**
   * Porter providers this extension contributes. Registered under this
   * extension's id at REGISTER; offered and run only where the extension
   * is active.
   */
  porterProviders?: ExtensionPorterProvider[]
  /**
   * Live search sources — merged into Admin Search (and optionally Site Search).
   * Run at query time; namespaced `ext:<extensionId>:<id>`; installed workspaces
   * only. For large/public datasets prefer indexed sources over a live provider.
   */
  searchProviders?: ExtensionSearchProvider[]
}

/** One result from an extension search provider. */
export interface ExtensionSearchHit {
  id: string
  title: string
  /** Destination path/URL (resolved under the extension's own routes when relative). */
  to: string
  /** Optional status pill text. */
  status?: string
  /** Optional icon — an @tangen/icons name or a custom `{ src }` image. */
  icon?: import('./object-types').IconRef
}

/**
 * A live search source contributed by an extension (Search platform, Phase 1).
 * Runs at query time (no indexing), so keep it fast and bounded. Exposed as
 * `ext:<extensionId>:<id>` and, by default, only in Admin Search (`internal`).
 */
export interface ExtensionSearchProvider {
  /** Short id; namespaced by the platform as ext:<extensionId>:<id>. */
  id: string
  /** Group heading shown in results. */
  label: string
  /** Where it may run. Default: ['internal'] (Admin Search only). */
  audiences?: ('internal' | 'public')[]
  /** Return hits for the query. Runs at query time — keep it fast + bounded. */
  search: (
    q: string,
    ctx: ExtensionServerCtx,
  ) => Promise<ExtensionSearchHit[]> | ExtensionSearchHit[]
}

/** One extension-contributed MCP tool. */
/** What the platform checks on the calling key before an extension tool runs (K0). */
export interface ExtensionMcpToolAccess {
  /** The objects action the key must hold globally. Default `'read'`; a tool that writes declares `'write'`. */
  objects?: 'read' | 'write' | 'publish'
}

/** The context an extension MCP tool handler receives: the workspace plus the calling key. */
export interface ExtensionMcpToolContext extends ExtensionContext {
  apiKeyId: string
  permissions: import('./api-keys').ApiKeyPermissions
  /** The caller's execution (kernel K7) and a client bound to it: the tool does what the key may. */
  exec?: import('./kernel').ExecutionContext
  tangen?: import('./custom-routes').TangenLocalClient
}

export interface ExtensionMcpTool {
  /** Tool name (namespaced by the platform as ext_<extensionId>_<name>). */
  name: string
  description: string
  /** JSON Schema for the tool arguments. */
  inputSchema: Record<string, unknown>
  /** The grant the platform requires of the calling key. Default: objects read. */
  access?: ExtensionMcpToolAccess
  handler: (
    args: Record<string, unknown>,
    ctx: ExtensionMcpToolContext,
  ) => Promise<unknown> | unknown
}

/** Identity builder for the server entry (src/server.ts). */
export function defineExtensionServer(server: TangenExtensionServer): TangenExtensionServer {
  return server
}

/**
 * An extension resolved at boot from a workspace config `extensions:` entry —
 * the manifest imported from `<dir>/tangen.extension.ts` plus the entry's
 * options. Lives on WorkspaceProject.extensions.
 */
export interface LoadedExtension {
  id: string
  /** Absolute extension directory (empty for bare package specifiers). */
  dir: string
  /** Bare package specifier when npm-resolved (e.g. '@tangen/ext-studio') -
   *  server entries import through it, never through the extension id. */
  pkg?: string
  manifest: TangenExtensionManifest
  options?: Record<string, unknown>
}
