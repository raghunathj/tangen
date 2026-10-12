/**
 * File Name: push.ts
 * Purpose: The extension's `tangen push` hook: code-first forms (app/forms)
 *          validated and upserted on (workspace, slug) once the content
 *          schema committed. Runs in the CLI process, against the project's
 *          database; never at API boot.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { and, eq, sql } from 'drizzle-orm'
import { forms } from './tables'
import { validateFormDefinition } from './contract'
import { loadLocalForms } from './push-loader'

export interface PushHookContext {
  db: { transaction: (fn: (tx: any) => Promise<void>) => Promise<unknown> }
  workspaceId: string
  /** The directory that holds tangen.config.ts (app/forms lives beside it). */
  configCwd: string
  options: Record<string, unknown>
  log: { ok: (m: string) => void; warn: (m: string) => void; info?: (m: string) => void }
}

export async function afterPush(ctx: PushHookContext): Promise<void> {
  const loaded = await loadLocalForms(`${ctx.configCwd}/tangen.config.ts`)
  if (!loaded || loaded.forms.length === 0) return
  let applied = 0
  await ctx.db.transaction(async (tx) => {
    for (const form of loaded.forms) {
      const check = validateFormDefinition(form)
      if (check.errors.length > 0) {
        ctx.log.warn(`Form "${form.slug}" skipped - invalid definition:\n    - ${check.errors.join('\n    - ')}`)
        continue
      }
      // Admin-authored locales the code definition does not provide are kept.
      const [existing] = await tx.select().from(forms)
        .where(and(eq(forms.workspaceId, ctx.workspaceId), eq(forms.slug, form.slug)))
        .limit(1)
      const existingI18n = (existing?.settings as { __i18n?: Record<string, unknown> } | undefined)?.__i18n ?? {}
      const settings: Record<string, unknown> = {
        notifications: [],
        uniqueBy: null,
        ...(form.settings ?? {}),
        ...(form.steps ? { steps: form.steps } : {}),
        __i18n: { ...existingI18n, ...(form.i18n ?? {}) },
      }
      if (Object.keys(settings.__i18n as object).length === 0) delete settings.__i18n
      await tx.insert(forms).values({
        id: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
        name: form.name,
        slug: form.slug,
        source: 'code',
        ...(typeof form.isLive === 'boolean' ? { isLive: form.isLive } : {}),
        fields: form.fields,
        settings,
      }).onConflictDoUpdate({
        target: [forms.workspaceId, forms.slug],
        set: {
          name: form.name,
          source: 'code',
          fields: form.fields,
          settings,
          ...(typeof form.isLive === 'boolean' ? { isLive: form.isLive } : {}),
          updatedAt: sql`now()`,
        },
      })
      applied++
    }
  })
  if (applied > 0) ctx.log.ok(`forms → ${applied} code-first form${applied === 1 ? '' : 's'} upserted from app/forms`)
}

export default { afterPush }
