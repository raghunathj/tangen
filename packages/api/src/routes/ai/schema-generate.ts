/**
 * File Name: schema-generate.ts
 * Purpose: AB-1 — the `schema.create` generator. POST /admin/schema/generate turns a
 *   natural-language brief into a **draft** builder model (content type / component /
 *   global) using the AB-0 contract. It NEVER writes — the admin loads the draft into
 *   the builder for review, then Saves through the existing gated write API. Hard-gated
 *   like the schema-write API (schema-writable dev runtime + manage:settings) and
 *   rate-limited. The provider call is injected so the route logic is testable.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { deploymentFor } from '../../config/service-settings'
import { Elysia, t } from 'elysia'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { enforceRateLimit } from '../../services/rate-limiter'
import { getSchemaWritable } from '../../lib/schema-writable'
import { resolveProviderKey } from '../../lib/ai-keys'
import { getProvider, availableProviders, AIProviderError, upstreamRequestError } from '../../services/ai'
import { readSettings } from './settings'
import { resolveProviderChoice } from './fill'
import { listRegisteredExtensionIds, getExtensionManifest } from '../../hooks/app-hooks-registry'
import { listSiteFieldTypes } from '../../services/site-field-types'
import {
  buildBuilderJsonSchema, builderSystemPrompt, coerceBuilderModel,
  buildAssessSchema, assessSystemPrompt, coerceAssessment,
  buildSchemaSetJsonSchema, schemaSetSystemPrompt, coerceSchemaSet,
  type BuilderKind, type BriefAssessment, type GeneratedSchemaItem,
} from '../../services/ai/schema-gen'

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_SEC = 60

export interface SchemaGenResult { value: unknown; usage?: unknown; provider: string; model: string }

/** Injectable deps — real provider call in production; a stub in tests. */
export interface SchemaGenerateDeps {
  isWritable: () => boolean
  runGeneration: (ctx: any, args: { system: string; prompt: string; jsonSchema: Record<string, unknown> }) => Promise<SchemaGenResult>
}

/** Custom field type names available in this runtime (installed extensions + site fields). */
export function resolveCustomTypeNames(): string[] {
  const fromExtensions = listRegisteredExtensionIds()
    .flatMap((id) => (getExtensionManifest(id)?.fieldTypes ?? []).map((f) => f.name))
  const fromSite = listSiteFieldTypes().map((f) => f.name)
  return [...new Set([...fromExtensions, ...fromSite])]
}

/** Existing names of the given kind, so the model avoids collisions. */
function existingNames(ctx: any, kind: BuilderKind): string[] {
  const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === ctx.workspaceId)
  if (kind === 'component') return (project?.components ?? []).map((c: any) => c.name)
  if (kind === 'global') return (project?.globals ?? []).map((g: any) => g.name)
  return (ctx.schema?.types ?? []).map((t2: any) => t2.name)
}

/**
 * The shared schema.create core — builds the AB-0 contract, threads existing names +
 * an optional current draft to refine, runs the (injected) provider, and coerces the
 * result into a draft. Reused by the AB-1 route and the schema.create capability.
 */
export async function generateSchemaDraft(
  ctx: any,
  opts: { kind: BuilderKind; prompt: string; current?: unknown },
  runGeneration: SchemaGenerateDeps['runGeneration'],
) {
  const customTypes = resolveCustomTypeNames()
  const jsonSchema = buildBuilderJsonSchema(opts.kind, customTypes)
  const system = builderSystemPrompt(opts.kind, customTypes)
  const existing = existingNames(ctx, opts.kind)
  const user = [
    existing.length ? `Existing ${opts.kind} names - do NOT reuse: ${existing.join(', ')}.` : '',
    opts.current ? `Refine this current draft:\n${JSON.stringify(opts.current)}` : '',
    `Brief: ${opts.prompt}`,
  ].filter(Boolean).join('\n\n')
  const res = await runGeneration(ctx, { system, prompt: user, jsonSchema })
  return { draft: coerceBuilderModel(res.value, opts.kind, customTypes), provider: res.provider, model: res.model, usage: res.usage }
}

/**
 * Generate a SET of related schemas from one brief (MS-2). Reuses the injected generation
 * + the existing-names context so the model avoids collisions across the whole workspace.
 */
