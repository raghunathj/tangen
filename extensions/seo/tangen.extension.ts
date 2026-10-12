import { defineExtension, settings } from "@tangen/cms";

export default defineExtension({
  id: "seo",
  name: "SEO",
  version: "2.1.1",
  // Provenance, shown on Settings > Extensions.
  author: "Tangen",
  homepage: "https://tangen.app",
  license: "MIT",
  contract: 1,
  description:
    "Production SEO for a Tangen site: metadata with deterministic precedence, canonical URLs, robots directives, sitemaps, robots.txt, redirects and structured data - resolved for the website, never guessed.",
  versionedData: true,
  server: "./src/server.ts",

  // Grants (Extension Kernel, Block E): what the server entry is allowed to
  // touch, each with its reason. `content:read:draft` is deliberate: the
  // resolver reads an object at any status and answers only when it is
  // published, and the member preview reads drafts behind `seo:read`.
  grants: {
    required: [
      { grant: "store:own", reason: "Keeps metadata, settings, redirects, schema maps and artifact versions in the extension store." },
      { grant: "routes:public", reason: "Serves meta, robots.txt, llms.txt, sitemaps and redirects to the website." },
      { grant: "routes:key", reason: "Serves the SDK resolver to a workspace API key." },
      { grant: "routes:member", reason: "Serves the SEO Manager its settings, redirects, schemas, preview and sitemap report." },
      { grant: "hooks:content", reason: "Stores the panel's metadata with the object and retires cached artifacts when content publishes." },
      { grant: "content:read", reason: "Reads published objects for meta, sitemaps and llms.txt." },
      { grant: "content:read:draft", reason: "Reads an object at any status to answer only when published, and drafts for the member preview." },
      { grant: "jobs:enqueue", reason: "Runs the daily Search Console sync as a platform task." },
    ],
    // S3: share-image alt text through a vision provider. Both optional: without them the panel's field is hand-written.
    optional: [
      { grant: "ai:vision", reason: "Describes an object's share image to write its alt text (og:image:alt)." },
      { grant: "media:read", reason: "Reads the share image's bytes to hand them to the vision provider." },
      { grant: "connections:google.search-console.read", reason: "Reads clicks, impressions and positions from the Google connection an operator chose. Read-only, and only that one capability of Google." },
      { grant: "ai:generate", reason: "Proposes a page's SEO title, description and answer summary with your AI provider. The proposal is a draft for review." },
    ],
  },

  /**
   * F2: Search Console is READ through the Google connector pack now, not
   * through a connector SEO offers itself. Optional on purpose - sitemaps,
   * redirects, titles and the panel are the bulk of SEO and need no Google at
   * all - so a project without the pack keeps every one of them and the
   * Analytics surfaces say what is missing.
   */
  requires: {
    optional: { services: ["google.search-console@^1"] },
  },

  // V3: which Search Console connection and property the manager reads. On
  // the core settings form (Settings > Extensions > SEO); the site-level SEO
  // settings (templates, social, robots) stay on the extension's own store.
  settings: {
    searchConsole: settings.connection("google").optional().label("Search Console connection").describe("Which Google account to read Search Console with. The picker says what to do when there is none.").requires("connections:google.search-console.read"),
    // F2: PICK the property, do not type it. Search Console spells a property
    // exactly (`sc-domain:acme.com` and `https://www.acme.com/` are different
    // things), and a typo reads as "no data" rather than as a mistake. The
    // pack declares `property` as a resource of the Google connector, so the
    // platform lists the real ones through the connection chosen above -
    // including the ones this account may see but not read, marked
    // unselectable with the reason.
    searchConsoleProperty: settings.resource("google", "property").dependsOn("searchConsole").optional().label("Search Console property").describe("The property to read. Listed from the connection above; an unverified one is shown but cannot be chosen."),
    analyticsRetentionDays: settings.number().min(1).max(480).default(90).label("Analytics retention (days)").describe("How many days of daily Search Console aggregates to keep. Daily totals only; no raw analytics events are stored."),
    analyticsRowLimit: settings.number().min(1).max(1000).default(200).label("Rows per day").describe("How many top pages and top queries to keep for each day."),
  },

  // What a workspace API KEY may do with this extension (the key editor shows
  // this section while SEO is active). The site reads: resolved metadata for a
  // page, and the whole redirect map.
  apiKeyScope: {
    label: "SEO",
    description: "Resolved metadata and the redirect map a site reads",
    actions: [{ id: "read", label: "Read SEO and redirects" }],
  },

  capabilities: [
    { id: "seo:read", label: "View SEO settings and redirects" },
    {
      id: "seo:write",
      label: "Manage SEO redirects",
      description:
        "Create, edit and delete redirects. A redirect changes where a visitor lands - grant only to members you trust with the site's routing.",
      implies: ["seo:read"],
    },
  ],

  // V8: the workspace dashboard reads the LAST stored health report; it never
  // triggers a scan, so opening the dashboard costs one store read.
  dashboardWidgets: [{
    id: "seo-health",
    title: "SEO health",
    description: "How the published pages stand, from the last check.",
    icon: "IconSearch",
    type: "stat-group",
    dataPath: "health-widget",
    href: "extensions/seo",
    capability: "seo:read",
  }],

  pages: [
    {
      // The SEO Manager: one sidebar entry (the Dashboard); inside it the
      // sidebar becomes the manager's own menu (plan-seo-manager-v2 V0), one
      // page per child path below. A v1 `?tab=` link is sent to its page.
      path: "",
      component: "SeoManagerPage",
      nav: { label: "SEO Manager", icon: "IconSearch", section: "extensions", order: 40 },
      access: { capability: "seo:read" },
    },
    { path: "analytics", component: "SeoAnalyticsPage", access: { capability: "seo:read" } },
    { path: "titles", component: "SeoTitlesPage", access: { capability: "seo:read" } },
    { path: "schema", component: "SeoSchemaPage", access: { capability: "seo:read" } },
    { path: "sitemap", component: "SeoSitemapPage", access: { capability: "seo:read" } },
    { path: "redirects", component: "SeoRedirectsPage", access: { capability: "seo:read" } },
    { path: "not-found", component: "SeoNotFoundPage", access: { capability: "seo:read" } },
    { path: "ai-geo", component: "SeoAiGeoPage", access: { capability: "seo:read" } },
    { path: "tools", component: "SeoToolsPage", access: { capability: "seo:read" } },
    { path: "settings", component: "SeoSettingsPage", access: { capability: "seo:read" } },
  ],

  sidebarPanels: [
    {
      id: "seo",
      label: "SEO",
      icon: "IconSearch",
      component: "SeoPanel",
      ai: {
        // capability only - enable per workspace via config: options: { ai: true }
        instructions:
          "Write search-optimised metadata only - never invent facts not present in the content. seoTitle max 60 characters. metaDescription 120-160 characters, plain text, no quotes or emoji.",
        fields: [
          { name: "focusKeyword", label: "Focus keyword", fieldType: "text", config: { ai: { hint: "The single search phrase this content should rank for." } } },
          { name: "seoTitle", label: "SEO title", fieldType: "text", config: { ai: { hint: "Search-result title, max 60 characters, include the focus keyword." } } },
          { name: "metaDescription", label: "Meta description", fieldType: "textarea", config: { ai: { hint: "Compelling search snippet, 120-160 characters, plain text." } } },
        ],
      },
    },
  ],
});

// NOT declared, deliberately:
//
// - `fieldTypes: ['seo-metadata']`. It was in the manifest and implemented
//   NOWHERE - no editor rendered it and no validator checked it, so a site
//   developer could select a field that did not work (Phase 9A finding 9A-1).
//   SEO metadata belongs to the panel, which is where it always actually was.
// - `migrations` and `customTables`. SEO owns redirects, its artifact version
//   and every object's metadata, and all of it lives in the platform's own
//   extension store - already workspace and environment scoped, already
//   indexed for the single-row read a redirect lookup performs. A dedicated
//   table would have been a second, weaker copy of that index.
