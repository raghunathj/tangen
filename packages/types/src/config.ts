/**
 * File Name: config.ts
 * Purpose: Workspace and environment configuration types for Tangen CMS; defines
 *   WorkspaceConfig, TangenConfig, and helper define* functions.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Uses inline import() types referencing object-types, forms,
 *   content-hooks, custom-routes, site-auth, dashboard, and admin-ui.
 */

export type CustomColumnKind =
  | "text"
  | "number"
  | "boolean"
  | "json"
  | "timestamp";

export interface ColumnDefinition {
  kind: CustomColumnKind;
  nullable: boolean;
  defaultValue?: unknown;
  defaultNow?: boolean;
}

export interface CustomTableDefinition {
  name: string;
  columns: Record<string, ColumnDefinition>;
  /** Knowledge (RAG) opt-in — index the named text columns of this table. */
  knowledge?: import('./knowledge').TableKnowledgeConfig;
  /**
   * MCP exposure — omit to expose (opt-out, like content types; the key's
   * `tables:read` grant still gates). `false`/`{enabled:false}` hides it from
   * agents; `{hiddenColumns}` redacts columns from `query_table`/`get_schema`.
   */
  mcp?: boolean | import('./mcp').TableMcpConfig;
  /** Search opt-in — expose this table's rows for the recommendations picker. */
  search?: import('./search').TableSearchConfig;
  /**
   * Porter opt-in — let this table's rows move with Porter (env sync,
   * export/import bundles, instance transfers). `matchBy` is REQUIRED and
   * names the natural-key column that identifies a row across environments
   * (`{ matchBy: 'code' }` for a coupons table): a row whose key already
   * exists in the target is updated in place and keeps its id, like slug
   * matching does for content. There is deliberately no id-based mode —
   * custom-table ids are a global primary key, so id matching mints fresh
   * ids on every env sync and duplicates rows on re-sync. Env-isolated
   * tables only.
   *
   * `references` declares foreign keys to OTHER porter-enabled tables
   * (`{ couponId: 'coupons' }`): the export carries the referenced row's
   * natural key alongside the id, and the import re-resolves it against the
   * target environment — so a claim follows its coupon even when the
   * target's coupon kept a different id. The referenced table must declare
   * its own matchBy.
   */
  porter?: { matchBy: string; references?: Record<string, string> };
}

/** Per-type cache settings within a CacheConfig */
export interface TypeCacheConfig {
  /** Set to false to always bypass the cache for this type */
  cache?: boolean;
  /** TTL in seconds for this type. 0 disables caching for this type */
  ttl?: number;
}

/** Cache configuration — can be set at workspace level (default for all envs) or env level (override) */
export interface CacheConfig {
  /** Default cache TTL in seconds for all object types. 0 disables caching. Default: 60 */
  ttl?: number;
  defaultTtl?: number;
  /** Per-type overrides */
  types?: Record<string, TypeCacheConfig>;
}

/**
 * The shape of a developer-authored workspace project config (`tangen.config.ts`).
 * Returned by `defineWorkspace()`. `workspaceId` is optional — the workspace loader
 * infers it from the project directory name when absent.
 */
export interface WorkspaceConfig {
  /**
   * Gateway policy at WORKSPACE scope (tasks/plan-gateway.md section 22):
   * CORS origins and credentials, rate-limit and request-limit narrowing.
   * Inherited by every environment of the workspace; an environment may
   * narrow it further, never widen it.
   */
  gateway?: import('./gateway').GatewayConfig;
  name: string;
  workspaceId?: string;
  /** Child workspaces do not need to declare schemas — they share the master's. */
  schemas?: import("./object-types").ObjectTypeDefinition[];
  /** Values for the keys `app/config/site.ts` declares (`site.<name>`). */
  site?: Record<string, unknown>;

