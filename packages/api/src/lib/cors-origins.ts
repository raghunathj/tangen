/**
 * File Name: cors-origins.ts
 * Purpose: Builds the CORS origin allowlist from the server.cors.origins values
 *          declared in each workspace project's environment configs.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure function over WorkspaceProject[]. An empty result
 *                     means no origins are declared — the caller decides the
 *                     fallback (permissive in development).
 */
import { deploymentFor } from '../config/service-settings'
import type { WorkspaceProject } from '@tangen/types'

/**
 * Collects and dedupes CORS origins across every environment of every project.
 * Empty strings (from unset env vars like FRONTEND_URL) are dropped.
 * @param projects - Loaded workspace projects with config populated.
 * @returns Unique, non-empty origin strings; empty when nothing is declared.
 */
export function collectCorsOrigins(projects: WorkspaceProject[]): string[] {
  const origins = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value !== 'string' || value.trim() === '') return
    origins.add(value.trim())
  }
  for (const project of projects) {
    for (const origin of projectOrigins(project)) add(origin)
  }
  return [...origins]
}

/** Extract the scheme+host+port origin from a full URL (or template); null when unparseable. */
export function originOf(url: unknown): string | null {
  if (typeof url !== 'string' || url.trim() === '') return null
  try {
    // Strip template placeholders like {id}/{type} that would break URL parsing.
    return new URL(url.replace(/\{[^}]+\}/g, 'x')).origin
  } catch {
    return null
  }
}

/**
 * The origin sources of ONE environment config: `server.cors.origins`,
 * `admin.url`, `frontend.url`, `frontend.previewUrl` and every
 * `frontend.previewUrls` entry. What `collectCorsOrigins` unions across the whole process, read for
 * one place.
 */
/**
 * The origins one environment of a project allows: the declared CORS lists
 * (raw config), and the URLs from the RESOLVED deployment - admin.url,
 * frontend.url, frontend.previewUrl(s) - which the environment file, the
 * deployment's variables or the development default supplied.
 */
export function projectOrigins(project: WorkspaceProject | undefined): string[] {
  const e = project?.config as { server?: { cors?: { origins?: unknown[] } }; gateway?: { cors?: { origins?: unknown[] } } } | undefined
  const r = deploymentFor(project)
  const out = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value !== 'string' || value.trim() === '') return
    out.add(value.trim())
  }
  for (const origin of e?.server?.cors?.origins ?? []) add(origin)
  // The Admin talks to the API from its own origin once it is served anywhere but the dev proxy.
  add(originOf(r?.get('admin.url')))
  // The live-preview site fetches draft content and receives postMessage from
  // the admin, so its origin must be allowed; previewUrl is a template (…?id={id}).
  add(originOf(r?.get('frontend.url')))
  add(originOf(r?.get('frontend.previewUrl')))
  for (const tpl of Object.values((r?.get('frontend.previewUrls') as Record<string, unknown> | undefined) ?? {})) add(originOf(tpl))
  for (const origin of e?.gateway?.cors?.origins ?? []) add(origin)
  return [...out]
}

/**
 * The origins ONE workspace declares, for one environment - or across all
 * of its environments when the environment is not known yet, which is still
 * scoped to that workspace and never to its neighbours.
 *
 * This is the function M4 of the Gateway plan exists for: `collectCorsOrigins`
 * unions every environment of every project into one list handed to a
 * boot-time plugin, so workspace A's declared origin was a valid origin for
 * workspace B's routes. Reading per workspace is what removes that.
 */
export function corsOriginsFor(project: WorkspaceProject | undefined): string[] {
  if (!project) return []
  return [...new Set(projectOrigins(project))]
}

/**
 * Whether the workspace DECLARES any origin at all: `server.cors.origins`,
 * `gateway.cors.origins`, or a URL it (or the deployment's variables) set
 * rather than one the resolver defaulted. A development deployment that
 * declares nothing keeps the bare-clone posture; the localhost defaults the
 * resolver fills in are allowed origins, not a declaration.
 */
export function declaresCorsOrigins(project: WorkspaceProject | undefined): boolean {
  if (!project) return false
  const e = project.config as { server?: { cors?: { origins?: unknown[] } }; gateway?: { cors?: { origins?: unknown[] } } } | undefined
  const listed = [...(e?.server?.cors?.origins ?? []), ...(e?.gateway?.cors?.origins ?? [])]
  if (listed.some((o) => typeof o === 'string' && o.trim() !== '')) return true
  const r = deploymentFor(project)
  for (const key of ['admin.url', 'frontend.url', 'frontend.previewUrl', 'frontend.previewUrls']) {
    const p = r?.explain(key)
    if (p && p.state !== 'default' && p.state !== 'missing' && originOf(p.value) !== null) return true
    if (key === 'frontend.previewUrls' && p && p.state !== 'default' && p.value && typeof p.value === 'object') return true
  }
  return false
}

