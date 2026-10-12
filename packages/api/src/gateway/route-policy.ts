/**
 * File Name: route-policy.ts
 * Purpose: The route/surface policy table - what every request surface
 *   declares about itself - plus the prefix matcher that resolves a request to
 *   one row.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure data plus a prefix match; no I/O, so resolution
 *   costs nothing per request and can run before the workspace is known.
 *
 *   OBSERVE-ONLY IN M1. Nothing reads this to make a decision yet:
 *   middleware/auth.ts still decides access by comparing URL prefixes inside
 *   its derive, and it keeps doing so until M3. Every row below is a
 *   description of CURRENT behaviour, not a change to it, so the first commit
 *   that puts the table in the chain changes nothing observable. The test file
 *   cross-checks the rows against the source of auth.ts precisely so the two
 *   cannot drift apart while the rest is built.
 *
 *   Three properties are load-bearing. A `public` row MUST carry a written
 *   reason, because the review artefact the current prefix list cannot produce
 *   is "why is this open". A route that checks a credential the platform cannot
 *   see - a refresh cookie, a login body, a webhook token in the URL, a
 *   transfer token, a site key - is `self-authenticating` and NOT public, and
 *   its reason must name that credential; calling those rows public said the
 *   opposite of what they do. And an unmatched path resolves to the FALLBACK -
 *   authenticated, management category - because silently defaulting to public
 *   would be a catastrophe and silently defaulting to authenticated without
 *   saying so would hide a route nobody declared.
 *
 *   COVERAGE IS A RULE, NOT A HABIT. Every route the API mounts must resolve
 *   to a row here; gateway-route-coverage.test.ts walks Elysia's own route
 *   registry and fails on any that reaches FALLBACK_POLICY. That the fallback
 *   guesses the ACCESS mode right for most of them is what made the gap
 *   invisible for so long: an undeclared route still gets the wrong CATEGORY,
 *   so it is counted in the wrong rate-limit bucket, given the wrong CORS
 *   treatment, reported on the wrong line of the monitor's gateway panel, and
 *   carries no written reason a reviewer can read. So: mount a route, add a
 *   row. Every row carries a `reason`, not only the two modes that must.
 *
 *   A row's path is a PREFIX by default, or a whole-path PATTERN when it
 *   contains ':' or '*' (Elysia's own syntax, the same the dynamic table
 *   uses). Patterns exist for the case a prefix cannot express: two routes
 *   under one mount that differ in a middle segment and sit on opposite sides
 *   of authMiddleware.
 */
import { RETIRED_ROUTES } from '@tangen/types'
import { defineRoutePolicy, type AccessMode, type RoutePolicy } from '@tangen/types'
import { matchesPattern, resolveDynamicRoutePolicy } from './dynamic-policies'

/**
 * What a request matching no row gets: the most restrictive answer that can
 * still be served. Deliberately not exported as part of ROUTE_POLICIES so it
 * cannot be matched by accident.
 */
export const FALLBACK_POLICY: RoutePolicy = defineRoutePolicy({
  id: 'fallback',
  match: { method: '*', path: '/' },
  access: 'authenticated',
  category: 'management',
  workspace: 'required',
})

/**
 * The table, derived from what the code does today. Order does not matter:
 * the longest matching path wins, and a row naming a method beats one that
 * does not.
 */