  /**
   * The workspace registry (from `app/workspaces/index.ts` via defineWorkspaces).
   * Referenced here so a scaffolded `tangen.config.ts` type-checks; the runtime
   * discovers workspaces from `app/workspaces/` directly, so this is informational.
   */
  workspaces?: WorkspaceDefinition[];

  /**
   * The extensions this workspace declares, normally
   * `import extensions from '../../config/extensions'`. Declaring one makes
   * it available; whether it is installed and enabled is database state per
   * environment, which a code declaration never overrides.
   */
  extensions?: TangenExtension[];
  /** @deprecated The old name for `extensions`. Read as an alias; rename the key. */
  plugins?: TangenExtension[];
  routes?: import("./custom-routes").CustomRoute[];

  /**
   * Raw Postgres tables (defineTable()) this workspace reads/writes via `ctx.tangen.table()`.
   * This is the canonical, workspace-scoped home — the runtime loads customTables from the
   * workspace config (custom tables carry a `workspace_id` column). The root
   * `app/tangen.config.ts` is still honored as a fallback. See docs/custom-tables.md.
   */
  customTables?: CustomTableDefinition[];

  /** Key-gated API resources declared via defineApiResource() — surfaced in the API manager */
  apiResources?: import("./api-resources").ApiResourceDefinition[];

  /** Code-defined member roles (defineRole()) — resolved live, shown read-only in the Roles tab */
  roles?: import("./member-permissions").RoleSeedDefinition[];
  /**
   * Named image presets applied automatically to every image upload in this workspace.
   * Fields can add extra variants via `variants` in FieldConfig, or opt out with `skipPresets: true`.
   */
  imagePresets?: Record<string, import("./object-types").ImageVariant>;
  /** Workspace-level cache defaults — inherited by all environments unless overridden */
  cache?: CacheConfig;
  /**
   * Extension resolver names to exclude from the master workspace's plugin list.
   * Only meaningful when this workspace has `master` set in `config/workspaces.ts`.
   */
  excludeExtensions?: string[];
  /**
   * Route group names to exclude from the master workspace's route list.
   * Routes without a `group` field are always inherited and cannot be excluded.
   * Only meaningful when this workspace has `master` set in `config/workspaces.ts`.
   */
  excludeRouteGroups?: string[];

  // ── Master-workspace fields ────────────────────────────────────────────────
  // Only meaningful when this workspace is the master (no `master` pointer in
  // config/workspaces.ts). Child workspaces should omit these.

  /** Workspace-level globals (Options / Metafields) */
  globals?: GlobalDefinition[];
  /** Reusable component definitions (app/components) — a `component` field can
   * reference these by name; resolved into the schema at load. */
  components?: import("./object-types").ComponentDef[];
  /** Workspace mail sender - ctx.tangen.sendMail and extension mail such as form notifications. */
  mail?: MailConfig

  /** Background work — scheduled jobs + queued tasks (app/jobs/index.ts). */
  jobs?: import('./jobs').JobsConfig
  /**
   * Custom webhook triggers (app/webhooks.ts) — declare events your code emits
   * via `ctx.emit(name, payload)` so webhooks can subscribe to them. Built-in
   * `object.*` events always work; these are additive.
   */
  webhookTriggers?: import('./webhook-triggers').WebhookTriggerDefinition[]

  /** Media storage backend (app/config/storage.ts). Default: local disk. */
  storage?: import('./storage').StorageConfig

  /** MCP server (app/config/mcp.ts). OFF unless enabled explicitly. */
  mcp?: import('./mcp').McpConfig

