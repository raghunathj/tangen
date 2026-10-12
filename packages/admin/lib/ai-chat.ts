/**
 * File Name: ai-chat.ts
 * Purpose: (De)serialization for AI Assistant conversations — panel state uses
 *          Sets for accept checkboxes, storage uses plain JSON arrays. Also the
 *          sessionStorage handoff key for the new-object → saved-object
 *          navigation, so a chat started on /new survives into the id URL.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: shapes mirror the panel's Message union.
 */
import type { GeneratePreviewShape } from '@/lib/ai-apply'

export interface ChatUserMessage { role: 'user'; text: string; at?: string }
export interface ChatErrorMessage { role: 'error'; text: string; at?: string }
export interface ChatUsage { inputTokens: number; outputTokens: number }
/**
 * One image offer on an object-brief card. Generation runs through the same
 * POST /admin/ai/image as the tagged-field image mode; the value is the same
 * trimmed asset shape that mode applies. 'generating' is transient - it
 * persists as 'pending' so a reopened chat shows a manual Generate button,
 * never a stuck spinner. Unaccepted/unapplied assets stay unkept drafts for
 * the reaper.
 */
export interface ChatImageOffer {
  prompt: string
  status: 'pending' | 'generating' | 'done' | 'failed'
  /** Generated asset, trimmed to what the media field control needs. */
  value?: { id: string; originalName?: string; mimeType?: string; sizeBytes?: number; thumbnailPath?: string | null }
  /** Accept checkbox state (meaningful once status is 'done'). */
  accepted?: boolean
  /** Applying marked the draft kept (reaper safety) - recorded for reopening. */
  kept?: boolean
  error?: string
}
export interface ChatAssistantMessage {
  role: 'assistant'
  preview: GeneratePreviewShape
  acceptedFields: Set<string>
  acceptTitle: boolean
  acceptedCreates: Set<number>
  applied: boolean
  /** Image offers from preview.images, keyed by media field name. */
  images?: Record<string, ChatImageOffer>
  usage?: ChatUsage
  at?: string
}
export interface ChatFillMessage {
  role: 'assistant-fill'
  field: { name: string; label: string; fieldType: string }
  value: unknown
  applied: boolean
  usage?: ChatUsage
  at?: string
  /** Present when this suggestion targets an extension panel's fields. */
  panel?: { extensionId: string; fields: { name: string; label: string; fieldType: string; config?: Record<string, unknown> }[] }
  /** Library-mode image drafts: whether the user kept ("Add to media") or removed it —
   *  persisted so the decision survives reopening the chat (not a re-offer of the buttons). */
  imgState?: 'kept' | 'removed'
  /** Transient: a token stream is appending into value right now. Never persisted —
   *  a reopened chat must not look mid-generation. */
  streaming?: boolean
}
/**
 * Progressive REVEAL of an object brief while /admin/ai/generate streams -
 * fields/creates appear as they settle, but nothing here is ever applicable:
 * on done the draft is REPLACED by a normal ChatAssistantMessage built from
 * the terminal preview. In-flight drafts are never persisted; a stopped one
 * persists as a record that nothing was applied.
 */
export interface ChatDraftMessage {
  role: 'assistant-draft'
  title?: string
  fields: Record<string, { value: unknown }>
  creates: { index: number; type: string; title: string; forField: string }[]
  /** Image offers revealed so far (prompt only - generation waits for done). */
  images?: Record<string, { prompt: string }>
  /** Transient: deltas are still arriving (drives the Stop button + pulse). */
  streaming: boolean
  /** Transient: 'parsing' once the model finished and the server is coercing. */
  phase?: 'drafting' | 'parsing'
  /** The stream ended before done - rows stay visible, nothing is applicable. */
  stopped?: boolean
  at?: string
}
export type ChatMessage = ChatUserMessage | ChatErrorMessage | ChatAssistantMessage | ChatFillMessage | ChatDraftMessage

/** Offers persist with 'generating' downgraded to 'pending' - a reopened chat
 *  must not look mid-generation (the manual Generate button re-offers it). */
function serializeImageOffers(images: Record<string, ChatImageOffer>): Record<string, ChatImageOffer> {
  return Object.fromEntries(Object.entries(images).map(([name, offer]) => [
    name,
    offer.status === 'generating' ? { ...offer, status: 'pending' as const } : offer,
  ]))
}

/** Panel state → JSON-safe array for the chats endpoint / sessionStorage. */
export function serializeChat(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.flatMap((m): Record<string, unknown>[] => {
    if (m.role === 'assistant-draft') {
      // In-flight drafts never persist - a reopened chat must not look
      // mid-generation. A stopped draft persists (minus transient flags) so
      // the "stopped - nothing applied" record survives reopening.
      if (m.streaming) return []
      return [{
        role: m.role,
        ...(m.title ? { title: m.title } : {}),
        fields: m.fields,
        creates: m.creates,
        ...(m.images ? { images: m.images } : {}),
        stopped: true,
        ...(m.at ? { at: m.at } : {}),
      }]
    }
    if (m.role === 'assistant') {
      return [{
        role: m.role,
        preview: m.preview,
        acceptedFields: Array.from(m.acceptedFields),
        acceptTitle: m.acceptTitle,
        acceptedCreates: Array.from(m.acceptedCreates),
        applied: m.applied,
        ...(m.images ? { images: serializeImageOffers(m.images) } : {}),
        ...(m.usage ? { usage: m.usage } : {}),
        ...(m.at ? { at: m.at } : {}),
      }]
    }
    if (m.role === 'assistant-fill') {
      // The debounced persist can fire mid-stream — strip the transient flag
      const { streaming: _streaming, ...rest } = m
      return [{ ...rest }]
    }
    return [{ ...m }]
  })
}

