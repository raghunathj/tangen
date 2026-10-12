/**
 * File Name: site-field-types.ts
 * Purpose: Process-level registry of SITE-defined custom field types — the ones a
 *   developer declares in `app/fields/<name>/index.ts` via `defineFieldType(...)`,
 *   with no extension. Auto-discovered at boot by importing each folder's `index.ts`
 *   (server-safe — the React input lives in a sibling `input.tsx`, never imported
 *   here). Consulted by the field validator (via resolveCustomFieldType) and the
 *   field-types picker route.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SiteFieldTypeDef } from '@tangen/types'

const _siteFields = new Map<string, SiteFieldTypeDef>()

/**
 * Locate the site's `app/fields` dir across the layouts the API runs in (deployed
 * site at cwd, or the monorepo dev server at packages/api). Read-only presence
 * check — site fields must resolve in prod too, so this never requires writability.
 */
export function findAppFieldsDir(cwd: string = process.cwd()): string | null {
  const candidates = [
    join(cwd, 'app', 'fields'),                 // site / npm layout
    join(cwd, '..', '..', 'app', 'fields'),     // monorepo: packages/api → repo root
  ]
  return candidates.find((d) => existsSync(d)) ?? null
}

/** Registers one site field type (used by the loader and tests). */
export function registerSiteFieldType(def: SiteFieldTypeDef): void {
  if (def?.name) _siteFields.set(def.name, def)
}

/**
 * Discovers and registers every `app/fields/<name>/index.ts`. Each default-exports
 * a `defineFieldType(...)` definition. Idempotent — safe to call again on reload.
 */
export async function loadSiteFieldTypes(cwd: string = process.cwd()): Promise<void> {
  const dir = findAppFieldsDir(cwd)
  if (!dir) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const index = ['index.ts', 'index.tsx']
      .map((f) => join(dir, entry.name, f))
      .find(existsSync)
    if (!index) continue
    try {
      const def = (await import(index)).default as SiteFieldTypeDef | undefined
      if (def?.name) _siteFields.set(def.name, def)
    } catch (err) {
      console.warn(`[site-fields] '${entry.name}' failed to load: ${(err as Error).message}`)
    }
  }
}

/** A registered site field type by name (undefined for unknown/extension names). */
export function getSiteFieldType(name: string): SiteFieldTypeDef | undefined {
  return _siteFields.get(name)
}

/** All registered site field types (for the picker). */
export function listSiteFieldTypes(): SiteFieldTypeDef[] {
  return [..._siteFields.values()]
}

/** Test helper — clears the registry. */
export function resetSiteFieldTypes(): void {
  _siteFields.clear()
}