  /** Knowledge/RAG (app/config/knowledge.ts). OFF unless enabled explicitly. */
  knowledge?: import('./knowledge').KnowledgeConfig
  /** GraphQL API (app/config/graphql.ts). OFF unless enabled explicitly. */
  graphql?: import('./graphql').GraphqlConfig
  /**
   * Studio (visual builder) settings. `tokens` EXTENDS the design-token
   * slot lists the Studio style panel offers (palette/space/type/radius/
   * width families) - each list names EXTRA slots appended after the
   * built-in defaults, never a replacement. The site's stylesheet must
   * define the matching --tg-* custom properties for every extra slot.
   */
  studio?: StudioConfig
  /** Search platform — query-log analytics retention/enable (Settings → Search). */
  search?: import('./search').SearchConfig
  /** Retention of the operational tables (audit, activity, deliveries, query log, job runs, promotions). Default 90 days. */
  retention?: import('./retention').RetentionConfig
  /** Built-in localization module — locales, default locale */
  localization?: LocalizationConfig;
  /** Site-level content lifecycle hooks */
  contentHooks?: import("./content-hooks").ContentHooks;
  /** Dashboard configuration — widget overrides, custom widgets, activity settings */
  dashboard?: import("./dashboard").DashboardConfig;
  /** Content AI configuration — which LLM providers admins may use */
  ai?: AIConfig;
}

// ─── Studio (visual builder) ─────────────────────────────────────────────────

/**
 * Extra design-token slots per family, appended after Studio's built-in
 * defaults (palette: default|muted|brand|accent|inverse, space:
 * none|xs|sm|md|lg|xl, type: sm|base|lg|xl|2xl|3xl, radius:
 * none|sm|md|full, width: narrow|normal|wide|full). Extension-only by
 * contract: the defaults always stay available.
 */
/** One design-token slot: a bare name, or a name carrying its value. */
export type StudioTokenSlot = string | { name: string; value?: string };

/** A named font and the single source it loads from. */
export interface StudioFontToken {
  name: string;
  /** A family from Studio's curated Google list. */
  google?: string;
  /** Self-hosted files - the answer for a licensed font, and for GDPR. */
  files?: Array<{ url: string; weight?: number; style?: string }>;
  /** A system stack; loads nothing. */
  stack?: string;
}

export interface StudioTokensConfig {
  /**
   * Slot EXTENSIONS beside the defaults. A bare string names a slot and
   * leaves the value to your own CSS (how tokens have always worked); an
   * object carries the value too, which is what lets Studio's Variables
   * panel show it and the generated stylesheet emit it.
   */
  palette?: StudioTokenSlot[];
  space?: StudioTokenSlot[];
  type?: StudioTokenSlot[];
  radius?: StudioTokenSlot[];
  width?: StudioTokenSlot[];
  /**
   * Named fonts. Unlike the other families a font must be LOADED, so each
   * entry names its source: a curated Google family, self-hosted files, or a
   * system stack that loads nothing.
   */
  font?: StudioFontToken[];
}

/** Studio settings on the workspace config (`studio:` key). */
export interface StudioConfig {
  /** Design-token slot EXTENSIONS the style panel offers beside the defaults. */
  tokens?: StudioTokensConfig;
  /**
   * How much styling freedom Studio offers. `governed` (default) is token
   * properties only; `creative` and `both` unlock raw CSS on a style class for
   * members who also hold the `studio:creative` capability - neither alone is
   * enough.
   *
   * The runtime has always read this key (resolveStyleMode) and docs/studio.md
   * has always documented setting it, but it was missing from this interface -
   * so following the docs was a type error.
   */
  styleMode?: "governed" | "creative" | "both";
  /**
   * Where published artifacts (page and stylesheet builds, route pointers)
   * are stored. Absent means the platform's `delivery_artifacts` table:
   * zero config, and a published page keeps resolving with Studio disabled.
   */
  delivery?: StudioDeliveryConfig;
}

/**
 * The delivery store for published Studio artifacts. `table` (default) is
 * the platform table; `s3` writes immutable, content-addressed keys to an
 * S3-compatible bucket under `<keyPrefix>/<workspace>/<env>/`, ready for a
 * CDN. The `s3` block is optional when the workspace's media `storage` is
 * already an s3 config: the bucket and credentials are inherited, the media
 * key prefix is not (artifacts default to `delivery/`).
 */