/** Stored offers → panel state: malformed entries dropped, transient states downgraded. */
function parseImageOffers(raw: unknown): Record<string, ChatImageOffer> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, ChatImageOffer> = {}
  for (const [name, o] of Object.entries(raw as Record<string, any>)) {
    if (!o || typeof o !== 'object' || typeof o.prompt !== 'string' || !o.prompt) continue
    const status = o.status === 'done' || o.status === 'failed' ? o.status : 'pending'
    const value = o.value && typeof o.value === 'object' && typeof o.value.id === 'string' ? o.value : undefined
    out[name] = {
      prompt: o.prompt,
      // 'done' without its asset cannot render or apply - re-offer instead
      status: status === 'done' && !value ? 'pending' : status,
      ...(value ? { value } : {}),
      ...(typeof o.accepted === 'boolean' ? { accepted: o.accepted } : {}),
      ...(o.kept === true ? { kept: true } : {}),
      ...(typeof o.error === 'string' && o.error ? { error: o.error } : {}),
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Stored prompt-only offer rows on a stopped draft. */
function parseDraftImages(raw: unknown): Record<string, { prompt: string }> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, { prompt: string }> = {}
  for (const [name, o] of Object.entries(raw as Record<string, any>)) {
    if (o && typeof o === 'object' && typeof o.prompt === 'string' && o.prompt) out[name] = { prompt: o.prompt }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Stored JSON → panel state (unknown shapes dropped). */
export function deserializeChat(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  const out: ChatMessage[] = []
  for (const m of raw as any[]) {
    if (!m || typeof m !== 'object') continue
    if (m.role === 'user' && typeof m.text === 'string') out.push({ role: 'user', text: m.text, ...(typeof m.at === 'string' ? { at: m.at } : {}) })
    else if (m.role === 'error' && typeof m.text === 'string') out.push({ role: 'error', text: m.text, ...(typeof m.at === 'string' ? { at: m.at } : {}) })
    else if (m.role === 'assistant' && m.preview && typeof m.preview === 'object') {
      out.push({
        role: 'assistant',
        preview: m.preview,
        acceptedFields: new Set(Array.isArray(m.acceptedFields) ? m.acceptedFields.map(String) : []),
        acceptTitle: Boolean(m.acceptTitle),
        acceptedCreates: new Set(Array.isArray(m.acceptedCreates) ? m.acceptedCreates.map(Number) : []),
        applied: Boolean(m.applied),
        ...(() => { const images = parseImageOffers(m.images); return images ? { images } : {} })(),
        ...(m.usage && typeof m.usage === 'object' ? { usage: { inputTokens: Number(m.usage.inputTokens ?? 0), outputTokens: Number(m.usage.outputTokens ?? 0) } } : {}),
        ...(typeof m.at === 'string' ? { at: m.at } : {}),
      })
    } else if (m.role === 'assistant-fill' && m.field && typeof m.field === 'object') {
      out.push({
        role: 'assistant-fill', field: m.field, value: m.value, applied: Boolean(m.applied),
        ...(m.usage && typeof m.usage === 'object' ? { usage: { inputTokens: Number(m.usage.inputTokens ?? 0), outputTokens: Number(m.usage.outputTokens ?? 0) } } : {}),
        ...(typeof m.at === 'string' ? { at: m.at } : {}),
        ...(m.panel && typeof m.panel === 'object' ? { panel: m.panel } : {}),
        ...(m.imgState === 'kept' || m.imgState === 'removed' ? { imgState: m.imgState } : {}),
      })
    } else if (m.role === 'assistant-draft' && m.fields && typeof m.fields === 'object') {
      out.push({
        role: 'assistant-draft',
        ...(typeof m.title === 'string' && m.title ? { title: m.title } : {}),
        fields: m.fields,
        creates: Array.isArray(m.creates) ? m.creates : [],
        ...(() => { const images = parseDraftImages(m.images); return images ? { images } : {} })(),
        streaming: false,
        stopped: true,
        ...(typeof m.at === 'string' ? { at: m.at } : {}),
      })
    }
  }
  return out
}

/** sessionStorage key holding a chat started on a not-yet-saved object. */
export function pendingChatKey(workspaceId: string, typeName: string): string {
  return `tangen-ai-chat-pending:${workspaceId}:${typeName}`
}

/** Mints a client-side thread id — ownership (member) is the privacy boundary. */
export function newChatId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `cht_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}
