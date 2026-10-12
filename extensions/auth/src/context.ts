/**
 * File Name: context.ts
 * Purpose: What every handler needs from the extension context: the
 *          database handle, the resolved options, the roles and profile
 *          fields, the hook context.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import { DEFAULT_SITE_ROLES, type AuthHookContext, type AuthOptions, type ProfileFieldDef, type SiteAuthHooks } from './contract'

export const EXT_ID = 'auth'

/** The rows of a raw `db.execute`: postgres-js answers an array, PGlite answers `{ rows }`. */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  const r = (result as { rows?: T[] } | null | undefined)?.rows
  return Array.isArray(r) ? r : []
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dbOf(ctx: ExtensionServerCtx): any {
  if (!ctx.db) throw new Error('Site users: the runtime did not hand the extension a database handle')
  return ctx.db
}

export function optionsOf(ctx: ExtensionServerCtx): AuthOptions {
  return (ctx.options ?? {}) as AuthOptions
}

export function rolesOf(ctx: ExtensionServerCtx): readonly string[] {
  const roles = optionsOf(ctx).roles
  return roles && roles.length ? roles : DEFAULT_SITE_ROLES
}

export function profileFieldsOf(ctx: ExtensionServerCtx): ProfileFieldDef[] {
  return optionsOf(ctx).profileFields ?? []
}

export function hooksOf(ctx: ExtensionServerCtx): SiteAuthHooks {
  return optionsOf(ctx).hooks ?? {}
}

export function hookCtx(ctx: ExtensionServerCtx): AuthHookContext {
  return { workspaceId: ctx.workspaceId, log: (m) => ctx.log?.(m) }
}

/** Runs an after-hook without letting its failure fail the request. */
export function fireAndForget(ctx: ExtensionServerCtx, name: string, run: () => unknown): void {
  try {
    const r = run()
    if (r instanceof Promise) r.catch((err: unknown) => ctx.log?.(`${name} hook failed: ${err instanceof Error ? err.message : String(err)}`))
  } catch (err) {
    ctx.log?.(`${name} hook failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