export interface StudioDeliveryConfig {
  storage?: "table" | "s3";
  s3?: Omit<import("./storage").StorageConfig, "adapter" | "mediaDir">;
}

// ─── Content AI ──────────────────────────────────────────────────────────────

/** LLM providers Tangen can talk to. */
export type AIProviderName = "anthropic" | "openai" | "gemini" | "deepseek" | "kimi" | "qwen";

/**
 * Developer-side Content AI configuration. Key MATERIAL is never set here:
 * each provider's key is a deployment secret the resolver reads by reference
 * (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, ...). `apiKey` may
 * rename the reference per provider - at workspace level here, or per
 * environment in environments.ts. A provider is available to admins only
 * when it is permitted here AND its reference resolves in this deployment.
 */
export interface AIConfig {
  /** Providers admins may choose from. Omitted = all providers (key presence decides). */
  providers?: AIProviderName[];
  /** Per provider, the NAME of the variable holding its key (e.g. anthropic: 'ANTHROPIC_KEY_STAGING'). Defaults per provider. */
  apiKey?: Partial<Record<AIProviderName, string>>;
  /** Override the selectable model list per provider (defaults ship in the API). */
  models?: Partial<Record<AIProviderName, string[]>>;
  /** Override the image-generation model list per provider (empty array disables). */
  imageModels?: Partial<Record<AIProviderName, string[]>>;
  /** Kill switch — hides all Content AI features in the admin. */
  disabled?: boolean;
}

/** Admin-editable content guidelines that steer every AI suggestion. */
export interface AIGuidelines {
  /** Audience & context — who the content is for. */
  audience: string;
  /** Brand voice & tone. */
  voiceTone: string;
  /** Glossary — preferred terms and their meanings. */
  glossary: string;
  /** Legal & compliance constraints. */
  legal: string;
  /** Free-form general instructions. */
  general: string;
}

/** A named guideline set — e.g. "Blog", "Product pages", "Legal docs". */
export interface AIGuidelineProfile {
  id: string;
  name: string;
  guidelines: AIGuidelines;
}

/**
 * Admin-editable Content AI settings, stored per workspace (shared across
 * environments). Edited in Settings > AI.
 */
export interface AISettingsData {
  /** Provider the admin chose; null = not chosen yet (first available wins). */
  provider: AIProviderName | null;
  /** Model the admin chose; null = provider default. */
  model: string | null;
  /** Allow AI title suggestions (off by default). */
  titleGeneration: boolean;
  /** Guideline profiles — at least one; pick per generation when several exist. */
  profiles: AIGuidelineProfile[];
  /** Image-generation default; absent = first available image-capable provider. */
  image?: { provider?: AIProviderName | null; model?: string | null };
}

// ─── Multi-workspace definition ──────────────────────────────────────────────


/**
 * Declares one workspace in a central `config/workspaces.ts`.
 * All workspaces on a deployment share the same schema (`content/`) and process;
 * they differ in data, members, API keys, and environment activation.
 */
export interface WorkspaceDefinition {
  /** Stable unique ID, e.g. 'wsp_india_blog' — must match DB workspaces.id */
  id: string;
  /** Human-readable name, e.g. 'India Blog' */
  name: string;
  /** URL-safe slug, e.g. 'india-blog' — used in CLI and admin routing */
  slug: string;
  /**
   * Slug of another workspace whose plugins and custom routes this workspace inherits.
   * Schema (content types) is always shared across all workspaces — never inherited.
   * Runtime validation of this reference happens in the workspace loader.
   */
  master?: string;
}

/**
 * Identity helper for `config/workspaces.ts` — preserves literal types for TypeScript inference.
 */
export function defineWorkspaces<T extends WorkspaceDefinition[]>(workspaces: T): T {
  return workspaces;
}

