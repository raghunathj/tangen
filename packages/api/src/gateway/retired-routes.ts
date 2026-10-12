/**
 * File Name: retired-routes.ts
 * Purpose: The tombstones for URL forms the platform retired (E.16): every
 *          request under a retired prefix is answered 410 Gone with the
 *          code, the retirement and the replacement from RETIRED_ROUTES
 *          (@tangen/types), plus a Deprecation header. An external sender
 *          then fails on purpose, with the fix in the body, instead of
 *          hitting a 404 that reads like a typo. Mounted before the
 *          extension public routes so a retired prefix is never shadowed.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { Elysia } from 'elysia'
import { RETIRED_ROUTES } from '@tangen/types'

export const retiredRoutes = (app: Elysia) => {
  for (const r of RETIRED_ROUTES) {
    app.all(`${r.prefix}*`, (ctx: any) => {
      const set = ctx.set as { status?: number | string; headers: Record<string, string> }
      set.status = 410
      set.headers['Deprecation'] = 'true'
      set.headers['Cache-Control'] = 'no-store'
      return { error: { code: r.code, message: r.message, since: r.since, replacement: r.replacement } }
    })
  }
  return app
}
