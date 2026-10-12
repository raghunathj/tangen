/**
 * File Name: tangen.extension.ts
 * Purpose: The Variants extension manifest - A/B experiments and timed
 *          takeovers built entirely on the generic extension surface:
 *          variant siblings are real content objects, experiment config
 *          lives in the extension store, frontends bucket visitors via
 *          the SDK, and takeovers ride the durable task queue.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Browser-safe (the admin bundles it for the page and
 *          the editor panel); server logic lives in src/server.ts.
 */
import { defineExtension } from "@tangen/cms";

export default defineExtension({
  id: "variants",
  name: "Variants",
  version: "1.0.0",
  // Provenance, shown on Settings > Extensions.
  author: "Tangen",
  homepage: "https://tangen.app",
  license: "MIT",
  contract: 1,
  description:
    "A/B experiments and timed takeovers on real content objects - create variant siblings, run split experiments served to your frontend, and schedule a temporary takeover that reverts itself.",

  server: "./src/server.ts",

  // Grants (Extension Kernel, Block E): what the server entry is allowed to
  // touch, each with its reason. Variants are real content objects, so the
  // content grants are the feature; `(*)` every type, because which type
  // gets a variant is the editor's choice at run time.
  grants: {
    required: [
      { grant: "store:own", reason: "Keeps lineage, experiment and takeover records in the extension's own store." },
      { grant: "routes:member", reason: "Serves the Experiments page and the editor panel their routes." },
      { grant: "routes:key", reason: "Serves running experiments to frontends through a workspace API key." },
      { grant: "content:read", reason: "Reads the base object a variant copies and the target a takeover snapshots." },
      { grant: "content:read:draft", reason: "Variants start as drafts; the lineage and takeover routes read them." },
      { grant: "content:create", reason: "Creates the variant sibling as a new draft of the same type." },
      { grant: "content:update", reason: "Sets the variant's slug, applies and reverts a takeover, and labels base and variant." },
      { grant: "content:publish", reason: "Publishes the target after a takeover applies or reverts." },
      { grant: "jobs:enqueue", reason: "Schedules the apply and revert steps of a takeover on the durable queue." },
      { grant: "events:emit", reason: "Announces variant-created, experiment and takeover events for webhooks and flows." },
    ],
  },

  // RBAC capability (C3) - gates every admin route and the Experiments page.
  capabilities: [
    {
      id: "manage:variants",
      label: "Manage variants & experiments",
      description:
        "Create content variants, start and stop A/B experiments, and schedule timed takeovers.",
    },
  ],

  // Object-editor panel: lineage for the current object (base: list variants
  // and create one; variant: link back to its base).
  sidebarPanels: [
    {
      id: "variant-lineage",
      label: "Variants",
      icon: "IconCopy",
      component: "VariantLineagePanel",
      renderMode: "inline",
    },
  ],

  pages: [
    {
      path: "",
      component: "ExperimentsPage",
      nav: { label: "Experiments", icon: "RiTestTubeLine", section: "extensions", order: 60 },
      access: { capability: "manage:variants" },
    },
  ],

  routes: [{ path: "", label: "Experiments" }],
});
