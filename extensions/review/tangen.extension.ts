/**
 * File Name: tangen.extension.ts
 * Purpose: The Review workflow extension manifest - editorial approval as a
 *          pure extension: submit for review, approve/reject (RBAC-gated),
 *          and a publish gate so only approved content goes live on EVERY
 *          publish path (admin, REST, bulk, scheduled, local client).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Browser-safe (the admin bundles it for the panel and
 *          the queue page); server logic lives in src/server.ts. The one
 *          operator setting, `requireReviewFor` (type names the gate covers
 *          until a workflow's coverage is saved; empty = every type), is a
 *          manifest setting edited on the core settings form (E.7).
 */
import { defineExtension } from "@tangen/cms";
import { settings } from "@tangen/types";

export default defineExtension({
  id: "review",
  name: "Review workflow",
  version: "1.0.0",
  // Provenance, shown on Settings > Extensions.
  author: "Tangen",
  homepage: "https://tangen.app",
  license: "MIT",
  contract: 1,
  description:
    "Multi-stage editorial review - editors submit drafts into a configurable workflow, reviewers advance, reject, or assign items, and only content that reached the final stage unchanged can be published (scheduled publishes included).",

  server: "./src/server.ts",

  // Operator settings (Extension Kernel K7.1, Block E.7): edited on the core
  // settings form (Settings → Extensions → Review), read by the routes and
  // the content hooks through ctx.settings.get(). No install option, no
  // store mirror.
  settings: {
    requireReviewFor: settings.list().optionsFrom("content-types").default([])
      .label("Types that require review")
      .describe("Content types the review gate covers until a workflow's coverage is saved. Empty covers every type."),
  },

  // Grants (Extension Kernel, Block E): what the server entry is allowed to
  // touch, each with its reason. Coverage is workspace data, so the content
  // grants are unscoped; labels ride on the object write.
  grants: {
    required: [
      { grant: "store:own", reason: "Keeps review records and workflow definitions in the extension's own store." },
      { grant: "routes:member", reason: "Serves the review panel, queue and workflow settings to signed-in members." },
      { grant: "hooks:content", reason: "Gates every publish path on the review state and clears records on delete." },
      { grant: "content:read", reason: "Reads the object under review for its hash and title." },
      { grant: "content:read:draft", reason: "Review happens on drafts; the routes and the staleness check read them." },
      { grant: "content:update", reason: "Mirrors the review stage onto the object's labels." },
      { grant: "locales:all", reason: "Hashes every locale of an object so an approval covers what was approved." },
      { grant: "jobs:enqueue", reason: "Clears mirrored labels after a publish completes the cycle." },
      { grant: "events:emit", reason: "Announces submitted, rejected and withdrawn for webhooks and flows." },
      { grant: "flow:contribute-nodes", reason: "Offers the review triggers and actions to the Flows canvas." },
    ],
  },

  // RBAC (C3): acting on review items is a trust grant surfaced in the roles
  // editor while the extension is installed. Submitting needs no capability -
  // any member who can edit the object can send it for review.
  capabilities: [
    {
      id: "review:approve",
      label: "Act on content reviews (advance, reject, assign)",
      description:
        "Holders can move review items between stages, reject them with a note, and assign them. Reaching the final stage is what allows an object to be published - grant this to reviewers/editors-in-chief.",
    },
    {
      id: "review:manage",
      label: "Manage the review workflow",
      description:
        "Holders can edit the workflow stages and which content types require review. Includes everything review:approve allows.",
      implies: ["review:approve"],
    },
  ],

  // Object-editor panel: current review state + Submit / Approve / Reject.
  // Shown on every type; when the workspace scopes the gate with
  // requireReviewFor, the panel says review is not required for that type.
  sidebarPanels: [
    {
      placement: "sidebar",
      id: "review-status",
      label: "Review",
      icon: "IconShieldCheck",
      component: "ReviewPanel",
      renderMode: "inline",
    },
  ],

  // The reviewers' work queue - inline advance/reject/assign, plus the
  // Workflow settings tab for review:manage holders. section 'root' puts
  // Review top-level in the sidebar, directly after Media.
  pages: [
    {
      path: "",
      component: "ReviewQueuePage",
      nav: {
        label: "Review",
        icon: "IconShieldCheck",
        section: "extensions",
        order: 1,
      },
    },
    // Workflow settings follow the Forms shape: a listing, then a builder.
    // Both are review:manage screens; the Workflows tab only renders for
    // holders, and each page refuses directly too, since a route is
    // reachable by URL whatever the tab row shows.
    { path: "workflows", component: "WorkflowListPage" },
    { path: "workflows/:workflowId", component: "WorkflowDetailPage" },
  ],

  routes: [
    { path: "", label: "Review" },
    { path: "workflows", label: "Workflows" },
  ],
});
