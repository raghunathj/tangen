/**
 * File Name: tangen.extension.ts
 * Purpose: The Studio extension manifest - the marketer's visual landing-
 *          page builder. A Studio page is a VIEW over the same content
 *          object the editor edits: live preview in the center, block tree
 *          on the left, props on the right, same draft save paths.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Browser-safe (the admin bundles it for pages).
 */
import { defineExtension } from "@tangen/cms";

export default defineExtension({
  id: "studio",
  name: "Studio",
  version: "0.1.0",
  // Provenance, shown on Settings > Extensions.
  author: "Tangen",
  homepage: "https://tangen.app",
  license: "MIT",
  contract: 1,
  description:
    "Design landing pages visually: compose block-based pages on a live preview with a drag-sortable block tree, a props rail, a component palette, and saved presets.",

  server: "./src/server.ts",

  // Installing Studio provisions the Instance type on the next `tangen push`.
  // A designer must never need a developer to hand-write a schema file before
  // a shared Block can exist. Declared BY PATH, not inline: this manifest is
  // statically imported into the admin's entry chunk, and the definition pulls
  // in the whole Builder Kit.
  contentTypes: "./src/content-types.ts",

  // Grants (Extension Kernel, Block E): what the server entry is allowed to
  // touch, each with its reason. Studio edits the pages, blocks and globals a
  // designer names at run time, so the content grants are unscoped; the AI
  // generator is optional and names its absence.
  grants: {
    required: [
      { grant: "store:own", reason: "Keeps classes, tags, presets, drafts and the published stylesheet state in the extension's own store." },
      { grant: "routes:member", reason: "Serves the builder, the design panels and publishing to signed-in members." },
      { grant: "routes:key", reason: "Serves the published styles to a site through its API key." },
      { grant: "routes:public", reason: "Serves the workspace stylesheet to the website." },
      { grant: "content:read", reason: "Reads the published pages and instances the canvas composes." },
      { grant: "content:update", reason: "Writes the blocks a designer publishes onto the page." },
      { grant: "content:delete", reason: "Removes an instance a designer deletes from the library." },
      { grant: "globals:read", reason: "Reads the header, footer and other surfaces that are globals." },
      { grant: "globals:write", reason: "Publishes a surface back onto its global." },
      { grant: "events:emit", reason: "Announces design changes so open canvases refresh." },
      { grant: "storage:deliver", reason: "Publishes the stylesheet and the design manifest to the delivery route." },
    ],
    optional: [
      { grant: "ai:generate", reason: "Drafts sections from a brief when the workspace has AI enabled." },
    ],
  },

  // Studio's own rights: custom roles must be granted these explicitly;
  // studio:manage implies studio:edit. Owners and admins pass via the
  // platform-wide role fast path, consistent with porter/flows.
  capabilities: [
    {
      id: "studio:edit",
      label: "Design pages in Studio",
      description:
        "Open Studio, compose and edit block pages on the live preview, and save drafts (same draft save path as the editor).",
    },
    {
      id: "studio:manage",
      label: "Manage Studio presets",
      description:
        "Rename and delete saved section presets shared by the whole workspace.",
      implies: ["studio:edit"],
    },
    {
      id: "studio:design",
      label: "Design in Studio: classes, tokens and interactions",
      description:
        "Create and edit style classes and tag defaults, set the workspace theme's token values and fonts, author interactions, write a page's own CSS, and publish the workspace stylesheet. Split off studio:edit so a marketer can compose pages without being able to change how the site looks. It does NOT imply studio:edit: opening Studio at all still needs that, so a designer is granted both.",
    },
    {
      id: "studio:globals",
      label: "Save the shared header and footer",
      description:
        "Save an APPROVED shared surface from Studio: a global a developer declared as a header or a footer. The write touches only that global's surface field, never the rest of it and never another global, so this is not the platform's globals scope in disguise. Deliberately NOT implied by studio:edit and not granted to the built-in editor role: it is handed to the people who own the site chrome.",
    },
    {
      id: "studio:creative",
      label: "Use Creative (freeform) styling",
      description:
        "Write raw CSS declarations on a style class, a section or a page, stepping outside the design tokens. Off by default and additionally requires the workspace to set studio.styleMode; every change is written to the activity log. It is deliberately NOT implied by studio:design - everyone designing edits classes, only some may write raw CSS.",
      // Raw CSS is design work, so it carries the design grant; it keeps the
      // Studio-session grant too, because a role that held only this one
      // could open Studio before the split and must not lose that quietly.
      implies: ["studio:edit", "studio:design"],
      // The platform gate this capability opens: raw CSS on a block's `_studio` bag (kernel K7).
      gates: ["content.rawCss"],
    },
  ],

  pages: [
    { path: "", component: "StudioHomePage", nav: { label: "Studio", icon: "RiPaintBrushLine", order: 28 }, access: { capability: "studio:edit" } },
    { path: "edit", component: "StudioEditPage", access: { capability: "studio:edit" } },
  ],

  routes: [
    { path: "extensions/studio", label: "Studio" },
  ],
});