/**
 * Runtime representation of a loaded workspace project, used by the API server.
 * Always has a resolved `workspaceId`.
 */
export interface WorkspaceProject {
  /** Workspace mail sender (from config.mail). */
  mail?: MailConfig
  /** Background work registered by the workspace (from config.jobs). */
  jobs?: import('./jobs').JobsConfig
  /** Custom webhook triggers registered by the workspace (from config.webhookTriggers). */
  webhookTriggers?: import('./webhook-triggers').WebhookTriggerDefinition[]
  /** Media storage backend (from config.storage). */
  storage?: import('./storage').StorageConfig
  /** MCP server settings (from config.mcp) — absent/disabled means no MCP. */
  mcp?: import('./mcp').McpConfig
  /** Knowledge/RAG settings (from config.knowledge) — absent/disabled means none. */
  knowledge?: import('./knowledge').KnowledgeConfig
  /** GraphQL settings (from config.graphql) — absent/disabled means no GraphQL. */
  graphql?: import('./graphql').GraphqlConfig
  /** Extensions resolved from config `extensions:` entries at boot. */
  extensions?: import('./extension').LoadedExtension[]
  /** The operator's gateway policy for this deployment (the `gateway` key of the root tangen.config.ts), the ceiling a workspace may only narrow. */
  deploymentGateway?: import('./gateway').GatewayConfig;
  /** Stable unique ID for this workspace — matches workspace_id in the database */
  workspaceId: string;
  /** Human-readable name, used in logs and the admin switcher */
  name: string;
  /** URL-safe slug, e.g. 'india-blog' — used in admin URLs and CLI commands */
  slug?: string;
  /** Object type definitions for this workspace */
  schemas?: import("./object-types").ObjectTypeDefinition[];
  /**
   * The extension entries this workspace's config DECLARED, after alias
   * normalization and master inheritance. The RESOLVED modules are the
   * `extensions` field above - one word meaning both was the confusion.
   */
  declaredExtensions?: TangenExtension[];
  /** Optional full legacy config when loaded from a TangenConfig file */
  config?: TangenConfig;
  /** Workspace-level cache defaults (from WorkspaceConfig.cache) */
  cache?: CacheConfig;
  /** Site-level content lifecycle hooks — run after any extension hooks */
  contentHooks?: import("./content-hooks").ContentHooks;
  /** Workspace-level globals definitions */
  globals?: GlobalDefinition[];
  /** Reusable component registry (app/components) — for the admin picker. */
  components?: import("./object-types").ComponentDef[];
  /** Custom REST routes registered via app/routes/ */
  routes?: import("./custom-routes").CustomRoute[];

  /** Key-gated API resources declared via defineApiResource() — surfaced in the API manager */
  apiResources?: import("./api-resources").ApiResourceDefinition[];

  /** Code-defined member roles (defineRole()) — resolved live, shown read-only in the Roles tab */
  roles?: import("./member-permissions").RoleSeedDefinition[];
  /** Dashboard configuration — widget overrides, custom widgets, activity settings */
  dashboard?: import("./dashboard").DashboardConfig;
  /** Content AI configuration (from WorkspaceConfig.ai) */
  ai?: AIConfig;
  /**
   * Custom key-value pairs from the workspace config.
   * Keyed by env slug → the custom record for that env.
   * Exposed as `ctx.envVars` in custom route handlers.
   */
  /** The site's key declarations from `app/config/site.ts` (`defineSiteConfig`). Values live under `config.site` and per environment. */
  siteConfig?: import('./config-registry').SiteConfigDeclaration;
  /** The workspace's desired membership (`app/config/members.ts`), reconciled into each deployment at boot; never credentials. */
  membersDesired?: import('./members-desired').MembersDesiredState;
  /** Code-declared integrations (`app/config/integrations.ts`): registry fragments under integration.<name>.*. */
  integrations?: import('./integrations').IntegrationsDeclaration;

