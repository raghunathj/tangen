/**
 * File Name: tangen.extension.ts
 * Purpose: Forms - the form builder, public embeds, headless schema and
 *          submit routes, submissions, notifications, webhooks, spam
 *          protection and localization - as a bundled extension of Tangen
 *          (tasks/plan-core-slimming.md S3). Its three tables exist only
 *          where it is installed; Flows learns about forms through what this
 *          manifest and server contribute.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Browser-safe: string values only. Options a site may
 *          declare in app/config/extensions.ts: `mail` (the notification
 *          sender override), `captcha` (provider, siteKey, secretKey,
 *          minScore) and `forms` (the app/forms barrel: defineForm and
 *          defineFormHooks entries, for code-side option functions and hooks).
 */
import { defineExtension } from "@tangen/cms";
import { settings } from "@tangen/types";

export default defineExtension({
  id: "forms",
  name: "Forms",
  version: "0.2.0",
  // Provenance, shown on Settings > Extensions.
  author: "Tangen",
  homepage: "https://tangen.app",
  license: "MIT",
  contract: 1,
  description: "Form builder with public embeds, headless schema and submit routes, submissions, notifications, webhooks, spam protection and localization",
  server: "./src/server.ts",
  migrations: "./src/migrations.ts",
  push: "./src/push.ts",

  // Operator settings (Extension Kernel K7.1, Block E.8): the notification
  // SENDER override (the transport is the workspace mailer's) and the captcha
  // for public submissions. Edited on the core settings form (Settings →
  // Extensions → Forms), read through ctx.settings.get(); the secret key is
  // sealed at rest and never returned. Replaces the form_app_settings table
  // and the mail / captcha install options (migration 0002 carries a row over).
  settings: {
    fromEmail: settings.string().optional().label("Sender address").describe("Overrides the workspace mailer's from address on notification mails."),
    fromName: settings.string().optional().label("Sender name").describe("Overrides the workspace mailer's from name on notification mails."),
    captchaProvider: settings.select(["recaptcha_v2", "recaptcha_v3", "hcaptcha", "turnstile"]).optional().label("Captcha provider").describe("Verifies public submissions; clients send _captchaToken. Leave unset to run without a captcha."),
    captchaSiteKey: settings.string().optional().label("Captcha site key").describe("Public; embedded in the form."),
    captchaSecretKey: settings.secret().optional().label("Captcha secret key").describe("Server-side verification key; sealed at rest."),
    captchaMinScore: settings.number().min(0).max(1).optional().label("Minimum score").describe("reCAPTCHA v3 only: submissions below this score are refused."),
  },

  // Grants (Extension Kernel, Block E): what the server entry is allowed to
  // touch, each with its reason. `network:any` is privileged and named on
  // purpose: a form's webhook URL is typed by the operator per form, so no
  // host list can be declared ahead - the same argument as Flows' http action.
  // The kernel's ctx.http still refuses private ranges and audits each call.
  grants: {
    required: [
      { grant: "db:own", reason: "Owns the forms and form_submissions tables its migrations create." },
      { grant: "routes:public", reason: "Serves embeds, schemas and public submits to websites." },
      { grant: "routes:key", reason: "Serves keyed schemas and submits to a workspace API key." },
      { grant: "routes:member", reason: "Serves the builder, submissions and exports to signed-in members." },
      { grant: "jobs:enqueue", reason: "Queues notification mails, webhook deliveries and lifecycle hooks." },
      { grant: "events:emit", reason: "Announces form.submitted for flows and webhooks." },
      { grant: "mail:send", reason: "Sends notification mails through the workspace mailer." },
      { grant: "content:read", reason: "Fills select options from published content when a field asks for it." },
      { grant: "network:any", reason: "Delivers a form's webhook to the URL the operator typed for it, and verifies captcha tokens with the chosen provider." },
      { grant: "flow:contribute-nodes", reason: "Offers the form.submitted trigger to the Flows canvas." },
    ],
    optional: [
      { grant: "ai:generate", reason: "Drafts a form from a description when the workspace has AI enabled." },
    ],
  },
  capabilities: [
    { id: "forms:read", label: "View forms" },
    { id: "forms:manage", label: "Create and manage forms", implies: ["forms:read"] },
    { id: "forms:submissions", label: "View and manage submissions (personal data)", implies: ["forms:read"] },
  ],
  // The `form` field type: a content field that references one of the
  // workspace's forms (stored as its slug or id; the site renders it through
  // the schema route).
  fieldTypes: [
    {
      name: "form",
      label: "Form",
      inherits: "text",
      icon: "IconSurvey",
      description: "A reference to one of the workspace's forms, rendered by the site through the embed schema.",
    },
  ],
  apiKeyScope: {
    label: "Forms",
    description: "Form schema reads and submissions",
    actions: [
      { id: "read", label: "Read the schema" },
      { id: "submit", label: "Submit" },
    ],
    items: { label: "Specific forms" },
  },
  dashboardWidgets: [
    {
      id: "forms-overview",
      title: "Forms",
      description: "Live forms and this week's submissions",
      icon: "IconSurvey",
      type: "stat-group",
      dataPath: "/admin/ext/forms/widget-data",
      href: "/extensions/forms",
      capability: "forms:read",
    },
  ],
  // The admin: the list, the submissions, the builder, a form's settings.
  pages: [
    { path: "", component: "FormsListPage", nav: { label: "Forms", icon: "IconSurvey", order: 30 }, access: { capability: "forms:read" } },
    { path: "submissions", component: "SubmissionsPage", access: { capability: "forms:submissions" } },
    { path: ":formId", component: "FormBuilderPage", access: { capability: "forms:read" } },
    { path: ":formId/settings", component: "FormSettingsPage", access: { capability: "forms:read" } },
    { path: ":formId/settings/:section", component: "FormSettingsPage", access: { capability: "forms:read" } },
  ],
  routes: [
    { path: "", label: "Forms" },
    { path: "submissions", label: "Submissions" },
    { path: ":formId", label: "Form" },
    { path: ":formId/settings", label: "Settings" },
  ],
  commands: [{ label: "New form", icon: "IconSurvey", to: "" }],
});
