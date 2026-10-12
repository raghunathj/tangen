import { defineExtension } from "@tangen/cms";

/**
 * Porter - the data movement product. A porter carries your goods safely
 * between places: environment promotion (in-place), portable export/import
 * bundles (.tangen-export.tar.gz), and background runs with downloadable
 * reports. The engine lives in the platform core (@tangen/porter package +
 * api services); this extension owns every user-facing surface - uninstall
 * it and the movement UI disappears while content and the engine stay.
 */
export default defineExtension({
  id: "porter",
  name: "Porter",
  version: "1.0.0",
  // Provenance, shown on Settings > Extensions.
  author: "Tangen",
  homepage: "https://tangen.app",
  license: "MIT",
  contract: 1,
  description:
    "Move data safely: promote content between environments, export and import portable bundles, and track background runs with downloadable reports.",

  // Porter's own rights (user decision 2026-08-08): custom roles must be
  // granted these explicitly; porter:write implies porter:read. Owners and
  // admins pass via the platform-wide role fast path, consistent with every
  // other privileged surface (schema:migrate, manage:settings, ...).
  capabilities: [
    { id: "porter:read", label: "View Porter (sync status, runs, reports)" },
    {
      id: "porter:write",
      label: "Move data (promote, export, import)",
      description:
        "Promote content between environments, export bundles and import them. Imports and promotions write content - grant only to trusted members.",
      implies: ["porter:read"],
    },
  ],

  pages: [
    { path: "", component: "PorterHomePage", nav: { label: "Porter", icon: "RiExchangeLine", order: 30 }, access: { capability: "porter:read" } },
    { path: "export", component: "PorterExportPage", nav: { label: "Export", order: 32 }, access: { capability: "porter:write" } },
    { path: "import", component: "PorterImportPage", nav: { label: "Import", order: 33 }, access: { capability: "porter:write" } },
    { path: "runs", component: "PorterRunsPage", nav: { label: "Runs", order: 34 }, access: { capability: "porter:read" } },
    { path: "receive", component: "PorterReceivePage", nav: { label: "Receive", order: 35 }, access: { capability: "porter:write" } },
    { path: "send", component: "PorterSendPage", nav: { label: "Send", order: 36 }, access: { capability: "porter:write" } },
  ],

  routes: [
    { path: "extensions/porter", label: "Porter" },
    { path: "extensions/porter/export", label: "Export" },
    { path: "extensions/porter/import", label: "Import" },
    { path: "extensions/porter/runs", label: "Runs" },
  ],
});
