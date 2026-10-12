/**
 * File Name: ai-generate-stream.ts
 * Purpose: Pure state logic for the object-brief streaming draft - reducing
 *          /admin/ai/generate SSE events into the reveal-only draft message,
 *          and building the real assistant message from the terminal done
 *          preview (the ONLY place accept state may come from).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: shapes from lib/ai-chat + lib/ai-apply. The draft is a
 *          progressive REVEAL: nothing in it is ever applicable; on done it is
 *          replaced wholesale by assistantMessageFromPreview's message.
 */
import type { GeneratePreviewShape } from '@/lib/ai-apply'
import type { ChatAssistantMessage, ChatDraftMessage, ChatImageOffer, ChatUsage } from '@/lib/ai-chat'

/** A fresh in-flight draft message (appended when the brief is sent). */
export function emptyDraftMessage(at?: string): ChatDraftMessage {
  return {
    role: 'assistant-draft',
    fields: {},
    creates: [],
    streaming: true,
    phase: 'drafting',
    at: at ?? new Date().toISOString(),
  }
}

/**
 * Folds one SSE event into the draft. Only title/field/create/status events
 * change anything; malformed payloads and all other events (delta, meta) leave
 * the draft untouched - the terminal done event is the source of truth anyway.
 * Image offers settle as normal field events server-side; `imageFields` (the
 * type's media field names) routes them into the offer rows by name - they
 * never appear as field values.
 */
export function reduceDraftEvent(msg: ChatDraftMessage, event: string, data: any, imageFields?: Set<string>): ChatDraftMessage {
  switch (event) {
    case 'title':
      return typeof data?.value === 'string' && data.value ? { ...msg, title: data.value } : msg
    case 'field': {
      if (typeof data?.name !== 'string' || !data.name) return msg
      if (imageFields?.has(data.name)) {
        const prompt = String((data.value as { imagePrompt?: unknown } | null)?.imagePrompt ?? '').trim()
        return prompt ? { ...msg, images: { ...msg.images, [data.name]: { prompt } } } : msg
      }
      return { ...msg, fields: { ...msg.fields, [data.name]: { value: data.value } } }
    }
    case 'create':
      return typeof data?.type === 'string' && typeof data?.title === 'string' && typeof data?.forField === 'string'
        ? { ...msg, creates: [...msg.creates, { index: Number(data.index ?? msg.creates.length), type: data.type, title: data.title, forField: data.forField }] }
        : msg
    case 'status':
      return data?.phase === 'parsing' ? { ...msg, phase: 'parsing' } : msg
    default:
      return msg
  }
}

/** Whether anything has been revealed - an empty stopped draft is just dropped. */
export function draftHasContent(msg: ChatDraftMessage): boolean {
  return Boolean(msg.title) || Object.keys(msg.fields).length > 0 || msg.creates.length > 0
    || Object.keys(msg.images ?? {}).length > 0
}

/**
 * Builds the normal reviewable assistant message from a generation preview.
 * Used by BOTH the atomic JSON path and the streaming done swap, so accept
 * state is only ever constructed from an authoritative preview.
 */
export function assistantMessageFromPreview(
  preview: GeneratePreviewShape,
  usage?: ChatUsage,
  at?: string,
): ChatAssistantMessage {
  const offerNames = Object.keys(preview.images ?? {})
  return {
    role: 'assistant',
    preview,
    acceptedFields: new Set(Object.keys(preview.fields)),
    acceptTitle: Boolean(preview.title),
    acceptedCreates: new Set(preview.toCreate.map((_, i) => i)),
    applied: false,
    // Offers start pending (generation only ever begins AFTER done) and
    // pre-accepted like fields - the checkbox binds once an asset exists.
    ...(offerNames.length > 0
      ? {
          images: Object.fromEntries(offerNames.map(name => [
            name,
            { prompt: preview.images![name]!.prompt, status: 'pending' as const, accepted: true },
          ])) as Record<string, ChatImageOffer>,
        }
      : {}),
    ...(usage ? { usage } : {}),
    at: at ?? new Date().toISOString(),
  }
}

// ─── Auto-generation queue ───────────────────────────────────────────────────

/** Cost honesty: at most this many offers auto-generate per brief (the image
 *  route's 5/min rate limit stays the backstop); the rest get a manual button. */
export const AUTO_IMAGE_CAP = 3

/** The offer fields to auto-generate, in offer order, capped. */
export function autoImageFields(
  images: Record<string, { prompt: string }> | undefined,
  cap: number = AUTO_IMAGE_CAP,
): string[] {
  return Object.keys(images ?? {}).slice(0, cap)
}

/**
 * Runs the auto-generation queue strictly sequentially. `generate` must not
 * throw (failures belong on the offer row); `isCancelled` is checked before
 * every start - Stop cancels everything not yet begun but never an in-flight
 * generation (its thumbnail stays reviewable).
 */
export async function runImageQueue(
  fields: string[],
  generate: (field: string) => Promise<void>,
  isCancelled: () => boolean,
): Promise<{ ran: string[]; cancelled: string[] }> {
  const ran: string[] = []
  const cancelled: string[] = []
  for (const field of fields) {
    if (isCancelled()) { cancelled.push(field); continue }
    ran.push(field)
    await generate(field)
  }
  return { ran, cancelled }
}

// ── Auto-images preference (cost gate) ───────────────────────────────────────
// Image generation is the costliest AI call, so offered images do NOT
// auto-generate unless the member opts in via the panel toggle. Off, every
// offer still shows its prompt with a manual Generate button - zero image
// API spend without an explicit action. Persisted per browser.

const AUTO_IMAGES_KEY = 'tangen.ai.autoImages'

export function loadAutoImagesPref(): boolean {
  try { return localStorage.getItem(AUTO_IMAGES_KEY) === '1' } catch { return false }
}

export function saveAutoImagesPref(on: boolean): void {
  try { localStorage.setItem(AUTO_IMAGES_KEY, on ? '1' : '0') } catch { /* SSR / privacy mode */ }
}
