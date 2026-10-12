/**
 * File Name: image.ts
 * Purpose: POST /api/v1/admin/ai/image — generates an image for a media field
 *          from a prompt and stores it straight into the media library (folder
 *          "AI generated"), returning the asset for preview/apply. The content
 *          object itself is never touched — apply stays a client-side action.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Member JWT required; tight rate limit (images are the
 *          costliest AI call). Provider must be image-capable — Anthropic
 *          never is; availability carries imageModels per provider.
 */
import { deploymentFor } from '../../config/service-settings'
import { Elysia, t } from 'elysia'
import { requireCapability } from '../../lib/member-access'
import { RequestError } from '../../lib/errors'
import { assertMediaPermission } from '../../lib/permissions'
import { enforceRateLimit } from '../../services/rate-limiter'
import { availableProviders, getProvider, AIProviderError, upstreamRequestError, type AIImageRequest } from '../../services/ai'
import { resolveProviderKey } from '../../lib/ai-keys'
// The media CONTRACT, not the media implementation. Importing
// services/media-ingest here reached services/image-processor and so `sharp`,
// which meant a server with media switched off still loaded the native image
// library. Media registers its implementation when it is enabled.
import { getMediaIngest } from '../../services/media-ingest-contract'
import { mediaFieldAcceptsImages } from '../../services/ai/image-eligibility'
import { readSettings } from './settings'
import type { AISettingsData } from '@tangen/types'

// The eligibility predicate lives with the AI services (object briefs share it);
// re-exported here because this route is its historical home.
export { mediaFieldAcceptsImages }

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_SEC = 60

export const AI_MEDIA_FOLDER = 'AI generated'

/**
 * Resolves the target field: must exist, be a media field that accepts images,
 * and not have AI disabled (`ai.enabled: false`). The image-type check is not
 * overridable — `ai.enabled: true` on a document field stays a no-op.
 */
export function resolveImageField(typeDef: any, fieldName: string): any {
  const field = (typeDef.fields ?? []).find((f: any) => f.name === fieldName)
  if (!field) {
    throw new RequestError('FIELD_NOT_FOUND', `Field "${fieldName}" not found on "${typeDef.name}"`, 404)
  }
  if (field.fieldType !== 'media') {
    throw new RequestError('VALIDATION_ERROR', `Image generation targets media fields - "${fieldName}" is ${field.fieldType}`, 422)
  }
  if ((field.config as any)?.ai?.enabled === false) {
    throw new RequestError('VALIDATION_ERROR', `AI is disabled for field "${fieldName}"`, 422)
  }
  if (!mediaFieldAcceptsImages(field.config as any)) {
    throw new RequestError('VALIDATION_ERROR', `Field "${fieldName}" does not accept image files - image generation is unavailable`, 422)
  }
  return field
}

interface ImageProviderInfo { name: string; available: boolean; imageModels: string[] }

/**
 * Picks the image provider + model: request override → settings.image default →
 * first available image-capable provider. The chosen provider must be available
 * AND able to draw.
 */
export function resolveImageProviderChoice(
  settings: AISettingsData,
  providers: ImageProviderInfo[],
  override: { provider?: string; model?: string },
): { name: string; model: string } {
  const capable = providers.filter(p => p.available && p.imageModels.length > 0)

  function pick(name: string | null | undefined, model: string | null | undefined, hard: boolean): { name: string; model: string } | null {
    if (!name) return null
    const p = capable.find(c => c.name === name)
    if (!p) {
      if (hard) throw new RequestError('VALIDATION_ERROR', `Provider "${name}" is not available for image generation`, 422)
      return null
    }
    const m = model && p.imageModels.includes(model) ? model : p.imageModels[0]
    return { name: p.name, model: m }
  }

  return (
    pick(override.provider, override.model, true) ??
    pick(settings.image?.provider, settings.image?.model, false) ??
    (capable[0]
      ? { name: capable[0].name, model: capable[0].imageModels[0] }
      : (() => { throw new RequestError('VALIDATION_ERROR', 'No available provider supports image generation', 422) })())
  )
}

/** Alt text for the generated asset — the prompt, trimmed and capped. */
export function altTextFromPrompt(prompt: string): string {
  const text = prompt.trim().replace(/\s+/g, ' ')
  return text.length > 160 ? `${text.slice(0, 159)}…` : text
}

const bodySchema = t.Object({
  /** Field mode: both type and field. Library mode (media gallery): neither. */
  type: t.Optional(t.String()),
  field: t.Optional(t.String()),
  prompt: t.String(),
  provider: t.Optional(t.String()),
  model: t.Optional(t.String()),
  size: t.Optional(t.String()),
  /** Library mode only — target folder; defaults to "AI generated". */
  folderId: t.Optional(t.String()),
})