  /**
   * Slug of the master workspace this workspace inherits plugins and routes from.
   * Populated by the workspace loader when `WorkspaceDefinition.master` is set.
   */
  masterSlug?: string;

}

/**
 * Legacy per-project Tangen configuration shape used by older tangen.config.ts files.
 */
export interface TangenConfig {
  /** Display name for this project */
  project?: string;

  /** Human workspace name ("The Pizza Bakery India") — used when push creates the workspace row */
  name?: string;

  /** Explicit workspace ID — overrides the directory-name-derived ID when set */
  workspaceId?: string;

  /** Path to the schema barrel file (default: './content/index.ts') */
  schema: string;

  /**
   * Realtime timing (tasks/plan-realtime.md R3): presence heartbeat and TTL,
   * the replay window. Absent means the defaults in `RealtimeConfig`.
   */
  realtime?: import('./realtime').RealtimeConfig;

  admin?: {
    /** Route prefix for the admin panel (default: '/admin') */
    basePath?: string;
    /** Admin sidebar navigation options. */
    nav?: {
      /** Show the auto-tracked "Recent" group in the sidebar. Default: false. */
      recents?: boolean;
      /** Links the Settings tree shows under "Other" (http(s) URLs); absent = the row is not shown. */
      links?: { support?: string; docs?: string };
      /**
       * Show the generic "Content" nav section. Default: true. Set false
       * when every content type in the project is hidden from it
       * (`admin.menu.show: false` on all of them, because custom extension
       * pages are the real editing surface) - an empty "Content" section
       * with nothing to show, and nothing a filter will ever find, is pure
       * noise rather than an honest empty state.
       */
      content?: boolean;
    };
  };

  /** Installed extensions */
  extensions?: TangenExtension[];
  /** @deprecated Use extensions */
  apps?: TangenExtension[];


  /** Values for the keys `app/config/site.ts` declares (`site.<name>`), at workspace scope. */
  site?: Record<string, unknown>;
  /** The declarations from `app/config/site.ts`, as the loaders carry them. Never authored here. */
  siteConfig?: import('./config-registry').SiteConfigDeclaration;
  /** The workspace's desired membership (`app/config/members.ts`), reconciled into each deployment at boot; never credentials. */
  membersDesired?: import('./members-desired').MembersDesiredState;
  /** Code-declared integrations (`app/config/integrations.ts`): registry fragments under integration.<name>.*. */
  integrations?: import('./integrations').IntegrationsDeclaration;

  /** Site-level content lifecycle hooks — run after any installed extension hooks */
  contentHooks?: import("./content-hooks").ContentHooks;

  /** Workspace-level globals (Options / Metafields) */
  globals?: GlobalDefinition[];

  /** Custom REST routes served at /api/v1/x/{workspaceId}/{env}/* */
  routes?: import("./custom-routes").CustomRoute[];

  /** Key-gated API resources declared via defineApiResource() — surfaced in the API manager */
  apiResources?: import("./api-resources").ApiResourceDefinition[];

  /** Code-defined member roles (defineRole()) — resolved live, shown read-only in the Roles tab */
  roles?: import("./member-permissions").RoleSeedDefinition[];



  /** Search platform — query-log analytics retention/enable (Settings → Search). */
  search?: import('./search').SearchConfig;

  /** Retention of the operational tables. Default 90 days; see docs/deployment.md. */
  retention?: import('./retention').RetentionConfig;

  /** Dashboard configuration — widget overrides, custom widgets, activity settings */
  dashboard?: import("./dashboard").DashboardConfig;

  /** Content AI configuration — which LLM providers admins may use */
  ai?: AIConfig;

  /** Custom table definitions — created/migrated by `tangen push` */
  customTables?: CustomTableDefinition[];

