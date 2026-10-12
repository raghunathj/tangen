/**
 * File Name: upload.ts
 * Purpose: Handles multipart media uploads — validates the file, then delegates
 *   the disk write, thumbnail/variant generation, and asset-record insertion to
 *   the shared media-ingest service.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, services/media-ingest (shared with AI image
 *   generation); accepts both FormData and plain-object bodies for
 *   Elysia 1.1.x compat.
 */
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import { ingestMediaBuffer } from '../../services/media-ingest'
import type { ImageVariant, WorkspaceProject } from '@tangen/types'
import { effectiveRequestLimits, isAllowedMimeType, formatBytes, recordLimitRefusal } from '../../gateway/request-limits'
import { resolveRoutePolicy } from '../../gateway/route-policy'
import { gatewayContextOf } from '../../gateway/request-context'
import { GATEWAY_DEFAULTS } from '../../gateway/resolve-config'
import { assertMediaPermission } from '../../lib/permissions'
import { resolveActorId } from '../../lib/actor'

// Pure helpers live in the ingest service now; re-exported for existing imports.
export { getFileExtension, buildMediaAssetRecord, type BuildAssetRecordOptions } from '../../services/media-ingest'

/** The two limits an upload is measured against (plan 22.3, M6). */
export interface UploadLimits {
  /** Bytes allowed. Defaults to the Gateway's 50MB. */
  maxUploadBytes?: number
  /** MIME allow-list. Undefined is permissive (D-11); a declared list is enforced. */
  maxUploadMimeTypes?: readonly string[]
}

/**
 * Validates that the uploaded file is non-empty, within the resolved upload
 * cap, and of a type the resolved allow-list accepts.
 *
 * The cap used to be a constant here (50MB); it now resolves per workspace
 * and environment through `gateway.requestLimits.maxUploadBytes`, and the
 * `type` this function always took and never read (D-11) is finally judged -
 * against nothing when no scope declares a list, which is today's behaviour.
 * @param file - The MIME type and byte size of the upload.
 * @param limits - The resolved limits; the Gateway defaults when omitted.
 * @throws 413 PAYLOAD_TOO_LARGE over the cap, 415 UNSUPPORTED_MEDIA_TYPE off the list.
 */
export function validateUploadFile(file: { type: string; size: number }, limits: UploadLimits = {}): void {
  const cap = limits.maxUploadBytes ?? GATEWAY_DEFAULTS.requestLimits.maxUploadBytes
  if (file.size <= 0) {
    throw new RequestError('VALIDATION_ERROR', 'File is empty')
  }
  if (file.size > cap) {
    throw new RequestError('PAYLOAD_TOO_LARGE', `File exceeds maximum allowed size of ${formatBytes(cap)}`, 413)
  }
  if (!isAllowedMimeType(file.type, limits.maxUploadMimeTypes)) {
    throw new RequestError(
      'UNSUPPORTED_MEDIA_TYPE',
      `File type '${file.type || 'unknown'}' is not on this environment's upload allow-list`,
      415,
    )
  }
}

/**
 * The upload limits for the request's workspace and environment, read through
 * the Gateway's resolved policy rather than a constant.
 * @param ctx - The Elysia context after auth (workspaceId, workspaceProjects).
 * @returns The resolved limits for the media upload surface.
 */