/**
 * Registers the AI image generation endpoint. Mounted after authMiddleware.
 */
export const aiImageRoute = (app: Elysia) =>
  app.post('/api/v1/admin/ai/image', async (ctx: any) => {
    const { db, redis, schema, workspaceId, memberId, workspaceProjects, body } = ctx

    if (!memberId) {
      throw new RequestError('FORBIDDEN', 'AI image generation is admin-panel only', 403)
    }
    assertMediaPermission(ctx.permissions, 'write')
    requireCapability(ctx, 'use:ai')   // K0: through the one guard, so an implying extension capability counts
    if (!body.prompt?.trim()) {
      throw new RequestError('VALIDATION_ERROR', 'prompt is required', 422)
    }
    await enforceRateLimit(redis, workspaceId, `ai-image:${memberId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC)

    // Field mode targets a media field (and inherits its processing config);
    // library mode (media gallery) generates straight into the library.
    const fieldMode = Boolean(body.type || body.field)
    let fieldCfg: { variants?: any[]; skipPresets?: boolean; imageOverrides?: any } = {}
    if (fieldMode) {
      if (!body.type || !body.field) {
        throw new RequestError('VALIDATION_ERROR', 'type and field go together - send both or neither', 422)
      }
      const typeDef = schema?.types?.find((td: any) => td.name === body.type)
      if (!typeDef || typeDef.disabled) {
        throw new RequestError('TYPE_NOT_FOUND', `Type "${body.type}" not found in schema`, 404)
      }
      const field = resolveImageField(typeDef, body.field)
      fieldCfg = (field.config ?? {}) as typeof fieldCfg
    }

    const settings = await readSettings(db, workspaceId)
    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    const envVars = deploymentFor(project)?.secrets
    const providers = availableProviders(project?.ai ?? project?.config?.ai, envVars)
    const choice = resolveImageProviderChoice(settings, providers, { provider: body.provider, model: body.model })

    const provider = getProvider(choice.name as any, resolveProviderKey(choice.name as any, envVars)!)
    if (!provider.generateImage) {
      throw new RequestError('VALIDATION_ERROR', `Provider "${choice.name}" cannot generate images`, 422)
    }

    const size = ['1024x1024', '1536x1024', '1024x1536'].includes(body.size ?? '')
      ? (body.size as AIImageRequest['size'])
      : undefined

    let image
    try {
      image = await provider.generateImage({ prompt: body.prompt, model: choice.model, ...(size ? { size } : {}) })
    } catch (e) {
      if (e instanceof AIProviderError) throw upstreamRequestError(e)
      throw e
    }

    // Storing a generated image needs the media capability. Without it there
    // is nowhere for the file to go, so this is a refusal with a reason rather
    // than a crash or a silently dropped image.
    const media = getMediaIngest()
    if (!media) {
      throw new RequestError(
        'MEDIA_DISABLED',
        'Generated images need the media capability, which is not enabled on this server.',
        409,
      )
    }
    const folderId = body.folderId
      ? String(body.folderId)
      : await media.folderFor(db, workspaceId, AI_MEDIA_FOLDER)
    const ext = image.mimeType === 'image/webp' ? 'webp' : image.mimeType === 'image/jpeg' ? 'jpg' : 'png'
    const asset = await media.ingest(
      { db, workspaceId, workspaceProjects },
      {
        buffer: Buffer.from(image.base64, 'base64'),
        mimeType: image.mimeType,
        originalName: `ai-${Date.now()}.${ext}`,
        folderId,
        altText: altTextFromPrompt(body.prompt),
        createdBy: memberId,
        // generated images honor the field's processing config like any upload
        fieldVariants: fieldCfg.variants,
        skipPresets: fieldCfg.skipPresets,
        imageOverrides: fieldCfg.imageOverrides,
        // provenance — badge in the gallery, full prompt kept for reuse
        ai: { provider: choice.name, model: choice.model, prompt: body.prompt },
        // Fresh generations are UNKEPT drafts: the user confirms with "Add to Media"
        // (metadata.kept=true), else the reaper sweeps them once unreferenced + aged out.
        extraMetadata: { kept: false },
      },
    )

    return {
      data: {
        asset,
        provider: choice.name,
        model: choice.model,
        ...(image.usage ? { usage: image.usage } : {}),
      },
    }
  }, { body: bodySchema })