  /**
   * @deprecated Dead key — the admin panel never reads it. Register admin UI
   * through app/admin/index.ts (APP_UI_REGISTRY / APP_BULK_ACTIONS /
   * ADMIN_EXTENSION), which the admin build bundles via its vite plugin.
   * Kept only so old configs type-check; will be removed.
   */
  adminUI?: {
    components?: Record<string, import("./admin-ui").AdminUIComponent>;
  };

  /**
   * Extension resolver names to exclude from the master workspace's plugin list.
   * Only meaningful when this workspace's config is loaded as a child of a master workspace.
   *
   * @example
   * excludeExtensions: ['@acme/stripe']  // drop Stripe, replaced by Razorpay below
   */
  excludeExtensions?: string[];

  /**
   * Route group names to exclude from the master workspace's route list.
   * Routes without a `group` field are always inherited and cannot be excluded.
   * Only meaningful when this workspace's config is loaded as a child of a master workspace.
   *
   * @example
   * excludeRouteGroups: ['payments-stripe']  // drop Stripe payment routes
   */
  excludeRouteGroups?: string[];

}


/** Installable extension manifest reference */
export interface TangenExtension {
  /** Package name or local path to the extension, e.g. '@tangen/ext-seo' or './extensions/my-ext' */
  resolve: string;
  /**
   * Extension-specific configuration options - whatever that extension's own
   * builder returns (`defineSeoHelpers({ ... })`). Typed as an object rather
   * than a `Record`, because a declared interface is not assignable to an
   * index signature: the documented pattern would not typecheck otherwise.
   */
  options?: object;
}

/** @deprecated Use TangenExtension */
export type TangenApp = TangenExtension;

// ─── Globals ─────────────────────────────────────────────────────────────────

/**
 * A global field supports every field type and config option that a schema field does.
 * `previousName` and `required` are optional here since globals are authored directly.
 */
export type GlobalField = Omit<
  import("./object-types").FieldDefinition,
  "previousName" | "required" | "config"
> & {
  previousName?: string[];
  required?: boolean;
  /** Optional when authoring — `defineGlobals` backfills `{}` so downstream
   *  consumers (the admin editor, storage) always see a config object. */
  config?: import("./object-types").FieldConfig;
};

/**
 * A named set of global fields (Options / Metafields) accessible across the workspace.
 */
export interface GlobalDefinition {
  /** URL-safe slug used as the key, e.g. 'site-settings' */
  name: string;
  /** Human-readable label shown in admin */
  label: string;
  /** Subtitle / help text shown below the label in the admin section header */
  description?: string;
  /** An @tangen/icons name (e.g. 'IconSettings') or a custom `{ src }` image. Rendered next to the label. */
  icon?: import('./object-types').IconRef;
  fields: GlobalField[];
}

// ─── Workspace identity slice ─────────────────────────────────────────────────

/**
 * Slim workspace identity slice used by the settings split-config pattern.
 */
export interface WorkspaceSettings {
  /** Display name for this project */
  project?: string;
  /** Explicit workspace ID — overrides the directory-name-derived ID when set */
  workspaceId?: string;
  /** Path to the schema barrel file (default: './content/index.ts') */
  schema: string;
  admin?: {
    /** Route prefix for the admin panel (default: '/admin') */
    basePath?: string;
    /** Admin sidebar navigation options. */
    nav?: {
      /** Show the auto-tracked "Recent" group in the sidebar. Default: false. */
      recents?: boolean;
      /** Links the Settings tree shows under "Other" (http(s) URLs); absent = the row is not shown. */
      links?: { support?: string; docs?: string };
      /** Show the generic "Content" nav section. Default: true. See TangenConfig.admin.nav.content. */
      content?: boolean;
    };
  };
  /** Site-level content lifecycle hooks */
  contentHooks?: import("./content-hooks").ContentHooks;
}

// ─── define* helpers ──────────────────────────────────────────────────────────

/**
 * Identity helper for the workspace settings split-config — enables TypeScript inference.
 */
