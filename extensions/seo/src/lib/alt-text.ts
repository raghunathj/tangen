/**
 * File Name: alt-text.ts
 * Purpose: SEO Manager S3: share-image alt text (og:image:alt) written by a
 *          vision provider. The prompt, the cleaning of what a model answers
 *          into one alt text, and the one question the panel asks before it
 *          shows a button: can this installation describe an image at all?
 *          Pure - the route and the tests share it.
 *
 * Author: Raghunath J
 * License: MIT
 */
/** Alt text is read aloud: one plain sentence, what is shown, no preamble. 125 characters is the screen-reader convention. */
export const ALT_TEXT_PROMPT = 'Write alt text for this image as used on a web page: one plain sentence of at most 125 characters describing what the image shows. No preamble, no quotes, do not start with "image of" or "picture of".'

/** The prompt, naming the page when the panel knows its title so the description leans the right way. */
export function altTextPrompt(input: { title?: string }): string {
  const title = input.title?.trim()
  return title ? `${ALT_TEXT_PROMPT} The page is titled "${title}".` : ALT_TEXT_PROMPT
}

const MAX = 125

/** One line, unquoted, no "Alt text:" preamble, cut at a word boundary under the cap. Empty in, empty out. */
export function cleanAltText(raw: string): string {
  let text = String(raw ?? '').replace(/\s+/g, ' ').trim()
  text = text.replace(/^(alt text|alt|description)\s*:\s*/i, '')
  text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  if (text.length <= MAX) return text
  const cut = text.slice(0, MAX)
  const atWord = cut.lastIndexOf(' ')
  return (atWord > MAX / 2 ? cut.slice(0, atWord) : cut).replace(/[\s,;:]+$/, '')
}

export type GenerateStatus = { available: true; provider: string } | { available: false; reason: string }

/** Whether this installation can WRITE metadata with AI (V6): the optional grant, then a provider that generates JSON. */
export function generateStatus(ctx: {
  ai?: { generateJSON?: unknown; providers?: () => Array<{ id: string; capabilities: string[]; available: boolean }> }
}): GenerateStatus {
  if (!ctx.ai?.generateJSON) return { available: false, reason: 'Writing metadata with AI needs the ai:generate grant: approve it with `tangen extension upgrade seo --approve-optional ai:generate`.' }
  const provider = (ctx.ai.providers?.() ?? []).find((p) => p.available && p.capabilities.includes('json.generate'))
  if (!provider) return { available: false, reason: 'No enabled AI provider can write text: add a provider key under Settings > AI.' }
  return { available: true, provider: provider.id }
}

export type VisionStatus = { available: true; provider: string } | { available: false; reason: string }

/** The three things a description needs, checked in the order an operator fixes them: the two grants, then a provider that can see. */
export function visionStatus(ctx: {
  ai?: { vision?: unknown; providers?: () => Array<{ id: string; capabilities: string[]; available: boolean }> }
  media?: unknown
}): VisionStatus {
  if (!ctx.ai?.vision) return { available: false, reason: 'Image descriptions need the ai:vision grant: approve it with `tangen extension upgrade seo --approve-optional ai:vision`.' }
  if (!ctx.media) return { available: false, reason: 'Image descriptions need the media:read grant: approve it with `tangen extension upgrade seo --approve-optional media:read`.' }
  // Any enabled provider that can see; the describe call itself honours the workspace's preferred provider.
  const provider = (ctx.ai.providers?.() ?? []).find((p) => p.available && p.capabilities.includes('vision.describe'))
  if (!provider) return { available: false, reason: 'No enabled AI provider can see images: add an Anthropic, OpenAI or Gemini key under Settings > AI.' }
  return { available: true, provider: provider.id }
}