export const ROUTE_POLICIES: RoutePolicy[] = [
  // ── Mounted before authMiddleware ─────────────────────────────────────────
  defineRoutePolicy({
    id: 'health', match: { method: 'GET', path: '/api/health' },
    access: 'public', category: 'management', workspace: 'none',
    cors: 'public', cache: 'no-store', logging: 'errors-only',
    reason: 'Liveness probe. Static, carries no workspace data, and must answer before anything is configured.',
  }),
  defineRoutePolicy({
    id: 'llms', match: { method: 'GET', path: '/llms' },
    access: 'public', category: 'management', workspace: 'none',
    cors: 'public',
    reason: 'Generated docs bundle (/llms.txt, /llms-full.txt). Public documentation by design.',
  }),
  defineRoutePolicy({
    id: 'auth-login', match: { method: 'POST', path: '/api/auth/login' },
    access: 'self-authenticating', category: 'auth', workspace: 'optional', credential: { body: true },
    reason: 'The body IS the credential: the route checks email and password itself. Requiring a token to get a token is a contradiction.',
  }),
  defineRoutePolicy({
    id: 'auth-refresh', match: { method: 'POST', path: '/api/auth/refresh' },
    access: 'self-authenticating', category: 'auth', workspace: 'optional', credential: { cookie: true },
    reason: 'The SameSite=Lax refresh cookie IS the credential and the route verifies it; no Bearer token exists yet.',
  }),
  defineRoutePolicy({
    id: 'workspace-setup', match: { method: '*', path: '/api/v1/setup' },
    access: 'public', category: 'management', workspace: 'optional',
    reason: 'First-run bootstrap before any member exists. Carries its own attempt limit.',
  }),
  defineRoutePolicy({
    id: 'media-static', match: { method: 'GET', path: '/media/' },
    access: 'public', category: 'media', workspace: 'none',
    cors: 'public', cache: 'immutable',
    reason: 'Asset bytes referenced from published pages. A browser fetching an image sends no key.',
  }),
  defineRoutePolicy({
    id: 'media-transform', match: { method: 'GET', path: '/api/v1/media/transform' },
    access: 'public', category: 'media', workspace: 'optional',
    cors: 'public', cache: 'immutable',
    reason: 'Derived asset bytes for the same published pages as media-static.',
  }),
  defineRoutePolicy({
    id: 'media-serve', match: { method: 'GET', path: '/api/v1/media/file' },
    access: 'public', category: 'media', workspace: 'optional',
    cors: 'public', cache: 'immutable',
    reason: 'Asset bytes by id, referenced from published pages.',
  }),
  defineRoutePolicy({
    id: 'preview-object', match: { method: 'GET', path: '/api/v1/preview/object/' },
    access: 'optional-auth', category: 'content', workspace: 'optional',
    cache: 'no-store',
    reason: 'The X-Tangen-Preview-Token header is the credential; the route validates it itself.',
  }),
  defineRoutePolicy({
    id: 'connections-oauth-callback', match: { method: 'GET', path: '/api/v1/connections/oauth/callback', exact: true },
    access: 'self-authenticating', category: 'management', workspace: 'optional', credential: { query: ['state'] },
    reason: 'The OAuth state (workspace.connection.nonce) is the credential: the nonce is compared timing-safe against the one sealed on the pending row core started, spent on use and refused after ten minutes; the provider redirect carries no member session (Extension Kernel K6.2).',
  }),

  // ── The five path exemptions inside middleware/auth.ts ─────────────────────
  // Site users is an extension (tasks/plan-core-slimming.md S4) and its sign-in
  // routes live on the generic extension mount. Naming the extension path here
  // is the second deliberate exception (after form-embed-submit): the `auth`
  // budget against credential stuffing must keep covering the login, code and
  // reset routes until a route may declare its own category.
  defineRoutePolicy({
    id: 'site-auth', match: { method: '*', path: '/api/v1/ext/auth/' },
    access: 'self-authenticating', category: 'auth', workspace: 'required', credential: { body: true },
    reason: 'The site key (X-Tangen-Key or Bearer tgn_) is the credential and the extension mount verifies it, including the sessions grant; the SSO callback is the one public row and carries its own single-use state.',
  }),
  defineRoutePolicy({
    id: 'graphiql', match: { method: 'GET', path: '/api/v1/graphql', exact: true },
    access: 'public', category: 'graphql', workspace: 'optional',
    reason: 'Static explorer shell only. It carries no data; the queries it POSTs are fully authenticated.',
  }),
  defineRoutePolicy({
    id: 'porter-receive', match: { method: '*', path: '/api/v1/porter/receive/' },
    access: 'self-authenticating', category: 'management', workspace: 'optional',
    bodyLimit: 'maxUploadBytes',
    reason: 'The gatekeeper code (redeem) or the X-Tangen-Transfer token (ingest) is the credential and each route verifies its own; a remote sender has neither a member nor an API key here.',
  }),
  // E.16: retired external URL forms answer 410 on purpose (gateway/retired-routes.ts, table in @tangen/types).
  ...RETIRED_ROUTES.map((r, i) => defineRoutePolicy({
    id: i === 0 ? 'retired-route' : `retired-route-${r.code.toLowerCase()}`, match: { method: r.method === '*' ? '*' : r.method, path: r.prefix },
    access: 'public', category: 'management', workspace: 'optional', cache: 'no-store',
    reason: `A retired URL form (${r.code}, ${r.since}): a sender carries no credential and gets 410 with the replacement, never a 404.`,
  })),
  defineRoutePolicy({
    // Forms is an extension (plan-core-slimming S3) but the forms category
    // budget - sized for a stranger posting a form, 10/min per IP - is a
    // Gateway concern, so the one public submit keeps its own row ahead of
    // the generic extension mount. Naming an extension path here is the
    // deliberate exception until a route may declare its own category.
    id: 'form-embed-submit', match: { method: 'POST', path: '/api/v1/ext/forms/embed/:formId/submit' },
    access: 'public', category: 'forms', workspace: 'optional',
    cors: 'public',
    reason: 'The public embed submit: a form on somebody else\'s site posts back with no key; the extension\'s own requireApiKey moves such a form to its keyed twin.',
  }),
  defineRoutePolicy({
    id: 'ext-public', match: { method: '*', path: '/api/v1/ext/' },
    access: 'self-authenticating', category: 'extension', workspace: 'required', credential: { path: true },
    reason: 'Only routes that opted into auth:\'key\' or auth:\'public\' mount here, and dispatch() checks each one itself - the API key for a key route, an explicit workspace and env for a public one. It was optional-auth, which claimed the Gateway resolves a credential when present; it never did. A public route may also validate a credential it minted into its own path (Flows\' webhook token, E.10), which the observer cannot see on the wire.',
  }),
  defineRoutePolicy({
    id: 'delivery', match: { method: 'GET', path: '/api/v1/delivery/' },
    access: 'public', category: 'delivery', workspace: 'required',
    cors: 'public', cache: 'immutable',
    reason: 'Published artifact bytes. A browser fetching a stylesheet sends no key, and requiring one would recreate the Studio dependency this route exists to remove. workspace and env here are ROUTING identifiers, not credentials.',
  }),

  // ── Realtime (R1 of tasks/plan-realtime.md; the category arrived with M6) ─
  defineRoutePolicy({
    id: 'realtime-ticket', match: { method: 'POST', path: '/api/v1/realtime/ticket', exact: true },
    access: 'authenticated', category: 'realtime', workspace: 'required',
    cache: 'no-store',
    reason: 'Mints the single-use ticket the two rows below redeem. It is the ONE realtime route that can carry a Bearer header, which is why the identity is resolved here and travels on the ticket.',
  }),
  defineRoutePolicy({
    id: 'realtime-presence', match: { method: 'POST', path: '/api/v1/realtime/presence', exact: true },
    access: 'authenticated', category: 'realtime', workspace: 'required',
    cache: 'no-store',
    reason: 'An EventSource cannot send, so a client on the SSE fallback publishes presence here instead. It is addressed by connection id and runs under THAT connection\'s ticket-derived identity; the Bearer derive only proves the caller is the same identity, because a connection id is a session id other members can read, never a credential.',
  }),
  defineRoutePolicy({
    id: 'realtime-ws', match: { method: 'GET', path: '/api/v1/realtime', exact: true },
    access: 'self-authenticating', category: 'realtime', workspace: 'optional',
    cache: 'no-store', credential: { query: ['ticket'] },
    reason: 'The single-use ticket in ?ticket= is the credential: minted under the Bearer derive by realtime-ticket, redeemed by the route before the WebSocket upgrade, carrying the workspace, env and identity of the request that minted it. A browser cannot put a Bearer header on an upgrade.',
  }),
  defineRoutePolicy({
    id: 'realtime-stream', match: { method: 'GET', path: '/api/v1/realtime/stream', exact: true },
    access: 'self-authenticating', category: 'realtime', workspace: 'optional',
    cache: 'no-store', credential: { query: ['ticket'] },
    reason: 'The same single-use ticket, for the EventSource fallback, which can send no header at all.',
  }),

  // ── Authenticated surfaces ────────────────────────────────────────────────
  defineRoutePolicy({
    id: 'graphql', match: { method: 'POST', path: '/api/v1/graphql', exact: true },
    access: 'authenticated', category: 'graphql', workspace: 'required',
    reason: 'The GraphQL endpoint itself. Every query and mutation runs under a member session or an API key, and depth is capped before validation.',
  }),
  defineRoutePolicy({
    // No trailing slash: POST /api/v1/objects (create) is a real path, and a
    // `/api/v1/objects/` prefix missed it, filing the single most common write
    // in the product as management traffic under the fallback.
    id: 'objects', match: { method: '*', path: '/api/v1/objects' },
    access: 'authenticated', category: 'content', workspace: 'required',
    reason: 'The REST content surface: read, write, publish and version every object type. The product\'s primary API.',
  }),
  defineRoutePolicy({
    // No trailing slash for the same reason: GET /api/v1/media is the asset
    // list. The public byte-serving rows above are longer and still win.
    id: 'media-upload', match: { method: '*', path: '/api/v1/media' },
    access: 'authenticated', category: 'media', workspace: 'required',
    bodyLimit: 'maxUploadBytes',
    reason: 'The media library: upload, list, update and delete assets. Bodies are files, so this surface is measured against the upload ceiling.',
  }),
  defineRoutePolicy({
    // Porter's member-facing side: bundle import carries a whole export
    // archive, so its body is an upload rather than a JSON document.
    id: 'porter-admin', match: { method: '*', path: '/api/v1/sync/' },
    access: 'authenticated', category: 'management', workspace: 'required',
    bodyLimit: 'maxUploadBytes',
    reason: 'Porter run control from the admin: select, bundle, promote, inspect runs. It moves content between environments, so it is the operator\'s surface rather than a content read.',
  }),
  defineRoutePolicy({
    id: 'ai', match: { method: '*', path: '/api/v1/ai/' },
    access: 'authenticated', category: 'ai', workspace: 'required',
    reason: 'Reserved mount for non-admin AI surfaces. Nothing ships here today - the shipped model-calling routes are under /api/v1/admin/ai - and the row is kept so anything mounted at it is budgeted as AI rather than as management.',
  }),
  defineRoutePolicy({
    id: 'ext-admin', match: { method: '*', path: '/api/v1/admin/ext/' },
    access: 'admin-internal', category: 'extension', workspace: 'required',
    reason: 'An extension\'s own routes, reached from the admin panel by a member. dispatch() applies the extension\'s role gate on top.',
  }),
  defineRoutePolicy({
    id: 'admin', match: { method: '*', path: '/api/v1/admin/' },
    access: 'admin-internal', category: 'management', workspace: 'required',
    reason: 'Everything the admin panel drives: schema, settings, jobs, search config, the Performance Monitor, workspace and member administration. Member sessions only, each route adding its own role gate.',
  }),

  // ── Declared by the coverage sweep (gateway-route-coverage.test.ts) ───────
  // Every row below describes a surface that was MOUNTED but UNDECLARED: it
  // resolved to FALLBACK_POLICY, which happened to get the access mode right
  // (all of these authenticate) and the surface category wrong, so each was
  // counted in the management rate-limit bucket, given management's CORS
  // treatment, and reported on the management line of the monitor's gateway
  // panel. Where the fallback's category was also the honest one, the row says
  // so on purpose rather than being moved for the sake of moving it.

  // AI surfaces.
  defineRoutePolicy({
    id: 'mcp', match: { method: 'POST', path: '/api/v1/mcp', exact: true },
    access: 'authenticated', category: 'ai', workspace: 'required',
    cache: 'no-store',
    // The ai category counts by `member`, and this route refuses anything but
    // an API key, so the umbrella counter never applies to it: without a row
    // policy MCP had no budget at all. An agent session is many small tool
    // calls - list the types, read one object, search, read another - so the
    // budget is per identity and generous, sized to be crossed by a runaway
    // loop rather than by an agent doing its job.
    rateLimit: { window: 60, limit: 300, by: ['identity'] },
    reason: 'The Model Context Protocol surface: an AI agent\'s tool calls over JSON-RPC. API key only - the handler refuses a member session with 403 - and every tool runs under that key\'s real permissions.',
  }),
  defineRoutePolicy({
    id: 'knowledge', match: { method: '*', path: '/api/v1/knowledge' },
    access: 'authenticated', category: 'ai', workspace: 'required',
    reason: 'Retrieval over the workspace knowledge index (search) and the grounded answer built on it (ask). Both spend embedding and model budget, so they belong to the AI surface and not to management.',
  }),

  // Content surfaces.
  defineRoutePolicy({
    id: 'globals', match: { method: '*', path: '/api/v1/globals' },
    access: 'authenticated', category: 'content', workspace: 'required',
    reason: 'Singleton content documents. Read and written like objects, so they are budgeted and exposed like objects.',
  }),
  defineRoutePolicy({
    id: 'search', match: { method: '*', path: '/api/v1/search' },
    access: 'authenticated', category: 'content', workspace: 'required',
    reason: 'Site-facing content search. A read over the same objects the content surface serves.',
  }),
  defineRoutePolicy({
    id: 'tables', match: { method: '*', path: '/api/v1/tables' },
    access: 'authenticated', category: 'content', workspace: 'required',
    reason: 'Queries against a developer\'s custom tables - content the site owns, reached through the same credential as any other read.',
  }),
  defineRoutePolicy({
    id: 'entity-labels', match: { method: '*', path: '/api/v1/entity-labels' },
    access: 'authenticated', category: 'content', workspace: 'required',
    reason: 'Labels attached to content objects. A content facet, not a settings screen.',
  }),
  defineRoutePolicy({
    id: 'labels', match: { method: '*', path: '/api/v1/labels' },
    access: 'authenticated', category: 'content', workspace: 'required',
    reason: 'Label suggestions while editing an object. Same surface as entity-labels, different mount.',
  }),
  defineRoutePolicy({
    id: 'i18n-locales', match: { method: 'GET', path: '/api/v1/i18n/locales', exact: true },
    access: 'authenticated', category: 'content', workspace: 'required',
    reason: 'Which languages this workspace serves, for any authenticated caller building a language switcher or per-locale static pages. Engine availability stays on the admin variant.',
  }),
  defineRoutePolicy({
    id: 'preview', match: { method: '*', path: '/api/v1/preview' },
    access: 'authenticated', category: 'content', workspace: 'required',
    cache: 'no-store',
    reason: 'Live preview control: mint a preview token, validate one, and the SSE stream that pushes draft changes. The token-bearing READ of a draft is the longer preview-object row above; none of these three serve content themselves.',
  }),


  // Extension surfaces reached by a member rather than through the dispatcher.
  defineRoutePolicy({
    id: 'extensions', match: { method: '*', path: '/api/v1/extensions' },
    access: 'authenticated', category: 'extension', workspace: 'required',
    reason: 'What is installed and what each extension declares, including the data one widget needs to render. It describes extensions, so a workspace that closes the extension surface closes it too.',
  }),
  defineRoutePolicy({
    id: 'extension-data', match: { method: '*', path: '/api/v1/workspaces/:workspaceId/extensions/*' },
    access: 'authenticated', category: 'extension', workspace: 'required',
    reason: 'An extension\'s per-object data, addressed through the workspace that owns it. Extension surface despite the workspace-shaped path.',
  }),

  // Management surfaces: the fallback's category was right for these, and
  // saying so out loud is the point - each now carries a reason and an id the
  // log and the monitor can name.
  defineRoutePolicy({
    id: 'workspaces', match: { method: '*', path: '/api/v1/workspaces' },
    access: 'authenticated', category: 'management', workspace: 'required',
    reason: 'Which workspaces this member belongs to, their environments, and switching between them.',
  }),
  defineRoutePolicy({
    id: 'releases', match: { method: '*', path: '/api/v1/releases' },
    access: 'authenticated', category: 'management', workspace: 'required',
    reason: 'Release orchestration: assemble a set of content changes, diff it, review it, apply it to another environment. It moves content but is not a content read, and closing the content surface must not close it.',
  }),
  defineRoutePolicy({
    id: 'members', match: { method: '*', path: '/api/v1/members' },
    access: 'authenticated', category: 'management', workspace: 'required',
    reason: 'Workspace membership: the directory, invitations, status, and per-environment roles. Each route applies its own role gate.',
  }),
  defineRoutePolicy({
    id: 'roles', match: { method: '*', path: '/api/v1/roles' },
    access: 'authenticated', category: 'management', workspace: 'required',
    reason: 'Custom role definitions and their permission sets.',
  }),
  defineRoutePolicy({
    id: 'me', match: { method: '*', path: '/api/v1/me/' },
    access: 'authenticated', category: 'management', workspace: 'required',
    cache: 'no-store',
    reason: 'The calling member\'s own permissions, profile and password. Scoped to the caller, so no role gate applies beyond being authenticated.',
  }),
  defineRoutePolicy({
    id: 'api-keys', match: { method: '*', path: '/api/v1/api-keys' },
    access: 'authenticated', category: 'management', workspace: 'required',
    cache: 'no-store',
    reason: 'Issuing, listing and revoking API keys. Key material is returned once, at creation, and never again.',
  }),
  defineRoutePolicy({
    id: 'webhooks', match: { method: '*', path: '/api/v1/webhooks' },
    access: 'authenticated', category: 'management', workspace: 'required',
    reason: 'Outbound webhook subscriptions, their delivery history and replay. Inbound webhooks are the separate self-authenticating flow-webhook row.',
  }),
  defineRoutePolicy({
    id: 'saved-views', match: { method: '*', path: '/api/v1/saved-views' },
    access: 'authenticated', category: 'management', workspace: 'required',
    reason: 'A member\'s saved list filters in the admin. Preferences, not content.',
  }),
  defineRoutePolicy({
    id: 'types', match: { method: '*', path: '/api/v1/types' },
    access: 'authenticated', category: 'management', workspace: 'required',
    reason: 'Schema introspection: what types exist, their fields, and whether the database agrees with the generated schema. It describes content without serving any.',
  }),
  defineRoutePolicy({
    id: 'route-resources', match: { method: 'GET', path: '/api/v1/route-resources', exact: true },
    access: 'authenticated', category: 'management', workspace: 'required',
    reason: 'The custom routes a developer declared, for the admin\'s API catalogue and the playground.',
  }),
  defineRoutePolicy({
    id: 'toolbar', match: { method: '*', path: '/api/v1/toolbar/' },
    access: 'authenticated', category: 'management', workspace: 'required',
    cache: 'no-store',
    // management counts by member+workspace and this route refuses a member
    // session outright, so the umbrella counter never applied: the drill-down
    // had no budget. One call per rendered request is the normal rate; 120/min
    // per identity leaves a developer clicking through a slow page alone.
    rateLimit: { window: 60, limit: 120, by: ['identity'] },
    reason: 'The Tangen Toolbar\'s Performance Monitor drill-down: a toolbar-enabled API key reading ITS OWN captured requests, with SQL reduced to redacted shapes. A developer tool on the platform\'s own control surface, and a member session is refused here - admins use the admin route.',
  }),
]

