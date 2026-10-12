/**
 * File Name: settings.ts
 * Purpose: GET/PUT /api/v1/admin/ai/settings — workspace-scoped Content AI
 *          settings (chosen provider/model, title-generation toggle, and the
 *          content guidelines that steer every AI suggestion).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Member JWT required; writes restricted to owner/admin.
 *          Stored in the ai_settings table keyed by workspace only — guidelines
 *          are brand-level and shared across environments by design.
 */
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { aiSettings } from '@tangen/db'
import type { AISettingsData, AIGuidelines, AIGuidelineProfile, AIProviderName } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'

const PROVIDERS: ReadonlyArray<AIProviderName> = ['anthropic', 'openai', 'gemini']

function emptyGuidelines(): AIGuidelines {
  return { audience: '', voiceTone: '', glossary: '', legal: '', general: '' }
}

function mergeGuidelines(base: AIGuidelines, patch: unknown): AIGuidelines {
  const out = { ...base }
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    for (const key of ['audience', 'voiceTone', 'glossary', 'legal', 'general'] as (keyof AIGuidelines)[]) {
      const v = (patch as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = String(v)
    }
  }
  return out
}

/** The shape a workspace starts with before anything is saved. */
export function defaultAISettings(): AISettingsData {
  return {
    provider: null,
    model: null,
    titleGeneration: false,
    profiles: [{ id: 'default', name: 'Default', guidelines: emptyGuidelines() }],
  }
}

/**
 * Merges a client patch into the current settings. Scalars overwrite (null
 * clears provider/model), a `profiles` array replaces the profile list
 * (ids generated when missing, junk entries dropped, never empty), a legacy
 * `guidelines` patch deep-merges into the FIRST profile, unknown keys are
 * dropped, and unknown providers are rejected.
 */
export function mergeAISettings(current: AISettingsData, patch: Record<string, unknown>): AISettingsData {
  const merged: AISettingsData = {
    ...current,
    profiles: current.profiles.map(p => ({ ...p, guidelines: { ...p.guidelines } })),
  }

  if ('provider' in patch) {
    const p = patch.provider
    if (p !== null && !PROVIDERS.includes(p as AIProviderName)) {
      throw new RequestError('VALIDATION_ERROR', `Unknown AI provider: "${String(p)}"`)
    }
    merged.provider = (p as AIProviderName | null)
  }
  if ('model' in patch) {
    merged.model = patch.model === null ? null : String(patch.model)
  }
  if ('titleGeneration' in patch) {
    merged.titleGeneration = Boolean(patch.titleGeneration)
  }
  if ('image' in patch) {
    const img = patch.image
    if (img === null || img === undefined) {
      delete merged.image
    } else if (typeof img === 'object' && !Array.isArray(img)) {
      const p = (img as any).provider ?? null
      if (p !== null && !PROVIDERS.includes(p as AIProviderName)) {
        throw new RequestError('VALIDATION_ERROR', `Unknown AI provider: "${String(p)}"`)
      }
      merged.image = {
        provider: (p as AIProviderName | null),
        model: (img as any).model == null ? null : String((img as any).model),
      }
    }
  }

  if (Array.isArray(patch.profiles)) {
    const profiles: AIGuidelineProfile[] = []
    for (const entry of patch.profiles as any[]) {
      if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name.trim()) continue
      profiles.push({
        id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : `p_${Math.random().toString(36).slice(2, 10)}`,
        name: entry.name.trim().slice(0, 60),
        guidelines: mergeGuidelines(emptyGuidelines(), entry.guidelines),
      })
    }
    merged.profiles = profiles.length > 0 ? profiles : defaultAISettings().profiles
  }

  // Legacy single-guidelines patch (older clients / stored rows) → first profile
  if (patch.guidelines && typeof patch.guidelines === 'object' && !Array.isArray(patch.guidelines)) {
    merged.profiles[0] = {
      ...merged.profiles[0],
      guidelines: mergeGuidelines(merged.profiles[0].guidelines, patch.guidelines),
    }
  }

  return merged
}

/** Only owners and admins may change AI settings and guidelines. */
export function canEditAISettings(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export async function readSettings(db: any, workspaceId: string): Promise<AISettingsData> {
  const rows = await db.select().from(aiSettings).where(eq(aiSettings.workspaceId, workspaceId)).limit(1)
  const stored = (rows as any[])[0]?.data as Partial<AISettingsData> | undefined
  if (!stored) return defaultAISettings()
  // merge over defaults so newly-added sections appear for old rows
  return mergeAISettings(defaultAISettings(), stored as Record<string, unknown>)
}

/**
 * Registers the AI settings endpoints. Mounted after authMiddleware.
 */
export const aiSettingsRoute = (app: Elysia) =>
  app
    .get('/api/v1/admin/ai/settings', async (ctx: any) => {
      const { db, workspaceId, memberId } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'AI settings are admin-panel only', 403)
      return { data: await readSettings(db, workspaceId) }
    })
    .put('/api/v1/admin/ai/settings', async (ctx: any) => {
      const { db, workspaceId, memberId, memberRole } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'AI settings are admin-panel only', 403)
      requireCapability({ permissions: ctx.permissions, memberId }, 'manage:aiSettings')

      const current = await readSettings(db, workspaceId)
      const merged = mergeAISettings(current, (ctx.body ?? {}) as Record<string, unknown>)

      await db
        .insert(aiSettings)
        .values({ workspaceId, data: merged, updatedAt: new Date() })
        .onConflictDoUpdate({ target: aiSettings.workspaceId, set: { data: merged, updatedAt: new Date() } })

      return { data: merged }
    })
