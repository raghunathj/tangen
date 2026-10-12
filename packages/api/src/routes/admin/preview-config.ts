/**
 * File Name: preview-config.ts
 * Purpose: GET /api/v1/admin/preview/config — tells the admin editor whether live preview
 *   is configured for the current environment and, if so, the front-end preview URL template
 *   (from the resolved `frontend.previewUrl`). The editor's Preview button and split-pane
 *   read this to build the preview target; when unset, the button hides with a hint.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Member-gated (rides the auth middleware). Pure resolver split out so it
 *   can be unit-tested without a request.
 */
import { deploymentFor } from '../../config/service-settings'
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'

export interface PreviewConfig {
  /** Live preview is usable — a previewUrl template is configured for this env. */
  enabled: boolean
  /** The preview URL template with {id}/{type}/{slug} placeholders (null when unset). */
  previewUrl: string | null
  /** The front-end origin (used to target/verify postMessage in the split-pane). */
  frontendUrl: string | null
  /** Shared device breakpoints from config (previewBreakpoints), for the preview toolbar. */
  breakpoints: Array<{ name: string; width: number }>
}

/** Resolve the front-end preview config for a workspace × env (+ optional content type) from
 *  the loaded projects. A per-type `previewUrls[type]` override wins over the default. */
export function resolvePreviewConfig(
  projects: Array<{ workspaceId: string; config?: any }> | undefined,
  workspaceId: string,
  type?: string,
): PreviewConfig {
  const project = (projects ?? []).find((p) => p.workspaceId === workspaceId)
  // The frontend keys of the RESOLVED deployment: the environment file, the
  // deployment's variables (FRONTEND_URL, FRONTEND_PREVIEW_URL) or
  // the development default, whichever the resolver chose.
  const r = deploymentFor(project as never)
  const previewUrls = r?.get<Record<string, unknown>>('frontend.previewUrls')
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const perType = type && previewUrls && typeof previewUrls === 'object' ? clean(previewUrls[type]) : null
  const previewUrl = perType ?? clean(r?.get('frontend.previewUrl'))
  const frontendUrl = clean(r?.get('frontend.url'))
  // Enabled when a URL resolves AND live preview isn't explicitly disabled for the env.
  const enabled = previewUrl !== null && r?.get<boolean>('frontend.livePreview') !== false
  const previewBreakpoints = r?.get<unknown[]>('frontend.previewBreakpoints')
  const breakpoints = Array.isArray(previewBreakpoints)
    ? previewBreakpoints
        .filter((b: any) => b && typeof b.name === 'string' && typeof b.width === 'number' && b.width > 0)
        .map((b: any) => ({ name: b.name, width: Math.round(b.width) }))
    : []
  return { enabled, previewUrl: enabled ? previewUrl : null, frontendUrl, breakpoints }
}

export const previewConfigRoute = (app: Elysia) =>
  app.get('/api/v1/admin/preview/config', (ctx: any) => {
    if (!ctx.memberId) throw new RequestError('UNAUTHORIZED', 'Sign in to preview content', 401)
    return { data: resolvePreviewConfig(ctx.workspaceProjects, ctx.workspaceId, ctx.query?.type || undefined) }
  })
