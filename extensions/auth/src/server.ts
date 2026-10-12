/**
 * File Name: server.ts
 * Purpose: The Site users extension server: the site routes behind the site
 *          key, the member routes behind the admin, the workspace's site
 *          identity provider on the kernel seam, a search provider for the
 *          admin's search, the flow triggers a site can automate on, and
 *          the hourly sweep of expired challenges.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { and, eq, ilike, or } from 'drizzle-orm'
import { defineExtensionServer } from '@tangen/cms'
import { authUsers } from './tables'
import { dbOf } from './context'
import { siteIdentityOf } from './identity'
import { sweepExpiredChallenges } from './challenges'
import { siteRoutes } from './routes/site'
import { adminRoutes } from './routes/admin'
import { adminUser, loadUserById } from './users'

const SWEEP_TICK_MS = 60 * 60 * 1000

export default defineExtensionServer({
  adminRoutes: [...siteRoutes, ...adminRoutes],

  // Who the end user behind a site request is (tasks/plan-core-slimming.md S1).
  siteIdentity: (ctx) => siteIdentityOf(ctx),

  searchProviders: [
    {
      id: 'users',
      label: 'Site users',
      audiences: ['internal'],
      search: async (q, ctx) => {
        const rows = await dbOf(ctx).select().from(authUsers)
          .where(and(eq(authUsers.workspaceId, ctx.workspaceId), eq(authUsers.isAnonymous, false), or(ilike(authUsers.name, `%${q}%`), ilike(authUsers.email, `%${q}%`), ilike(authUsers.phone, `%${q}%`))))
          .limit(10)
        return rows.map((r: typeof authUsers.$inferSelect) => ({ id: r.id, title: r.name || r.email || r.phone || 'Site user', to: `/extensions/auth/${r.id}`, status: r.status === 'blocked' ? 'blocked' : undefined, icon: 'IconUsers' }))
      },
    },
  ],

  flowTriggers: [
    {
      type: 'ext:auth:user.registered',
      label: 'Site user registered',
      description: 'A new account was created (password, one-time code or SSO)',
      payloadFields: [
        { path: 'userId', label: 'User id', sample: 'au_123' },
        { path: 'email', label: 'Email', sample: 'grace@example.com' },
        { path: 'provider', label: 'How they signed up', sample: 'password' },
        { path: 'user.name', label: 'Name', sample: 'Grace Hopper' },
      ],
      hydrate: async (event, ctx) => {
        const p = (event.payload ?? {}) as { userId?: string }
        const row = p.userId ? await loadUserById(ctx, p.userId) : undefined
        return row ? { user: adminUser(row) } : {}
      },
    },
    {
      type: 'ext:auth:user.signed_in',
      label: 'Site user signed in',
      description: 'An account signed in',
      payloadFields: [
        { path: 'userId', label: 'User id', sample: 'au_123' },
        { path: 'provider', label: 'How they signed in', sample: 'otp' },
        { path: 'user.name', label: 'Name', sample: 'Grace Hopper' },
      ],
      hydrate: async (event, ctx) => {
        const p = (event.payload ?? {}) as { userId?: string }
        const row = p.userId ? await loadUserById(ctx, p.userId) : undefined
        return row ? { user: adminUser(row) } : {}
      },
    },
  ],

  onStart: async (ctx) => {
    const tick = () => sweepExpiredChallenges(ctx).catch((err) => ctx.log?.(`challenge sweep failed: ${err instanceof Error ? err.message : String(err)}`))
    void tick()
    const handle = setInterval(tick, SWEEP_TICK_MS)
    return () => clearInterval(handle)
  },
})
