/**
 * File Name: tangen.extension.ts
 * Purpose: The Flows extension manifest — Shopify-Flow-style automations
 *          for marketing teams: one trigger, visual conditions, linear
 *          actions, per-run step logs. Everything ships through the
 *          generic extension surfaces (no core changes).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Browser-safe (the admin bundles it for pages);
 *          server logic lives in src/server.ts.
 */
import { defineExtension } from "@tangen/cms";
import { settings } from "@tangen/types";

export default defineExtension({
  id: "flows",
  name: "Flows",
  version: "1.0.0",
  // Provenance, shown on Settings > Extensions.
  author: "Tangen",
  homepage: "https://tangen.app",
  license: "MIT",
  contract: 1,
  description:
    "Automations without developers - trigger on platform events, filter with conditions, run actions (HTTP, content updates), and read per-step run logs.",

  server: "./src/server.ts",

  // Operator settings (E.15). `allowPrivateNetworks` is permission-aware: it
  // takes effect only when the installation holds the optional
  // `network:private` grant; otherwise the form shows it unavailable with the
  // reason, reads answer false, and enabling it is refused naming the grant.
  settings: {
    allowPrivateNetworks: settings.boolean().default(false).requires("network:private")
      .label("Allow private networks")
      .describe("Lets http steps reach private and loopback hosts (dev and self-hosted). Needs the network:private permission approved for this installation."),
  },

  // Grants (Extension Kernel, Block E): what the server entry is allowed to
  // touch, each with its reason. `network:any` is privileged and named on
  // purpose: the http action calls the URL the flow author typed, which is
  // the feature; the kernel's ctx.http still refuses private ranges and
  // audits each call. `network:private` is optional: the dev/self-hosted
  // escape hatch `allowPrivateNetworks` only reaches a private host when the
  // install also holds that grant.
  grants: {
    required: [
      { grant: "store:own", reason: "Keeps flow definitions, run logs, schedules and the webhook signing secret in the extension's own store." },
      { grant: "routes:member", reason: "Serves the builder, the run log and the catalog to signed-in members." },
      { grant: "routes:public", reason: "Receives inbound webhooks at the extension's own signed URL." },
      { grant: "jobs:enqueue", reason: "Runs every flow on the durable queue, including schedules and retries." },
      { grant: "events:emit", reason: "Announces flow lifecycle events and the custom events flows emit." },
      { grant: "events:subscribe", reason: "Triggers on platform, custom and extension events, and pauses flows whose nodes an uninstall removed." },
      { grant: "delegation:act-as", reason: "Runs a flow as its owner, its initiator or a chosen identity, with that person's current authority." },
      { grant: "realtime:publish", reason: "The realtime_publish action posts on the declared notify channel." },
      { grant: "mail:send", reason: "The email action sends through the workspace mailer." },
      { grant: "content:read", reason: "Query and content steps read objects the flow names." },
      { grant: "content:read:draft", reason: "A query step may ask for drafts; which status is the flow author's choice." },
      { grant: "content:update", reason: "Content steps update fields and labels on the objects the flow names." },
      { grant: "content:publish", reason: "Content steps publish and unpublish the objects the flow names." },
      { grant: "network:any", reason: "The http action calls the URL the flow author typed; no host list can be declared ahead of it." },
    ],
    optional: [
      { grant: "network:private", reason: "Lets the Allow private networks setting reach private hosts on a dev or self-hosted deployment." },
    ],
  },

  // Realtime R4: the channel the `realtime_publish` action uses by default.
  // Any member may subscribe to `ext:flows:notify`; what a flow puts in the
  // envelope is the author's call (manage:flows is already a trust grant).
  realtime: { channels: [{ name: "notify" }] },

  // RBAC capabilities (C3) - declared here, not in core. The roles editor
  // lists them while Flows is installed; manage:flows implies read:flows.
  // NB: a flow runs with elevated (system) power, so manage:flows is a trust
  // grant - the builder warns the author. See tasks/plan-flows-platform.md.
  capabilities: [
    { id: "read:flows", label: "View flows & runs" },
    {
      id: "manage:flows",
      label: "Create & manage flows (elevated: flows run with system rights)",
      description:
        "A flow's actions run with system-level rights and can do more than the role's own content permissions. Grant only to trusted members.",
      implies: ["read:flows"],
    },
  ],

  pages: [
    { path: "", component: "FlowsListPage", nav: { label: "Flows", icon: "IconGitBranch", order: 20 } },
    // The canvas is the one and only builder now (the linear editor is retired).
    // Both :flowId and :flowId/canvas open it, so old links keep working.
    { path: ":flowId", component: "FlowCanvasPage" },
    { path: ":flowId/runs", component: "FlowRunsPage" },
    { path: ":flowId/canvas", component: "FlowCanvasPage" },
  ],

  routes: [
    { path: ":flowId", label: "Edit flow" },
    { path: ":flowId/runs", label: "Runs" },
    { path: ":flowId/canvas", label: "Canvas" },
  ],

  // Dashboard: live counts served by the extension's widget-data route
  // (computed on request - "runs today" never goes stale).
  dashboardWidgets: [
    {
      id: "flows-overview",
      title: "Flows",
      description: "Active automations and today's runs",
      icon: "IconGitBranch",
      type: "stat-group",
      dataPath: "/admin/ext/flows/widget-data",
      // Card + stats deep-link into pages gated by read:flows, so the
      // widget carries the same capability (hidden without it).
      href: "/extensions/flows",
      capability: "read:flows",
    },
  ],
});
