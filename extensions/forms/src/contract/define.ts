/**
 * File Name: form-def.ts
 * Purpose: Code-first form authoring — defineForm() declares a form in
 *   app/forms/*.ts (pushed to the forms table by `tangen push`, read-only in
 *   the admin builder), and defineFormHooks() attaches lifecycle hooks to ANY
 *   form by slug — including forms built in the admin UI.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: functions (option loaders, hooks) never reach the DB —
 *   push strips them; the API loads this module at boot and overlays them at
 *   runtime (forms behavior registry), exactly like content field behavior.
 */
import type { FormField, FormSettings, FormStep, FormHooks } from './types'

/** Async option loader — runs server-side with a tangen local client. */
export type FormOptionsFn = (ctx: {
  tangen: unknown
  env: string
  workspaceId: string
}) => Promise<Array<{ label: string; value: string }>> | Array<{ label: string; value: string }>

/** A code-first field: everything a stored field has, plus an options function. */
export type CodeFormField = Omit<FormField, 'options'> & {
  options?: FormField['options'] | FormOptionsFn
}

export interface CodeFormDefinition {
  /** Form name shown in the admin. */
  name: string
  /** Stable identity — push upserts on (workspace, env, slug). */
  slug: string
  /** Accept public submissions (default: keep the current DB value; first push defaults to false). */
  isLive?: boolean
  fields: CodeFormField[]
  steps?: FormStep[]
  settings?: Partial<FormSettings>
  /** Per-locale label/text overrides, stored as settings.__i18n on push. */
  i18n?: Record<string, unknown>
  /** Lifecycle hooks for this form (runtime overlay — never pushed). */
  hooks?: FormHooks[string]
}

/**
 * Identity helper for a code-first form definition (app/forms/<slug>.ts).
 */
export function defineForm(def: CodeFormDefinition): CodeFormDefinition {
  return def
}

export interface FormHooksEntry {
  slug: string
  hooks: FormHooks[string]
}

/**
 * Attaches lifecycle hooks to a form by slug — works for admin-built forms
 * too. Register the result in the app/forms/index.ts barrel; push ignores it
 * (no DB row), the API overlays it at boot.
 */
export function defineFormHooks(slug: string, hooks: FormHooks[string]): FormHooksEntry {
  return { slug, hooks }
}