export async function generateSchemaSet(
  ctx: any,
  opts: { prompt: string },
  runGeneration: SchemaGenerateDeps['runGeneration'],
): Promise<{ drafts: GeneratedSchemaItem[]; provider: string; model: string; usage?: unknown }> {
  const customTypes = resolveCustomTypeNames()
  const jsonSchema = buildSchemaSetJsonSchema(customTypes)
  const system = schemaSetSystemPrompt(customTypes)
  const existingTypes = existingNames(ctx, 'type')
  const user = [
    existingTypes.length ? `Existing type names - do NOT reuse: ${existingTypes.join(', ')}.` : '',
    `Brief: ${opts.prompt}`,
  ].filter(Boolean).join('\n\n')
  const res = await runGeneration(ctx, { system, prompt: user, jsonSchema })
  return { drafts: coerceSchemaSet(res.value, customTypes), provider: res.provider, model: res.model, usage: res.usage }
}

/**
 * Pre-draft assessment — a cheap classification of whether the brief is buildable now
 * or should ask clarifying questions first. Reuses the injected generation.
 */
export async function assessSchemaBrief(
  ctx: any,
  opts: { kind: BuilderKind; prompt: string },
  runGeneration: SchemaGenerateDeps['runGeneration'],
): Promise<BriefAssessment> {
  const res = await runGeneration(ctx, {
    system: assessSystemPrompt(opts.kind),
    prompt: `Brief: ${opts.prompt}`,
    jsonSchema: buildAssessSchema(),
  })
  return coerceAssessment(res.value)
}

/** Production generation — resolves the provider/settings/key and calls generateJSON. */
export async function realGeneration(ctx: any, args: { system: string; prompt: string; jsonSchema: Record<string, unknown> }): Promise<SchemaGenResult> {
  const { db, workspaceId, workspaceProjects, body } = ctx
  const settings = await readSettings(db, workspaceId)
  const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
  const envVars = deploymentFor(project)?.secrets
  const providers = availableProviders(project?.ai ?? project?.config?.ai, envVars)
  const choice = resolveProviderChoice(settings, providers, { provider: body.provider, model: body.model }, { preferFast: true })
  try {
    const result = await getProvider(choice.name as any, resolveProviderKey(choice.name as any, envVars)!)
      .generateJSON({ system: args.system, prompt: args.prompt, model: choice.model, maxTokens: 8000 }, args.jsonSchema)
    return { value: result.value, usage: result.usage, provider: choice.name, model: choice.model }
  } catch (e) {
    if (e instanceof AIProviderError) throw upstreamRequestError(e)
    throw e
  }
}

const bodySchema = {
  body: t.Object({
    prompt: t.String({ minLength: 1 }),
    kind: t.Optional(t.Union([t.Literal('type'), t.Literal('component'), t.Literal('global')])),
    current: t.Optional(t.Any()),
    /** Generate a SET of related schemas (whole data model) instead of one. */
    set: t.Optional(t.Boolean()),
    /** Skip the clarify assessment and draft immediately ("just build it"). */
    skipClarify: t.Optional(t.Boolean()),
    provider: t.Optional(t.String()),
    model: t.Optional(t.String()),
  }),
}

/** Build the route with injectable deps (testable without a real LLM). */
export function makeSchemaGenerateRoute(deps: SchemaGenerateDeps) {
  return (app: Elysia) =>
    app.post('/api/v1/admin/schema/generate', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
      if (!deps.isWritable()) {
        throw new RequestError('FORBIDDEN', 'AI schema building is only available on a dev runtime with a writable app source', 403)
      }
      await enforceRateLimit(ctx.redis, ctx.workspaceId, `ai-schema-gen:${ctx.memberId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC)

      // Whole-model brief → a SET of related schemas (no clarify — sets are inherently broad).
      if (ctx.body.set) {
        const out = await generateSchemaSet(ctx, { prompt: ctx.body.prompt }, deps.runGeneration)
        return { data: out }
      }

      const kind: BuilderKind = ctx.body.kind ?? 'type'
      // Ask clarifying questions when the brief is thin (unless the caller opts out).
      if (!ctx.body.skipClarify && !ctx.body.current) {
        const assessment = await assessSchemaBrief(ctx, { kind, prompt: ctx.body.prompt }, deps.runGeneration)
        if (!assessment.ready && assessment.questions.length) {
          return { data: { clarify: { questions: assessment.questions, brief: ctx.body.prompt } } }
        }
      }
      const out = await generateSchemaDraft(ctx, { kind, prompt: ctx.body.prompt, current: ctx.body.current }, deps.runGeneration)
      return { data: out }
    }, bodySchema)
}

/** Production route: real schema-writable gate + real provider call. */
export const schemaGenerateRoute = makeSchemaGenerateRoute({
  isWritable: getSchemaWritable,
  runGeneration: realGeneration,
})
