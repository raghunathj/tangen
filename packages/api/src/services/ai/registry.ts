/**
 * File Name: registry.ts (ai)
 * Purpose: The open AI provider registry (Extension Kernel K8.1,
 *          tasks/plan-extension-kernel.md). Core's built-in providers
 *          (Anthropic, OpenAI, Gemini and the OpenAI-compatible three) are
 *          listed as contributions of the `ai.provider@1` shape - available
 *          when their key resolves - beside the providers the ACTIVE
 *          extensions contribute on that point, each validated (an invalid
 *          one is dropped with a warning, never routed to). Routing is by
 *          capability: the workspace's preference when it advertises the
 *          capability, else the first available provider that does.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { AIConfig, AIProviderName, SecretAccessorLike, AiCapability, AiProviderDefinition, AiProviderEntry } from '@tangen/types'
import { validateAiProvider, pickAiProvider } from '@tangen/types'
import { contributions, noteContributionWarning } from '../../kernel/contributions'
import { resolveProviderKey } from '../../lib/ai-keys'
import { getProvider, availableProviders, supportsVision } from './index'
import { RequestError } from '../../lib/errors'

export interface AiRegistryScope {
  workspaceId: string
  /** The extension ids active in the workspace; only their providers are listed. */
  activeIds: ReadonlySet<string>
  config: AIConfig | undefined
  secrets: SecretAccessorLike | undefined
}

/** A built-in, as a contribution: the legacy adapter behind the new contract, made lazily so a missing key costs nothing. */
function builtIn(name: AIProviderName, available: boolean, models: string[], imageModels: string[], secrets: SecretAccessorLike | undefined): AiProviderEntry {
  let adapter: ReturnType<typeof getProvider> | null = null
  const provider = () => {
    if (!adapter) adapter = getProvider(name, resolveProviderKey(name, secrets) ?? '')
    return adapter
  }
  const capabilities: AiCapability[] = [
    'text.generate', 'json.generate',
    ...(imageModels.length ? (['image.generate'] as AiCapability[]) : []),
    ...(supportsVision(name) ? (['vision.describe'] as AiCapability[]) : []),
  ]
  const entry: AiProviderEntry = {
    id: name, label: name, capabilities, models, imageModels, source: 'core', available,
    text: { generate: async (req) => { const r = await provider().generateText(req); return { text: r.text, usage: r.usage as never } } },
    json: { generate: async (req, schema) => { const r = await provider().generateJSON(req, schema); return { value: r.value, usage: r.usage as never } } },
  }
  if (imageModels.length) {
    entry.image = {
      generate: async (req) => {
        const gen = provider().generateImage
        if (!gen) throw new Error(`${name} cannot generate images`)
        const r = await gen.call(provider(), { prompt: req.prompt, model: req.model, size: req.size, n: req.n } as never)
        return { images: (r as { images?: Array<{ base64?: string; url?: string; mimeType?: string }> }).images ?? [], usage: (r as { usage?: unknown }).usage as never }
      },
    }
  }
  if (supportsVision(name)) {
    entry.vision = {
      describe: async (req) => {
        const image = await inlineImage(req.image)
        const r = await provider().describeImage!({ image, prompt: req.prompt ?? DEFAULT_VISION_PROMPT, model: req.model ?? models[0] ?? '', maxTokens: req.maxTokens })
        return { text: r.text, usage: r.usage as never }
      },
    }
  }
  return entry
}

const DEFAULT_VISION_PROMPT = 'Describe this image in one or two plain sentences.'

/** The base64 prefixes of the image types a provider takes; anything else is sent as PNG and the provider says if it is not. */
const MAGIC: Array<[string, string]> = [['iVBOR', 'image/png'], ['/9j/', 'image/jpeg'], ['R0lGO', 'image/gif'], ['UklGR', 'image/webp']]
const sniff = (base64: string): string => MAGIC.find(([prefix]) => base64.startsWith(prefix))?.[1] ?? 'image/png'

/**
 * Every built-in takes bytes inline. A URL is fetched HERE, by core, so a
 * media file on a private host (a developer's localhost, an internal bucket)
 * can still be described; the provider never fetches anything itself.
 */
async function inlineImage(image: { url?: string; base64?: string; mimeType?: string }): Promise<{ base64: string; mimeType: string }> {
  if (image.base64) return { base64: image.base64, mimeType: image.mimeType ?? sniff(image.base64) }
  if (!image.url) throw new RequestError('AI_IMAGE_UNREADABLE', 'An image needs a url or base64 bytes', 422)
  let res: Response
  try { res = await fetch(image.url) } catch (e) { throw new RequestError('AI_IMAGE_UNREADABLE', `The image could not be fetched: ${(e as Error).message}`, 422) }
  if (!res.ok) throw new RequestError('AI_IMAGE_UNREADABLE', `The image could not be fetched: HTTP ${res.status}`, 422)
  const base64 = Buffer.from(await res.arrayBuffer()).toString('base64')
  const header = res.headers.get('content-type')?.split(';')[0]?.trim()
  return { base64, mimeType: image.mimeType ?? (header && header.startsWith('image/') ? header : sniff(base64)) }
}

/** Every provider the workspace can see: the built-ins, then what active extensions contribute. */
export function listAiProviders(scope: AiRegistryScope): AiProviderEntry[] {
  const out: AiProviderEntry[] = availableProviders(scope.config, scope.secrets)
    .map((p) => builtIn(p.name, p.available, p.models, p.imageModels, scope.secrets))
  const seen = new Set(out.map((p) => p.id))
  for (const c of contributions<AiProviderDefinition>('ai.provider@1', { activeIds: scope.activeIds, workspaceId: scope.workspaceId })) {
    const issues = validateAiProvider(c.item)
    if (issues.length) {
      noteContributionWarning(`ai.provider@1 '${String((c.item as { id?: unknown })?.id ?? '?')}' from extension "${c.extensionId}" dropped: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`)
      continue
    }
    if (seen.has(c.item.id)) {
      noteContributionWarning(`ai.provider@1 from extension "${c.extensionId}" dropped: provider id '${c.item.id}' is already taken`)
      continue
    }
    seen.add(c.item.id)
    out.push({ ...c.item, source: { extensionId: c.extensionId }, available: true })
  }
  return out
}

export function resolveAiProvider(scope: AiRegistryScope, opts: { capability: AiCapability; preferred?: string | null }): AiProviderEntry | null {
  return pickAiProvider(listAiProviders(scope), opts)
}
