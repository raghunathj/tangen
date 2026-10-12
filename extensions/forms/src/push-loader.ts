/**
 * File Name: forms-loader.ts
 * Purpose: Loads code-first forms (app/forms/index.ts) for `tangen push` —
 *   subprocess isolation like the schema loader, functions stripped (option
 *   loaders and hooks stay code-side as the runtime behavior overlay), and
 *   idempotent upserts into the forms table keyed (workspace, env, slug).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: hook-only entries (defineFormHooks) create no DB row.
 *   Push preserves isLive and admin-authored settings.__i18n locales that the
 *   code definition doesn't provide.
 */
import { resolve, dirname } from 'node:path'
import { existsSync } from 'node:fs'

export interface LoadedCodeForm {
  name: string
  slug: string
  isLive?: boolean
  fields: Record<string, unknown>[]
  steps?: Record<string, unknown>[]
  settings?: Record<string, unknown>
  i18n?: Record<string, unknown>
  /** Field names whose options were functions (stripped — resolved at runtime). */
  functionOptionFields: string[]
}

/** Deep-strips functions from a JSON-bound structure (mirrors stripFieldBehavior). */
function stripFunctions(value: unknown): unknown {
  if (typeof value === 'function') return undefined
  if (Array.isArray(value)) return value.map(stripFunctions)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const stripped = stripFunctions(v)
      if (stripped !== undefined) out[k] = stripped
    }
    return out
  }
  return value
}

/** Separates defineForm entries from defineFormHooks entries in the barrel. */
export function splitFormEntries(entries: unknown[]): { forms: any[]; hookSlugs: string[] } {
  const forms: any[] = []
  const hookSlugs: string[] = []
  for (const e of entries ?? []) {
    if (!e || typeof e !== 'object') continue
    const entry = e as Record<string, unknown>
    if (Array.isArray(entry.fields)) forms.push(entry)
    else if (typeof entry.slug === 'string' && entry.hooks) hookSlugs.push(entry.slug)
  }
  return { forms, hookSlugs }
}

/** Normalizes one defineForm entry for the DB (functions stripped + noted). */
export function normalizeCodeForm(def: Record<string, unknown>): LoadedCodeForm {
  const functionOptionFields: string[] = []
  const fields = (def.fields as Record<string, unknown>[]).map((f) => {
    if (typeof f.options === 'function') functionOptionFields.push(String(f.name))
    return stripFunctions(f) as Record<string, unknown>
  })
  return {
    name: String(def.name),
    slug: String(def.slug),
    ...(typeof def.isLive === 'boolean' ? { isLive: def.isLive } : {}),
    fields,
    steps: def.steps as Record<string, unknown>[] | undefined,
    settings: stripFunctions(def.settings ?? {}) as Record<string, unknown>,
    i18n: def.i18n as Record<string, unknown> | undefined,
    functionOptionFields,
  }
}

/**
 * Loads app/forms/index.ts in a subprocess (marker-delimited JSON so stray
 * console output from the module can't corrupt the payload).
 */
export async function loadLocalForms(configPath: string): Promise<{ forms: LoadedCodeForm[]; hookSlugs: string[] } | null> {
  const projectRoot = dirname(resolve(configPath))
  const barrel = resolve(projectRoot, 'forms/index.ts')
  if (!existsSync(barrel)) return null

  const MARK = '__TANGEN_FORMS__'
  const script = `
const mod = await import('${barrel}')
const entries = mod.default ?? []
const payload = entries.map((e) => {
  if (!e || typeof e !== 'object') return e
  if (Array.isArray(e.fields)) {
    return { ...e, fields: e.fields.map((f) => ({ ...f, __fnOptions: typeof f.options === 'function' ? true : undefined })) }
  }
  return { slug: e.slug, hooks: e.hooks ? true : undefined }
})
process.stdout.write('${MARK}' + JSON.stringify(payload, (k, v) => typeof v === 'function' ? undefined : v) + '${MARK}')
`
  const proc = Bun.spawn(['bun', '-e', script], { cwd: projectRoot, stdout: 'pipe', stderr: 'pipe' })
  await proc.exited
  if (proc.exitCode !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`Failed to load app/forms/index.ts:\n${err}`)
  }
  const raw = await new Response(proc.stdout).text()
  const m = raw.split(MARK)
  if (m.length < 3) throw new Error('Forms barrel produced no payload')
  const entries = JSON.parse(m[1]) as Record<string, unknown>[]

  const { forms, hookSlugs } = splitFormEntries(entries)
  return {
    forms: forms.map((def) => {
      const fields = (def.fields as Record<string, unknown>[]).map((f) => {
        const { __fnOptions, ...rest } = f
        return { ...rest, ...(__fnOptions ? {} : {}) }
      })
      const fn = (def.fields as Record<string, unknown>[]).filter((f) => f.__fnOptions).map((f) => String(f.name))
      const norm = normalizeCodeForm({ ...def, fields })
      norm.functionOptionFields = fn
      return norm
    }),
    hookSlugs,
  }
}