/**
 * Does the Gateway leave credential resolution to the route itself?
 *
 * This is what middleware/auth.ts asks at M3, in place of the five URL
 * prefixes it used to compare. `public` needs no credential and
 * `self-authenticating` needs one the platform cannot verify; every other mode
 * goes through the Bearer derive exactly as before. `optional-auth` does NOT
 * step aside - today the derive still runs for it, and M3 changes where the
 * decision is read, not what it is.
 * @param access - The resolved access mode.
 * @returns Whether auth should return without deriving a credential.
 */
export function skipsCredentialDerive(access: AccessMode): boolean {
  return access === 'public' || access === 'self-authenticating'
}

/** Every row whose access mode is `public`, for the assertion that pins the set. */
export function publicRoutePolicies(): RoutePolicy[] {
  return ROUTE_POLICIES.filter((p) => p.access === 'public')
}

/**
 * Every row the Gateway lets through for the route to check itself. Pinned by
 * test for the same reason the public set is: this is the other list a reviewer
 * has to be able to read in one place.
 */
export function selfAuthenticatingRoutePolicies(): RoutePolicy[] {
  return ROUTE_POLICIES.filter((p) => p.access === 'self-authenticating')
}

/**
 * Is this row's path a PATTERN rather than a prefix?
 *
 * A prefix cannot separate two routes that differ only in a middle segment:
 * `/api/v1/forms/:formId/schema` mounts in front of auth while
 * `/api/v1/forms/:formId` mounts behind it, and `/api/v1/forms/` describes
 * both. A row may therefore name Elysia's own path syntax instead, which the
 * dynamic table has always used, and it is matched END TO END.
 *
 * Detection is by shape, not by a flag, so a row cannot declare a pattern and
 * be read as a prefix. No prefix row contains ':' or '*', so this is additive.
 * @param path - The row's declared path.
 * @returns Whether it should be matched as a whole-path pattern.
 */
