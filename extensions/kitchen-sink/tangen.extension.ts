import { defineExtension } from "@tangen/cms";

/**
 * Kitchen Sink — the reference extension. It exists to exercise and document
 * EVERY surface a Tangen extension can contribute:
 *
 *   - fieldTypes        a custom field type with per-field config
 *   - sidebarPanels     object-editor panels (inline AND modal render modes)
 *   - dashboardWidgets  a stat card fed by extension data
 *   - pages             full admin pages with sidebar nav + access rules
 *   - routes            breadcrumb labels for those pages
 *   - server            content hooks + install/uninstall lifecycle
 *
 * This manifest MUST stay browser-safe: string/JSON values only, no server
 * imports, no function values — the admin build bundles it to resolve panel
 * and page components (named exports of ./src/index.ts).
 *
 * Install it into a workspace from Settings → Extensions (or keep it in
 * app/config/extensions.ts during development). Uninstalling removes its
 * pages, nav, panels, and widget without a rebuild.
 */
export default defineExtension({
  id: "kitchen-sink",
  name: "Kitchen Sink",
  version: "1.0.0",
  // Provenance, shown on Settings > Extensions.
  author: "Tangen",
  homepage: "https://tangen.app",
  license: "MIT",
  contract: 1,
  description:
    "Every extension surface in one place - components, pages, panels, hooks, and lifecycle, each with copyable code.",

  // Panel data (the Scratch Notes panel) is content metadata — snapshot it
  // with revisions so restoring a revision restores the notes too.
  versionedData: true,

  // Server-side contributions live in a separate entry so this manifest
  // stays browser-safe. See ./src/server.ts.
  server: "./src/server.ts",

  // ── Lifecycle v1 (docs/architecture/extension-lifecycle.md) ──────────
  // Ledgered SQL migrations, run at install and upgrade, never at runtime.
  migrations: "./src/migrations.ts",
  // Flows is used when present (its catalog picks our triggers/actions up)
  // and nothing here requires it: absence is not an error.
  optional: { extensions: ["flows"] },
  // The install options this extension understands; validated at install
  // and upgrade. A `secret` is never logged and has no default.
  config: {
    greeting: { type: "string", default: "hello", label: "Greeting", description: "What the ping route says." },
    tickEveryMs: { type: "number", default: 0, label: "Auto-tick interval (ms)", description: "0 keeps the counter manual; otherwise onStart ticks it on this interval." },
    webhookSecret: { type: "string", secret: true, label: "Webhook secret" },
  },
  // Environment variable NAMES the server entry may read; never values.
  secrets: ["KITCHEN_SINK_TOKEN"],

  // ── Grants (Extension Kernel, Block E) ──────────────────────────────────
  // What the server entry is allowed to touch, each with the reason the
  // operator reads at install. The kernel hands out exactly these: without
  // `store:own` there is no ctx.store, without `realtime:publish` no
  // ctx.realtime, without `routes:key` the ping route never mounts. The
  // reference for a least-privilege manifest: derive the list from what the
  // code does (extensions/kitchen-sink/__tests__/grants.test.ts proves it),
  // never from what might be convenient later.
  grants: {
    required: [
      { grant: "store:own", reason: "Keeps the scratch notes and the counter in the extension's own store." },
      { grant: "db:own", reason: "Owns the kitchen_sink_log table its migrations create." },
      { grant: "realtime:publish", reason: "Publishes each counter tick on the declared counter channel." },
      { grant: "routes:member", reason: "Serves the Realtime page's tick and counter routes to signed-in members." },
      { grant: "routes:key", reason: "Serves the rate-limited ping route to workspace API keys." },
      { grant: "hooks:content", reason: "Persists the scratch notes panel and the last-change widget from content hooks." },
      { grant: "flow:contribute-nodes", reason: "Offers the demo trigger and the echo action to the Flows canvas." },
      { grant: "mcp:contribute-tools", reason: "Offers the ping tool to MCP clients when the workspace enables MCP." },
    ],
    optional: [
      { grant: "secrets:own", reason: "Reads KITCHEN_SINK_TOKEN when the deployment sets it; nothing here needs it." },
    ],
  },

  // ── Realtime channels (R4) ──────────────────────────────────────────────
  // Declaring a channel is what lets the server publish on it
  // (ctx.realtime.publish({ channel: 'counter', ... })) and lets the admin
  // subscribe to `ext:kitchen-sink:counter`. No `capability` means any
  // member of the workspace may subscribe; add one to gate it. See the
  // Realtime page and ./src/realtime-counter.ts.
  realtime: { channels: [{ name: "counter" }] },

  // ── Permissions (RBAC) — the reference for permissions.resources ─────────
  // Declare the RESOURCES this extension governs; each action compiles to a
  // `<action>:<resource>` capability (read:notes, write:notes, delete:notes)
  // that appears in the roles editor's permission tree as Read / Write / Delete
  // under "Kitchen Sink", and is checked server-side with req.can('write:notes').
  // Standard verbs get standard labels and implications (write/delete imply
  // read) for free; a custom action gives its own { id, label }. See
  // docs/rbac.md and the "Extending Tangen" page. Declaring these adds role
  // OPTIONS only - it never touches content.
  permissions: {
    resources: [
      { id: "notes", label: "Scratch notes", actions: ["read", "write", "delete"] },
      { id: "tools", label: "Sink tools", actions: ["read", { id: "run", label: "Run a tool" }] },
    ],
  },

  // ── Field types, panels and widgets: documented, not registered ─────────
  // A field type, an editor panel and a dashboard widget were declared here
  // as live demos, which meant they appeared on every content type and editor
  // of any workspace that installed this extension. The Kitchen Sink is a
  // reference, not a set of production fields - so the CODE for each now lives
  // on the "Extending Tangen" page (./src/pages/extending.tsx) as copyable
  // snippets, and nothing is registered onto your content. Re-add a
  // `fieldTypes`, `sidebarPanels` or `dashboardWidgets` block to make one live.
  // ── Full admin pages ────────────────────────────────────────────────────
  // Mounted at /:workspaceId/:env/extensions/kitchen-sink/<path> while the
  // extension is installed + active. Pages with `nav` appear in the sidebar
  // Extensions section (and replace the automatic app entry). `access`
  // gates a page to roles/capabilities — others lose the nav item too.
  pages: [
    // The category index — nav entry replaces the automatic app entry.
    // section: 'devspace' homes the whole tree in the Devspace section (owner/
    // admin only); plain sub-pages nest under it, while the ai-demo sub-page
    // (section: 'ai') escapes to the AI section. The route is unchanged.
    { path: "", component: "SinkOverviewPage", nav: { label: "Kitchen Sink", icon: "RiPencilRuler2Line", section: "devspace", order: 10 } },
    // Category sub-pages — nav on a sub-page nests it under the root entry
    // (second-level sidebar nav, expandable like taxonomy types)
    // The design system itself: read this first.
    { path: "lightfield", component: "SinkLightfieldPage", nav: { label: "Lightfield", icon: "IconSparkles", order: 20 } },
    { path: "typography", component: "SinkTypographyPage", nav: { label: "Typography", order: 30 } },
    { path: "buttons", component: "SinkButtonsPage", nav: { label: "Buttons", order: 31 } },
    { path: "cards", component: "SinkCardsPage", nav: { label: "Cards", order: 32 } },
    { path: "headers", component: "SinkHeadersPage", nav: { label: "Headers", order: 33 } },
    { path: "navigation", component: "SinkNavigationPage", nav: { label: "Sidebars & nav", order: 34 } },
    { path: "lists", component: "SinkListsPage", nav: { label: "Lists", order: 35 } },
    { path: "images", component: "SinkImagesPage", nav: { label: "Images & media", order: 36 } },
    { path: "forms", component: "SinkFormsPage", nav: { label: "Forms", order: 37 } },
    { path: "feedback", component: "SinkFeedbackPage", nav: { label: "Feedback", order: 38 } },
    { path: "layout", component: "SinkLayoutPage", nav: { label: "Layout", order: 39 } },
    { path: "permissions", component: "SinkPermissionsPage", nav: { label: "Permissions", order: 40 } },
    { path: "realtime", component: "SinkRealtimePage", nav: { label: "Realtime", order: 41 } },
    // The three content-mutating surfaces, as copyable code (not registered live).
    { path: "extending", component: "SinkExtendingPage", nav: { label: "Extending Tangen", icon: "RiPencilRuler2Line", order: 50 } },
    // Role-gated page — page AND sidebar entry only exist for owners/admins
    {
      path: "admin",
      component: "SinkAdminOnlyPage",
      nav: { label: "Sink Admin", icon: "IconShieldCheck", order: 90 },
      access: { roles: ["owner", "admin"] },
    },
    // AI-section registry demo — nav.section 'ai' moves this page into the
    // AI sidebar section (peer of Knowledge/Q&A/Agents), not Extensions
    {
      path: "ai-demo",
      component: "SinkAiDemoPage",
      nav: { label: "Sink AI demo", icon: "IconSparkles", section: "ai", order: 60 },
    },
  ],

  // ── Breadcrumbs ─────────────────────────────────────────────────────────
  routes: [
    { path: "", label: "Kitchen Sink" },
    { path: "lightfield", label: "Lightfield" },
    { path: "typography", label: "Typography" },
    { path: "buttons", label: "Buttons" },
    { path: "cards", label: "Cards" },
    { path: "headers", label: "Headers" },
    { path: "navigation", label: "Sidebars & nav" },
    { path: "lists", label: "Lists" },
    { path: "images", label: "Images & media" },
    { path: "forms", label: "Forms" },
    { path: "feedback", label: "Feedback" },
    { path: "layout", label: "Layout" },
    { path: "permissions", label: "Permissions" },
    { path: "realtime", label: "Realtime" },
    { path: "extending", label: "Extending Tangen" },
    { path: "admin", label: "Sink Admin" },
  ],

  // ── Command palette quick actions (⌘K) — at most 3 are surfaced ──────────
  // Declarative: each `to` is resolved under this extension's own routes.
  commands: [
    { label: "Kitchen Sink: Buttons", icon: "IconSparkles", to: "buttons" },
    { label: "Kitchen Sink: Forms", icon: "IconSparkles", to: "forms" },
    { label: "Kitchen Sink: Feedback", icon: "IconSparkles", to: "feedback" },
  ],
});
