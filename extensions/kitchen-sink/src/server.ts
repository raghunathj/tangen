import { defineExtensionServer } from '@tangen/cms'
import { kitchenSinkHooks } from './hooks'
import { validateCreditCard } from './shared/fields/credit-card/validator'
import { readCounter, tickCounter } from './realtime-counter'
import type { ExtensionStore } from '@tangen/cms'

/**
 * Server contributions — referenced from tangen.extension.ts as
 * server: './src/server.ts'. This entry may import server-only code; it is
 * never bundled into the admin.
 *
 * Lifecycle contract: hooks receive only { workspaceId} — there is no
 * database handle here by design. Durable state belongs in extension data
 * (written from content hooks, see ./hooks.ts) or external systems. A
 * throwing onInstall rolls the installation back (no half-installs); a
 * throwing onUninstall aborts the removal.
 */
export default defineExtensionServer({
  contentHooks: kitchenSinkHooks,

  // ── Custom field type validation ──────────────────────────────────────
  // Authoritative server validator for the manifest's `credit_card` field
  // type. Runs after the inherited `text` primitive's baseline rules, on
  // every save/publish path. Shares the SAME pure validator the admin input
  // uses (./credit-card) so client feedback and server enforcement match.
  fieldTypes: {
    credit_card: { validate: (value) => validateCreditCard(value) },
  },

  // ── MCP tools ─────────────────────────────────────────────────────────
  // Exposed as ext_kitchen_sink_<name> — only while this extension is
  // installed AND the workspace enabled MCP (app/config/mcp.ts, OFF by
  // default). Handlers run server-side with { workspaceId}.
  mcpTools: [
    {
      name: 'ping',
      description: 'Demo tool - echoes a message with the workspace the call landed in.',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
      },
      handler: (args, ctx) => ({
        pong: String(args.message ?? 'hello'),
        workspaceId: ctx.workspaceId,
        from: 'kitchen-sink',
      }),
    },
  ],

  // ── Flow contributions ────────────────────────────────────────────────
  // The Flows extension (extensions/flows) discovers these by convention:
  // a trigger your extension emits (ctx.emit → 'ext:kitchen-sink:demo-ping')
  // and an action marketing can drop onto the canvas. `capability` hides
  // a contribution from members without the grant.
  flowTriggers: [
    {
      type: 'ext:kitchen-sink:demo-ping',
      label: 'Kitchen-sink demo ping',
      description: 'Emitted by the sink for demo purposes - copy this pattern for your extension events.',
      payloadFields: [{ path: 'payload.message', label: 'Message' }],
    },
  ],
  flowActions: [
    {
      name: 'sink_echo',
      label: 'Sink echo (demo)',
      description: 'Returns its config - the smallest extension-contributed action.',
      capability: 'manage:settings',
      configFields: [{ key: 'text', label: 'Text to echo', kind: 'text' }],
      handler: async (config: Record<string, unknown>) => ({ echoed: String(config.text ?? ''), from: 'kitchen-sink' }),
    },
  ],

  // ── Server routes ─────────────────────────────────────────────────────
  // auth 'key' mounts at /api/v1/ext/kitchen-sink/ping - callable by a
  // workspace API key (the workspace resolves from the key binding), no
  // member session. The reference for serving extension data to frontends.
  adminRoutes: [
    // ── Realtime showcase (R4) ──────────────────────────────────────────
    // The manifest declares the `counter` channel; a tick bumps the stored
    // counter and publishes it through ctx.realtime.publish, and the
    // Realtime page refetches GET counter when the envelope arrives
    // (realtime signals, it does not replicate). See ./realtime-counter.ts.
    // Each member route names the capability it needs (the manifest's
    // `tools` resource compiles to read:tools / run:tools); a route without
    // one would be open to every member of the workspace.
    {
      method: 'POST',
      path: 'tick',
      capability: 'run:tools',
      handler: async (req, ctx) => ({ data: await tickCounter(ctx, req.memberId ?? null) }),
    },
    {
      method: 'GET',
      path: 'counter',
      capability: 'read:tools',
      handler: async (_req, ctx) => ({ data: await readCounter(ctx) }),
    },
    {
      method: 'GET',
      path: 'ping',
      auth: 'key',
      handler: async (req, ctx) => {
        // The SAME local client custom routes get - here used for a per-key
        // rate limit (60/min) plus a read of the extension's stored rows.
        const rl = await ctx.tangen!.rateLimit(`kitchen-sink:ping:${req.apiKeyId}`, 60, 60)
        const notes = (await ctx.store.count?.('')) ?? 0
        return {
          pong: true,
          from: 'kitchen-sink',
          storedEntries: notes,
          rateLimit: { allowed: rl.allowed, remaining: rl.remaining },
        }
      },
    },
  ],

  // ── Porter contribution (Phase 4, Unit 11) ────────────────────────────
  // The scratch notes and the counter live in the extension's own store;
  // this provider lets a promote / bundle carry them. Porter hands the
  // provider that store (`scope.store`, E.4) - the platform database handle
  // arrives only under `db:own` and is not needed here, so the provider
  // never touches a platform table. Offered only where the sink is active.
  // Keys are namespaced so no two extensions can collide.
  porterProviders: [
    {
      key: 'kitchen-sink.notes',
      label: 'Kitchen Sink notes and counter',
      async count(_db, _workspaceId, scope) {
        const store = ownStore(scope)
        return (await store.count?.('')) ?? (await store.list('')).length
      },
      async exportRows(_db, _workspaceId, scope) {
        const rows = await ownStore(scope).list('')
        return rows.map(({ key, data }) => ({ key, data })).sort((a, b) => a.key.localeCompare(b.key))
      },
      async importRows(_db, _workspaceId, rows, ctx) {
        const store = ownStore(ctx)
        let created = 0, updated = 0
        for (const row of rows) {
          // `object_id` is the key a bundle written before E.4 carries.
          const r = row as { key?: string; object_id?: string; data?: unknown }
          const key = String(r.key ?? r.object_id ?? '')
          if (!key) continue
          const existed = (await store.get(key)) !== undefined
          await store.put(key, (r.data ?? {}) as Record<string, unknown>)
          if (existed) updated++; else created++
        }
        return { created, updated }
      },
    },
  ],

  // ── Lifecycle v1 (docs/architecture/extension-lifecycle.md) ──────────
  // INSTALL: non-schema setup after the migrations applied. Schema lives in
  // ./migrations.ts; the row and the ledger are the platform's.
  onInstall: async ({ workspaceId}) => {
    console.log(`[kitchen-sink] installed into ${workspaceId}`)
  },

  // START: once per workspace x environment where the sink is active. The
  // only background work this extension ever does starts here, and only
  // when the `tickEveryMs` option asks for it; the cleanup runs at STOP.
  onStart: (ctx) => {
    const every = Number((ctx.options as { tickEveryMs?: unknown } | undefined)?.tickEveryMs ?? 0)
    ctx.log(`started in ${ctx.workspaceId}${every > 0 ? ` (auto-tick every ${every} ms)` : ''}`)
    if (!(every > 0)) return
    const timer = setInterval(() => { tickCounter(ctx, null).catch(() => {}) }, every)
    return () => clearInterval(timer)
  },
  onStop: (ctx) => { ctx.log(`stopped in ${ctx.workspaceId}`) },

  // UPGRADE: non-schema work after the pending migrations applied.
  onUpgrade: async (ctx, { from, to }) => {
    ctx.log(`upgraded ${from ?? 'unknown'} -> ${to}`)
  },

  // UNINSTALL retains the extension's data (notes, counter, kitchen_sink_log);
  // pages, panels and the widget disappear with the installation. This
  // hook is advisory; `tangen purge extension kitchen-sink
  // --approve ...` is the explicit deletion.
  onUninstall: async ({ workspaceId}) => {
    console.log(`[kitchen-sink] uninstalled from ${workspaceId}`)
  },
})

/** The store Porter handed the provider; a call without it is refused by name rather than answered from a platform table. */
function ownStore(scope: { store?: ExtensionStore } | undefined): ExtensionStore {
  if (!scope?.store) throw new Error('kitchen-sink porter provider needs its own store (store:own): Porter hands it as scope.store')
  return scope.store
}