function isPattern(path: string): boolean {
  return path.includes(':') || path.includes('*')
}

function matches(policy: RoutePolicy, method: string, path: string): boolean {
  const m = policy.match.method
  if (m !== '*' && m.toUpperCase() !== method.toUpperCase()) return false
  if (isPattern(policy.match.path)) return matchesPattern(policy.match.path, path)
  return policy.match.exact ? path === policy.match.path : path.startsWith(policy.match.path)
}

/**
 * The policy governing one request.
 *
 * Dynamically registered rows are consulted FIRST: a custom route registered at
 * mount time names a concrete path, which describes the request better than any
 * prefix covering the whole mount could (dynamic-policies.ts).
 * @param method - HTTP method.
 * @param path - URL pathname, without query.
 * @returns The best-matching row, or FALLBACK_POLICY when nothing matches.
 */
export function resolveRoutePolicy(method: string, path: string): RoutePolicy {
  const dynamic = resolveDynamicRoutePolicy(method, path)
  if (dynamic) return dynamic
  let best: RoutePolicy | undefined
  let bestScore = -1
  for (const policy of ROUTE_POLICIES) {
    if (!matches(policy, method, path)) continue
    // Longest prefix wins; an exact match and a named method each break a tie
    // in favour of the more specific row.
    const score = policy.match.path.length * 10
      + (policy.match.exact ? 2 : 0)
      + (policy.match.method === '*' ? 0 : 1)
    if (score > bestScore) { best = policy; bestScore = score }
  }
  return best ?? FALLBACK_POLICY
}