export function defineWorkspaceSettings(
  settings: WorkspaceSettings,
): WorkspaceSettings {
  return settings;
}


/**
 * Identity helper for an extensions array — enables TypeScript inference on extension configs.
 */
export function defineExtensions(
  extensions: TangenExtension[],
): TangenExtension[] {
  return extensions;
}

/**
 * Helper for a globals array — enables TypeScript inference and backfills each
 * field's `config` to `{}` when omitted, so an author can write a global field
 * as `{ name, label, fieldType }` without the admin editor meeting an undefined
 * config (the same guarantee schema sub-fields get via normalization).
 */
export function defineGlobals(globals: GlobalDefinition[]): GlobalDefinition[] {
  return globals.map((g) => ({
    ...g,
    fields: (g.fields ?? []).map((f) => ({ ...f, config: f.config ?? {} })),
  }));
}

// ─── Forms ────────────────────────────────────────────────────────────────────

/**
 * Workspace mail sender — used by form notifications and ctx.tangen.sendMail.
 * Configured in code; secrets should come from environment variables
 * (apiKey NAMES the deployment variable that holds the key, e.g. apiKey: 'SENDGRID_API_KEY';
 * the material never enters this file).
 */
export interface MailConfig {
  service: 'smtp' | 'sendgrid' | 'resend';
  apiKey?: string;
  fromEmail?: string;
  fromName?: string;
  /**
   * Custom delivery adapter — wins over `service` when set. Any object with
   * { name, send(message) } (see the MailAdapter contract in @tangen/api's
   * services/mail; adapter packages export ready-made instances).
   */
  adapter?: { name: string; send: (message: import('./custom-routes').SendMailMessage & { from: string }) => Promise<void> };
}

/** @deprecated Renamed to MailConfig (same shape) — forms notifications now ride the shared mailer. */


/** Identity helper for MailConfig — enables inference in app/config/mail.ts. */
export function defineMailConfig(config: MailConfig): MailConfig {
  return config
}

// ─── Localization ─────────────────────────────────────────────────────────────

/** One enabled locale — BCP-47-ish code plus a human label for the admin UI. */
export interface LocaleDef {
  code: string;
  label: string;
}

/**
 * Built-in localization module configuration (enable via `tangen enable
 * localization`). Default-locale values live in the main content tables;
 * translations live in per-type `<type>_i18n` side tables managed by
 * `tangen push`. Fields opt in with `localized: true`.
 */
export interface LocalizationConfig {
  enabled: boolean;
  /** Locale whose values live in the main table — e.g. 'en'. */
  defaultLocale: string;
  /** All authorable locales (the default is included automatically). */
  locales: LocaleDef[];
}

/**
 * Identity helper for LocalizationConfig — enables TypeScript inference in workspace config files.
 */
export function defineLocalizationConfig(config: LocalizationConfig): LocalizationConfig {
  return config;
}

// ─── Extension resolution ─────────────────────────────────────────────────────


/**
 * Declares the reverse proxies in front of the API so a forwarded client
 * address can be trusted. Nothing here is workspace-varying: it is a property
 * of the deployment, and a tenant able to widen proxy trust would be a
 * privilege escalation.
 */
export interface TrustedProxyConfig {
  /** Read forwarding headers at all. Default false - ignore them entirely. */
  enabled?: boolean;
  /**
   * Hops to trust: CIDRs (`10.0.0.0/8`), bare addresses, or the shorthands
   * `'loopback'` and `'private'`. Empty trusts nothing.
   */
  trust?: string[];
  /**
   * Fixed number of proxy hops to skip from the RIGHT of the chain, for fronts
   * whose addresses cannot be expressed as a CIDR. Overrides `trust` when set.
   */
  hops?: number;
  /** Header carrying the chain. Default 'x-forwarded-for'. */
  header?: 'x-forwarded-for' | 'x-real-ip' | 'cf-connecting-ip' | 'true-client-ip';
}