export function uploadLimitsFor(ctx: { workspaceId?: string; workspaceProjects?: WorkspaceProject[] }): UploadLimits {
  const project = (ctx.workspaceProjects ?? []).find((p) => p.workspaceId === ctx.workspaceId)
  const limits = effectiveRequestLimits(project, resolveRoutePolicy('POST', '/api/v1/media/upload'))
  return { maxUploadBytes: limits.maxUploadBytes, maxUploadMimeTypes: limits.maxUploadMimeTypes }
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * Registers POST /api/v1/media/upload.
 * Requires admin permission or the media:write action. Accepts multipart/form-data
 * with a 'file' field plus optional folderId, altText, variants (JSON array),
 * and skipPresets. For image uploads, generates a system thumbnail and all
 * workspace-configured variant sizes before inserting the asset record.
 * @param app - Elysia application instance
 * @returns The mutated Elysia app with the upload route registered
 */
export const mediaUploadRoute = (app: Elysia, deps: { ingest: typeof ingestMediaBuffer } = { ingest: ingestMediaBuffer }) =>
  app.post('/api/v1/media/upload', async (ctx: any) => {
    const { db, workspaceId, permissions, workspaceProjects } = ctx

    // K0: the one media guard, not a hand-rolled copy of it.
    assertMediaPermission(permissions, 'write')

    // Elysia 1.1.x may parse multipart as a plain object {file,folderId,...}
    // rather than a FormData instance — handle both.
    const rawBody = ctx.body as FormData | Record<string, unknown> | undefined
    if (!rawBody) {
      throw new RequestError('VALIDATION_ERROR', 'Expected multipart/form-data body')
    }
    function getField(key: string): unknown {
      if (typeof (rawBody as any).get === 'function') {
        return (rawBody as FormData).get(key)
      }
      return (rawBody as Record<string, unknown>)[key] ?? null
    }

    const file = getField('file') as File | null
    if (!file || typeof file.arrayBuffer !== 'function') {
      throw new RequestError('VALIDATION_ERROR', 'Missing required form field: file')
    }

    const limits = uploadLimitsFor(ctx)
    try {
      validateUploadFile({ type: file.type, size: file.size }, limits)
    } catch (err) {
      // The refusal reaches the access log the way a body cap's does.
      if (err instanceof RequestError && err.statusCode === 413) {
        recordLimitRefusal(gatewayContextOf(ctx), { limit: 'maxUploadBytes', allowed: limits.maxUploadBytes ?? GATEWAY_DEFAULTS.requestLimits.maxUploadBytes, observed: file.size, via: 'upload' })
      } else if (err instanceof RequestError && err.statusCode === 415) {
        recordLimitRefusal(gatewayContextOf(ctx), { limit: 'maxUploadMimeTypes', allowed: [...(limits.maxUploadMimeTypes ?? [])], observed: file.type, via: 'upload' })
      }
      throw err
    }

    // Multipart JSON parts may arrive pre-parsed (Elysia) or as raw strings (curl)
    function parseJSONField<T>(raw: unknown): T | undefined {
      if (raw == null || raw === '') return undefined
      if (typeof raw === 'string') return JSON.parse(raw) as T
      return raw as T
    }
    const fieldVariants = parseJSONField<ImageVariant[]>(getField('variants')) ?? []
    const targetFolderId = (getField('folderId') as string | null) || null

    // The folder is only known after the multipart parse, so the scope check
    // for it happens here rather than beside the action check above.
    assertMediaPermission(permissions, 'write', targetFolderId)

    const assetRecord = await deps.ingest(
      { db, workspaceId, workspaceProjects },
      {
        buffer: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type,
        originalName: file.name || '',
        folderId: targetFolderId,
        altText: (getField('altText') as string | null) || null,
        // K0: the member who uploaded, else the key - an admin upload used to store null.
        createdBy: resolveActorId(ctx.memberId, ctx.apiKeyId),
        fieldVariants,
        skipPresets: getField('skipPresets') === 'true',
        imageOverrides: parseJSONField(getField('imageOverrides')),
      },
    )

    ctx.set.status = 201
    return mediaUploadResponse(assetRecord)
  })

/**
 * Upload's response envelope. `data` is the house shape every object route
 * answers with; `asset` is the historical key this route shipped with. Both
 * point at the SAME record - clients assuming either shape work (finding #2:
 * a client that assumed `{ data }` got undefined, wrote null into a media
 * field, and the write succeeded).
 */
export function mediaUploadResponse<T>(asset: T): { asset: T; data: T } {
  return { asset, data: asset }
}
