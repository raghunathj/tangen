/**
 * File Name: tangen.extension.ts
 * Purpose: Site users - the site's OWN end users, never workspace members:
 *          email and password, one-time codes by email or SMS, SSO through
 *          Google, GitHub or any OpenID Connect provider, anonymous sessions,
 *          password reset, profile fields, and the admin that manages them.
 *          A bundled extension of Tangen (tasks/plan-core-slimming.md S4):
 *          its tables exist only where it is installed, and it is the first
 *          site identity provider on the kernel's seam - install a different
 *          one (Supabase, Firebase, Clerk) and core never notices.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Browser-safe: string values only. Options a site may
 *          declare in app/config/extensions.ts are the `AuthOptions` of
 *          `./src/contract` - providers, profileFields, hooks, token TTLs,
 *          roles, allowRegistration, allowAnonymous, ssoRedirectUrl, otp,
 *          sms.
 */
import { defineExtension } from "@tangen/cms";

export default defineExtension({
  id: "auth",
  name: "Site users",
  version: "1.0.0",
  // Provenance, shown on Settings > Extensions.
  author: "Tangen",
  homepage: "https://tangen.app",
  license: "MIT",
  contract: 1,
  description: "Sign-in for your site's users: password, one-time codes, SSO, anonymous sessions, profile fields",
  server: "./src/server.ts",
  migrations: "./src/migrations.ts",
  push: "./src/push.ts",

  // Grants (Extension Kernel, Block E): what the server entry is allowed to
  // touch, each with its reason. Outbound reach is named host by host for the
  // built-in providers; an OpenID Connect issuer the operator configures is
  // granted through its install-options path, so no `network:any`. Secrets
  // come from ctx.secrets only; the two platform keys are named.
  grants: {
    required: [
      { grant: "db:own", reason: "Owns the site user, session and challenge tables its migrations create." },
      { grant: "store:own", reason: "Keeps a generated development signing secret when no JWT_SECRET is set." },
      { grant: "routes:key", reason: "Serves register, login, refresh, profile, one-time codes and SSO start to the site through its API key." },
      { grant: "routes:public", reason: "Receives the SSO provider's callback, which carries no key." },
      { grant: "routes:member", reason: "Serves the Site users pages and the sign-in methods view to signed-in members." },
      { grant: "events:emit", reason: "Announces user.registered and user.signed_in for flows and webhooks." },
      { grant: "mail:send", reason: "Sends one-time codes and password reset mails through the workspace mailer." },
      { grant: "secrets:JWT_SECRET", reason: "Derives the site session signing key from the deployment's JWT secret." },
      { grant: "secrets:TANGEN_SITE_JWT_SECRET", reason: "Uses a dedicated site session signing key when the deployment sets one." },
      { grant: "network:accounts.google.com", reason: "Google sign-in: the authorization endpoint." },
      { grant: "network:oauth2.googleapis.com", reason: "Google sign-in: the token endpoint." },
      { grant: "network:www.googleapis.com", reason: "Google sign-in: the profile endpoint." },
      { grant: "network:github.com", reason: "GitHub sign-in: the authorization and token endpoints." },
      { grant: "network:api.github.com", reason: "GitHub sign-in: the profile and e-mail endpoints." },
      { grant: "network:option(providers.*.issuer)", reason: "Any OpenID Connect issuer configured in the providers option: its discovery, token and profile endpoints." },
      { grant: "flow:contribute-nodes", reason: "Offers the user.registered and user.signed_in triggers to the Flows canvas." },
    ],
  },

  capabilities: [
    { id: "auth:read", label: "View site users" },
    { id: "auth:manage", label: "Manage site users (edit, block, revoke sessions)", implies: ["auth:read"] },
  ],
  // The site key: the API key a site sends as X-Tangen-Key (or Bearer) on the
  // sign-in routes. `sessions` is the grant that lets a key register, sign
  // in, refresh and sign out the site's users.
  apiKeyScope: {
    label: "Site users",
    description: "Sign the site's users in and out with this key",
    actions: [
      { id: "sessions", label: "Sign in, register and manage sessions" },
    ],
  },
  dashboardWidgets: [
    {
      id: "auth-overview",
      title: "Site users",
      description: "Accounts and who signed in this week",
      icon: "IconUsers",
      type: "stat-group",
      dataPath: "/admin/ext/auth/widget-data",
      href: "/extensions/auth",
      capability: "auth:read",
    },
  ],
  pages: [
    { path: "", component: "UsersListPage", nav: { label: "Site users", icon: "IconUsers", order: 40 }, access: { capability: "auth:read" } },
    { path: "methods", component: "SignInMethodsPage", access: { capability: "auth:read" } },
    { path: ":userId", component: "UserDetailPage", access: { capability: "auth:read" } },
  ],
  routes: [
    { path: "", label: "Site users" },
    { path: "methods", label: "Sign-in methods" },
    { path: ":userId", label: "User" },
  ],
});
