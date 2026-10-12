/**
 * File Name: ai-assistant-panel.tsx
 * Purpose: Chat-style AI assistant sidebar for the object editor. Object-level
 *          briefs stream from /admin/ai/generate (fields reveal as they settle,
 *          then a reviewable apply card); tagging a field (via the per-field ✨)
 *          scopes prompts to that field through /admin/ai/fill (prose fields
 *          stream token by token). Conversations persist per object for 30 days
 *          (/admin/ai/chats) and can be cleared manually. The panel carries its
 *          own provider/model picker, guideline-profile picker (when several
 *          exist), and per-response token usage.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: buildApplyPatch (lib/ai-apply) owns the merge;
 *          serialization in lib/ai-chat. Nothing here ever publishes.
 */
import { useRef, useState, useEffect, useMemo } from 'react'
import { Callout } from '@tangen/ui'
import { IconSparkles, IconX, IconPlus, IconChevronDown, IconTrash } from '@tangen/icons'
import { Button } from '@/components/ui/button'
import { adminFetch, adminFetchStream } from '@/lib/api'
import { readSSEStream } from '@/lib/sse-client'
import { toast } from '@/lib/toast'
import { buildApplyPatch, type GeneratePreviewShape, type ApplyPatch } from '@/lib/ai-apply'
import {
  serializeChat, deserializeChat, pendingChatKey, newChatId,
  type ChatMessage, type ChatAssistantMessage, type ChatFillMessage, type ChatDraftMessage, type ChatImageOffer, type ChatUsage,
} from '@/lib/ai-chat'
import {
  emptyDraftMessage, reduceDraftEvent, draftHasContent, assistantMessageFromPreview,
  autoImageFields, runImageQueue, loadAutoImagesPref, saveAutoImagesPref,
} from '@/lib/ai-generate-stream'
import { previewValue, ValuePreview } from './ai-fill-button'

export type TaggedField =
  | { kind?: 'field'; name: string; label: string; fieldType: string }
  | { kind: 'panel'; extensionId: string; panelId: string; label: string; instructions?: string; fields: { name: string; label: string; fieldType: string; config?: Record<string, unknown> }[] }

interface ProviderInfo { name: string; available: boolean; models: string[]; imageModels?: string[] }
interface ProfileInfo { id: string; name: string }
interface ThreadInfo { id: string; title: string; updatedAt: string }

const PROVIDER_LABELS: Record<string, string> = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini' }

/**
 * Prose field types whose tagged fill token-streams live into the chat
 * (server: /admin/ai/fill?stream=1). Object briefs stream too, as a
 * progressive reveal (see streamGenerate); panel and non-prose field fills
 * stay atomic.
 */
const STREAMING_FIELD_TYPES = new Set(['text', 'textarea', 'richtext'])

/** Perceived-progress stages shown while the model works (advances on a timer, holds at the last). */
const GENERATING_STAGES = ['Understanding your request', 'Thinking', 'Drafting', 'Polishing']

function GeneratingStatus() {
  const [stage, setStage] = useState(0)
  useEffect(() => {
    // Advance ~every 1.8s, then hold on the final stage until the response lands.
    const t = setInterval(() => setStage((s) => Math.min(s + 1, GENERATING_STAGES.length - 1)), 1800)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex items-center gap-2 text-sm text-fg-subtle">
      <IconSparkles className="w-3.5 h-3.5 animate-pulse text-accent" />
      <span>{GENERATING_STAGES[stage]}…</span>
    </div>
  )
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

interface AIAssistantPanelProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  typeName: string
  /** null while the object hasn't been saved yet */
  objectId: string | null
  fields: { name: string; label: string; fieldType: string; config?: Record<string, unknown> }[]
  title: string
  values: Record<string, unknown>
  /** Field tagged from a per-field ✨ click — scopes the chat to that field. */
  tagField: TaggedField | null
  onApply: (patch: ApplyPatch) => void
  onApplyField: (name: string, value: unknown) => void
  onApplyPanel: (extensionId: string, values: Record<string, unknown>) => void
  /**
   * 'object' (default) chats about a content object; 'library' is the media
   * gallery's image studio — every brief generates an image straight into the
   * library (no fields, no apply — onImageGenerated notifies the host).
   */
  mode?: 'object' | 'library' | 'form'
  /** form mode - the admin route that generates a definition (an extension's own, e.g. '/admin/ext/forms/generate'). */
  generateEndpoint?: string
  /** Library mode: target folder for generated images. */
  folderId?: string | null
  /** Library mode: fired when a generated draft is generated (host may preview it). */
  onImageGenerated?: (asset: Record<string, unknown>) => void
  /** Library mode: fired after "Add to media" keeps a draft — it's now a real library
   *  asset (the host refetches + selects it; drafts are otherwise hidden from the library). */
  onImageKept?: (asset: Record<string, unknown>) => void
  /** Library mode: fired after a generated image is removed via "Remove" (host refetches). */
  onImageRemoved?: (assetId: string) => void
  /** form mode — the builder's current definition (context for edit-by-prompt). */
  formDefinition?: Record<string, unknown> | null
  /** form mode — apply a generated definition to the builder (unsaved). */
  onFormGenerated?: (definition: Record<string, unknown>) => void
  /**
   * Drops text (and optionally a provider/model) into the input, ready to
   * edit and send — e.g. "Regenerate" hands over a stored prompt. Pass a new
   * object per request; the panel reacts to the reference change.
   */
  prefill?: { text: string; provider?: string; model?: string } | null
}

export function AIAssistantPanel({
  open, onClose, workspaceId, typeName, objectId, fields, title, values, tagField, onApply, onApplyField, onApplyPanel,
  mode = 'object', folderId, onImageGenerated, onImageKept, onImageRemoved, prefill, formDefinition, onFormGenerated, generateEndpoint,
}: AIAssistantPanelProps) {
  const libraryMode = mode === 'library'
  const formMode = mode === 'form'
  const [minimized, setMinimized] = useState(false)
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const dragStart = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [threads, setThreads] = useState<ThreadInfo[]>([])
  const [activeChatId, setActiveChatId] = useState<string>(() => newChatId())
  const [threadsOpen, setThreadsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null)
  const [tag, setTag] = useState<TaggedField | null>(null)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [providerChoice, setProviderChoice] = useState<string>('')   // '' = workspace default
  const [modelChoice, setModelChoice] = useState<string>('')         // '' = default model
  const [profileChoice, setProfileChoice] = useState<string>('')     // profile id
  const scrollRef = useRef<HTMLDivElement>(null)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamAbort = useRef<AbortController | null>(null)
  // Object-brief image auto-generation (runs only AFTER a done event): Stop
  // flips the cancel flag - the queue skips everything not yet started.
  const imgQueueCancel = useRef(false)
  const [imageQueueActive, setImageQueueActive] = useState(false)
  // Cost gate: offered images auto-generate only when the member opted in.
  const [autoImages, setAutoImages] = useState(loadAutoImagesPref)

  // A token stream is appending into the last message right now (drives the
  // Stop control and replaces the staged GeneratingStatus with live tokens)
  const streamingLive = messages.some(m =>
    (m.role === 'assistant-fill' || m.role === 'assistant-draft') && m.streaming === true)

  const fieldByName = new Map(fields.map(f => [f.name, f]))
  const manyFields = new Set(
    fields.filter(f => f.fieldType === 'relation' && (f.config as any)?.many === true).map(f => f.name),
  )
  // Media field names route streamed image offers by name (the server only
  // emits offers for eligible fields, so type alone is enough here)
  const mediaFieldNames = new Set(fields.filter(f => f.fieldType === 'media').map(f => f.name))
  // Tagged media field (or the media-gallery studio) → images instead of text
  const imageMode = libraryMode || Boolean(tag && tag.kind !== 'panel' && tag.fieldType === 'media')
  // Whether ANY available provider can draw - offers without one render the
  // prompt with a note instead of a Generate button
  const imageCapable = providers.some(p => (p.imageModels?.length ?? 0) > 0)

  const sessionUsage = useMemo(() => {
    let input = 0, output = 0
    for (const m of messages) {
      const u = (m as { usage?: ChatUsage }).usage
      if (u) { input += u.inputTokens; output += u.outputTokens }
    }
    return { input, output }
  }, [messages])

  // Adopt a tag whenever a per-field ✨ opens/refocuses the panel
  useEffect(() => { if (tagField) { setTag(tagField); setMinimized(false) } }, [tagField])

  // Handed-over prompt (e.g. Regenerate) lands in the input, ready to edit
  useEffect(() => {
    if (!prefill?.text) return
    setInput(prefill.text)
    if (prefill.provider) { setProviderChoice(prefill.provider); setModelChoice(prefill.model ?? '') }
    setMinimized(false)
  }, [prefill])

  // Image mode needs an image-capable provider — hop off e.g. Claude automatically
  useEffect(() => {
    if (!imageMode) return
    const current = providers.find(p => p.name === providerChoice)
    if (current && (current.imageModels?.length ?? 0) > 0) return
    const capable = providers.find(p => (p.imageModels?.length ?? 0) > 0)
    if (capable) { setProviderChoice(capable.name); setModelChoice('') }
  }, [imageMode, providers, providerChoice])

  // Tagging a media field whose current image was AI-generated prefills the
  // chat with its stored prompt — refine instead of retyping.
  useEffect(() => {
    if (!imageMode || !tag || tag.kind === 'panel') return
    const current = values[tag.name] as { id?: string } | string | null | undefined
    const assetId = typeof current === 'string' ? current : current?.id
    if (!assetId) return
    adminFetch<{ data: { ai: { prompt: string } | null } }>(`/media/asset/${assetId}`)
      .then((r) => {
        const prompt = r.data.ai?.prompt
        if (prompt) setInput((prev) => (prev.trim() ? prev : prompt))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageMode, tag && tag.kind !== 'panel' ? tag.name : null])

  function startDrag(e: React.PointerEvent) {
    const target = e.target as HTMLElement
    if (target.closest('button, select, input, textarea')) return
    dragStart.current = { px: e.clientX, py: e.clientY, x: drag.x, y: drag.y }
    const move = (ev: PointerEvent) => {
      const s = dragStart.current
      if (!s) return
      const nx = Math.min(8, Math.max(-(window.innerWidth - 430), s.x + ev.clientX - s.px))
      const ny = Math.min(window.innerHeight - 300, Math.max(-48, s.y + ev.clientY - s.py))
      setDrag({ x: nx, y: ny })
    }
    const up = () => {
      dragStart.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Providers + guideline profiles for the pickers
  useEffect(() => {
    if (!open) return
    adminFetch<{ data: { providers: ProviderInfo[] } }>('/admin/ai/providers')
      .then(r => setProviders(r.data.providers.filter(p => p.available)))
      .catch(() => {})
    adminFetch<{ data: { provider: string | null; model: string | null; profiles: { id: string; name: string }[] } }>('/admin/ai/settings')
      .then(r => {
        setProfiles(r.data.profiles.map(p => ({ id: p.id, name: p.name })))
        setProviderChoice(r.data.provider ?? '')
        setModelChoice(r.data.model ?? '')
        setProfileChoice(r.data.profiles[0]?.id ?? '')
      })
      .catch(() => {})
  }, [open])

  // ── History: load the thread list once per object; open the most recent
  //    thread, adopting any pending new-object chat into a fresh thread id.
  useEffect(() => {
    if (!open || historyLoaded) return
    const pendingKey = pendingChatKey(workspaceId, typeName)
    if (!objectId) {
      // A new object always starts with a fresh conversation. Any pending chat
      // here is a leftover from an earlier abandoned /new session — drop it.
      sessionStorage.removeItem(pendingKey)
      setHistoryLoaded(true)
      return
    }
    adminFetch<{ data: { chats: ThreadInfo[] } }>(`/admin/ai/chats/${typeName}/${objectId}`)
      .then(async (r) => {
        setThreads(r.data.chats)
        const latest = r.data.chats[0]
        if (latest) {
          const thread = await adminFetch<{ data: { messages: unknown[] } }>(
            `/admin/ai/chats/${typeName}/${objectId}/${encodeURIComponent(latest.id)}`)
          setActiveChatId(latest.id)
          setMessages(deserializeChat(thread.data.messages))
        } else {
          // no threads yet — adopt a chat started on /new, under a fresh id
          const pending = sessionStorage.getItem(pendingKey)
          if (pending) {
            try { setMessages(deserializeChat(JSON.parse(pending))) } catch { /* ignore */ }
          }
        }
        sessionStorage.removeItem(pendingKey)
      })
      .catch(() => {})
      .finally(() => setHistoryLoaded(true))
  }, [open, historyLoaded, objectId, typeName, workspaceId])

  // ── History: persist the active thread (debounced) whenever messages change
  useEffect(() => {
    if (!historyLoaded || messages.length === 0) return
    const payload = serializeChat(messages)
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      if (objectId) {
        adminFetch<{ data: { id: string; title: string } }>(
          `/admin/ai/chats/${typeName}/${objectId}/${encodeURIComponent(activeChatId)}`, {
            method: 'PUT',
            body: JSON.stringify({ messages: payload }),
          })
          .then((r) => {
            const at = new Date().toISOString()
            setThreads(list => [
              { id: r.data.id, title: r.data.title || 'New chat', updatedAt: at },
              ...list.filter(t => t.id !== r.data.id),
            ])
          })
          .catch(() => {})
      } else {
        sessionStorage.setItem(pendingChatKey(workspaceId, typeName), JSON.stringify(payload))
      }
    }, 600)
  }, [messages, historyLoaded, objectId, typeName, workspaceId, activeChatId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading, open])

  // Leaving the editor mid-stream must stop the generation (and its cost) -
  // including any image auto-generation still queued
  useEffect(() => () => { streamAbort.current?.abort(); imgQueueCancel.current = true }, [])

  function overrides() {
    return {
      ...(providerChoice ? { provider: providerChoice, ...(modelChoice ? { model: modelChoice } : {}) } : {}),
      ...(profileChoice && profiles.length > 1 ? { guidelinesId: profileChoice } : {}),
    }
  }

  /** Patches the message a token stream is currently writing into (the last streaming fill). */
  function patchStreamingFill(update: (msg: ChatFillMessage) => ChatFillMessage) {
    setMessages(m => {
      for (let i = m.length - 1; i >= 0; i--) {
        const msg = m[i]
        if (msg.role === 'assistant-fill' && msg.streaming === true) {
          const next = m.slice()
          next[i] = update(msg)
          return next
        }
      }
      return m
    })
  }

  /** Streams a tagged prose-field fill: placeholder in, deltas appended live, done finalizes. */
  async function streamFill(field: { name: string; label: string; fieldType: string }, brief: string) {
    setMessages(m => [...m, {
      role: 'assistant-fill',
      field: { name: field.name, label: field.label, fieldType: field.fieldType },
      value: '', applied: false, streaming: true, at: new Date().toISOString(),
    }])
    const controller = new AbortController()
    streamAbort.current = controller
    let streamedText = ''
    try {
      const res = await adminFetchStream('/admin/ai/fill', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ type: typeName, field: field.name, instruction: brief, values: { title, ...values }, ...overrides() }),
      })
      let finished = false
      for await (const ev of readSSEStream(res)) {
        if (ev.event === 'delta') {
          streamedText += String(ev.data?.text ?? '')
          const snapshot = streamedText
          patchStreamingFill(msg => ({ ...msg, value: snapshot }))
        } else if (ev.event === 'done') {
          finished = true
          patchStreamingFill(msg => ({
            ...msg,
            value: ev.data?.value ?? streamedText,
            ...(ev.data?.usage ? { usage: ev.data.usage as ChatUsage } : {}),
            streaming: false,
          }))
        } else if (ev.event === 'error') {
          throw new Error(String(ev.data?.message ?? 'Generation failed'))
        }
      }
      if (!finished) patchStreamingFill(msg => ({ ...msg, streaming: false }))
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        // Stopped by the editor: keep the partial text (still applicable), drop an empty shell
        if (streamedText.trim()) patchStreamingFill(msg => ({ ...msg, streaming: false }))
        else setMessages(m => m.filter(msg => !(msg.role === 'assistant-fill' && msg.streaming === true)))
      } else {
        setMessages(m => m.filter(msg => !(msg.role === 'assistant-fill' && msg.streaming === true)))
        throw e   // send()'s catch renders the error message
      }
    } finally {
      streamAbort.current = null
    }
  }

  /** Patches the draft message the generate stream is currently revealing into. */
  function patchStreamingDraft(update: (msg: ChatDraftMessage) => ChatDraftMessage) {
    setMessages(m => {
      for (let i = m.length - 1; i >= 0; i--) {
        const msg = m[i]
        if (msg.role === 'assistant-draft' && msg.streaming === true) {
          const next = m.slice()
          next[i] = update(msg)
          return next
        }
      }
      return m
    })
  }

  /** Marks the in-flight draft stopped (or drops it when nothing was revealed yet). */
  function settleStreamingDraft() {
    setMessages(m => m.flatMap((msg): ChatMessage[] =>
      msg.role === 'assistant-draft' && msg.streaming === true
        ? (draftHasContent(msg) ? [{ ...msg, streaming: false, stopped: true }] : [])
        : [msg]))
  }

  /** Patches one image offer on the assistant message minted at `at` - keyed
   *  by timestamp, not index, so the async queue survives list changes. */
  function patchOfferAt(at: string, field: string, update: (offer: ChatImageOffer) => ChatImageOffer) {
    setMessages(m => m.map(msg => {
      if (msg.role !== 'assistant' || msg.at !== at || !msg.images?.[field]) return msg
      return { ...msg, images: { ...msg.images, [field]: update(msg.images[field]!) } }
    }))
  }

  /**
   * Generates one offered image through the SAME POST /admin/ai/image as the
   * tagged-field image mode (drafts, provenance, variants, reaper included).
   * Deliberately no provider override: the panel's text-model choice must not
   * break drawing - the server resolves the image default / first capable
   * provider. Failures land on the row as Retry, never block the text preview.
   */
  async function generateOfferImage(at: string, field: string, prompt: string) {
    patchOfferAt(at, field, ({ error: _e, ...rest }) => ({ ...rest, status: 'generating' }))
    try {
      const r = await adminFetch<{ data: { asset: Record<string, unknown> } }>('/admin/ai/image', {
        method: 'POST',
        body: JSON.stringify({ type: typeName, field, prompt }),
      })
      const a = r.data.asset
      // only what the media field control needs - the full record stays in the library
      const value = {
        id: String(a.id), originalName: a.originalName, mimeType: a.mimeType,
        sizeBytes: a.sizeBytes, thumbnailPath: a.thumbnailPath,
      } as NonNullable<ChatImageOffer['value']>
      patchOfferAt(at, field, o => ({ ...o, status: 'done', value, accepted: o.accepted !== false }))
    } catch (e: any) {
      patchOfferAt(at, field, o => ({ ...o, status: 'failed', error: e?.message ?? 'Image generation failed' }))
    }
  }

  /**
   * Auto-generates offered images - only ever AFTER the terminal done event
   * (an aborted brief costs zero image calls), sequentially, capped at 3 per
   * brief; the rest keep a manual Generate button. Stop cancels everything not
   * yet started; finished thumbnails stay reviewable. Without an image-capable
   * provider the rows just show their prompt with a note.
   */
  async function autoGenerateOffers(assistant: ChatAssistantMessage) {
    const offers = assistant.images
    const at = assistant.at
    if (!offers || !at || !imageCapable) return
    // Auto-generation is opt-in (image calls are the costliest) - when off,
    // every offer keeps its manual Generate button instead.
    if (!autoImages) return
    imgQueueCancel.current = false
    setImageQueueActive(true)
    try {
      await runImageQueue(
        autoImageFields(offers),
        f => generateOfferImage(at, f, offers[f]!.prompt),
        () => imgQueueCancel.current,
      )
    } finally {
      setImageQueueActive(false)
    }
  }

  /**
   * Streams an object brief (/admin/ai/generate SSE): settled fields/creates
   * reveal into a draft card as the model writes; the terminal done event
   * REPLACES the draft with the normal reviewable message - accept state only
   * ever comes from that authoritative preview. Stop keeps the revealed rows,
   * marked "stopped - nothing applied"; nothing partial is ever applicable.
   */
  async function streamGenerate(prompt: string) {
    setMessages(m => [...m, emptyDraftMessage()])
    const controller = new AbortController()
    streamAbort.current = controller
    try {
      const res = await adminFetchStream('/admin/ai/generate', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ type: typeName, prompt, values: { title, ...values }, ...overrides() }),
      })
      let finished = false
      for await (const ev of readSSEStream(res)) {
        if (ev.event === 'done') {
          finished = true
          const preview = (ev.data?.preview ?? { fields: {}, unresolved: [], toCreate: [] }) as GeneratePreviewShape
          const assistant = assistantMessageFromPreview(preview, ev.data?.usage as ChatUsage | undefined)
          // The streamed rows are replaced wholesale - never merged
          setMessages(m => m.map(msg => (msg.role === 'assistant-draft' && msg.streaming === true ? assistant : msg)))
          // Image offers generate only now - after done, off the await chain so
          // the chat stays usable while thumbnails fill in.
          void autoGenerateOffers(assistant)
        } else if (ev.event === 'error') {
          throw new Error(String(ev.data?.message ?? 'Generation failed'))
        } else {
          patchStreamingDraft(msg => reduceDraftEvent(msg, ev.event, ev.data, mediaFieldNames))
        }
      }
      if (!finished) throw new Error('The stream ended before a result arrived - nothing was applied')
    } catch (e) {
      // Stop (abort) and errors both keep the revealed rows as a stopped
      // record (an empty draft is dropped); errors then surface their message.
      settleStreamingDraft()
      if ((e as Error)?.name !== 'AbortError') throw e   // send()'s catch renders the error
    } finally {
      streamAbort.current = null
    }
  }

  async function send() {
    const brief = input.trim()
    if (!brief || loading) return
    setInput('')
    const at = new Date().toISOString()
    setMessages(m => [...m, { role: 'user', text: tag ? `@${tag.label}: ${brief}` : brief, at }])
    setLoading(true)
    try {
      if (tag && tag.kind === 'panel') {
        const r = await adminFetch<{ data: { value: Record<string, unknown>; usage?: ChatUsage } }>('/admin/ai/fill', {
          method: 'POST',
          body: JSON.stringify({
            type: typeName, field: '__panel', instruction: brief,
            panelFields: tag.fields, panelLabel: tag.label,
            ...(tag.instructions ? { panelInstructions: tag.instructions } : {}),
            values: { title, ...values }, ...overrides(),
          }),
        })
        setMessages(m => [...m, {
          role: 'assistant-fill',
          field: { name: `__panel_${tag.extensionId}`, label: tag.label, fieldType: 'panel' },
          panel: { extensionId: tag.extensionId, fields: tag.fields },
          value: r.data.value, applied: false, usage: r.data.usage, at: new Date().toISOString(),
        }])
      } else if (formMode) {
        const hasCurrent = Boolean(formDefinition && Array.isArray((formDefinition as any).fields) && (formDefinition as any).fields.length > 0)
        const r = await adminFetch<{ data: { definition: Record<string, unknown>; usage?: ChatUsage } }>(generateEndpoint ?? '/admin/ai/forms/generate', {
          method: 'POST',
          body: JSON.stringify({
            prompt: brief,
            mode: hasCurrent ? 'edit' : 'create',
            ...(hasCurrent ? { current: formDefinition } : {}),
            ...overrides(),
          }),
        })
        const def = r.data.definition as any
        setMessages(m => [...m, {
          role: 'assistant-fill',
          field: { name: '__form', label: def.name ?? 'Form', fieldType: 'form' },
          value: def, applied: false, usage: r.data.usage, at: new Date().toISOString(),
        }])
      } else if (libraryMode) {
        const r = await adminFetch<{ data: { asset: Record<string, unknown>; usage?: ChatUsage } }>('/admin/ai/image', {
          method: 'POST',
          body: JSON.stringify({ prompt: brief, ...(folderId ? { folderId } : {}), ...overrides() }),
        })
        const a = r.data.asset
        const value = { id: a.id, originalName: a.originalName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, thumbnailPath: a.thumbnailPath }
        setMessages(m => [...m, { role: 'assistant-fill', field: { name: '__library', label: 'Image', fieldType: 'media' }, value, applied: true, usage: r.data.usage, at: new Date().toISOString() }])
        onImageGenerated?.(a)
      } else if (tag && tag.fieldType === 'media') {
        const r = await adminFetch<{ data: { asset: Record<string, unknown>; usage?: ChatUsage } }>('/admin/ai/image', {
          method: 'POST',
          body: JSON.stringify({ type: typeName, field: tag.name, prompt: brief, ...overrides() }),
        })
        const a = r.data.asset
        // only what the media field control needs — the full record stays in the library
        const value = { id: a.id, originalName: a.originalName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, thumbnailPath: a.thumbnailPath }
        setMessages(m => [...m, { role: 'assistant-fill', field: { name: tag.name, label: tag.label, fieldType: 'media' }, value, applied: false, usage: r.data.usage, at: new Date().toISOString() }])
      } else if (tag && STREAMING_FIELD_TYPES.has(tag.fieldType)) {
        // Prose fields stream for real: tokens append into the message as the
        // model writes; done carries the coerced value + usage. The debounced
        // chats PUT persists the final message like any other reply.
        await streamFill(tag, brief)
      } else if (tag) {
        const r = await adminFetch<{ data: { value: unknown; usage?: ChatUsage } }>('/admin/ai/fill', {
          method: 'POST',
          body: JSON.stringify({ type: typeName, field: tag.name, instruction: brief, values: { title, ...values }, ...overrides() }),
        })
        setMessages(m => [...m, { role: 'assistant-fill', field: { name: tag.name, label: tag.label, fieldType: tag.fieldType }, value: r.data.value, applied: false, usage: r.data.usage, at: new Date().toISOString() }])
      } else {
        const priorBriefs = messages.filter(m => m.role === 'user').slice(-3).map(m => (m as any).text)
        const prompt = priorBriefs.length > 0
          ? `Earlier instructions (already partially applied):\n${priorBriefs.map(t => `- ${t}`).join('\n')}\n\nNew instruction: ${brief}`
          : brief
        // Object briefs stream for real: fields reveal as they settle, the
        // terminal done event swaps in the reviewable preview card.
        await streamGenerate(prompt)
      }
    } catch (e: any) {
      setMessages(m => [...m, { role: 'error', text: e.message ?? 'Generation failed', at: new Date().toISOString() }])
    } finally {
      setLoading(false)
    }
  }

  function patchMessage(idx: number, update: (msg: ChatAssistantMessage) => ChatAssistantMessage) {
    setMessages(m => m.map((msg, i) => (i === idx && msg.role === 'assistant' ? update(msg) : msg)))
  }

  async function apply(idx: number) {
    const msg = messages[idx]
    if (!msg || msg.role !== 'assistant' || msg.applied) return
    setApplyingIdx(idx)
    try {
      const created: { forField: string; id: string }[] = []
      const createdByKey = new Map<string, string>()
      for (const i of msg.acceptedCreates) {
        const entry = msg.preview.toCreate[i]
        if (!entry) continue
        const key = `${entry.type}:${entry.title.toLowerCase()}`
        let id = createdByKey.get(key)
        if (!id) {
          const res = await adminFetch<{ data: { id: string } }>(`/objects/${entry.type}`, {
            method: 'POST',
            body: JSON.stringify({ title: entry.title }),
          })
          id = res.data.id
          createdByKey.set(key, id)
        }
        created.push({ forField: entry.forField, id })
      }
      // Accepted image offers: only member-witnessed generated assets qualify
      const acceptedImages = Object.entries(msg.images ?? {})
        .filter(([, o]) => o.status === 'done' && o.accepted !== false && o.value)
        .map(([field, o]) => ({ field, value: o.value as unknown }))
      const patch = buildApplyPatch({
        preview: msg.preview,
        acceptedFields: msg.acceptedFields,
        acceptTitle: msg.acceptTitle,
        created,
        manyFields,
        acceptedImages,
      })
      onApply(patch)
      // Applying a generated image is an explicit "keep" - it survives the
      // reaper even before the object is saved (same as the tagged image mode).
      // Declined offers stay unkept drafts for the reaper.
      for (const { field, value } of acceptedImages) {
        void keepImage(idx, (value as { id: string }).id, field)
      }
      patchMessage(idx, m => ({ ...m, applied: true }))
      toast.success('Applied to the draft')
    } catch (e: any) {
      toast.error('Could not apply', e.message)
    } finally {
      setApplyingIdx(null)
    }
  }

  // AI images are persisted as UNKEPT drafts. In library mode (gallery / media picker)
  // each result gets Add-to-Media / Remove; elsewhere applying the image keeps it too.
  // The final decision (kept/removed) is written onto the message (imgState) so it
  // survives reopening the chat; `busy` is transient per-asset spinner state.
  const [busyImages, setBusyImages] = useState<Set<string>>(new Set())
  const setBusy = (id: string, on: boolean) => setBusyImages(s => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n })
  function markImgState(idx: number, state: 'kept' | 'removed') {
    setMessages(m => m.map((msg, i) => (i === idx && msg.role === 'assistant-fill' ? { ...msg, imgState: state } : msg)))
  }

  async function keepImage(idx: number, assetId: string, offerField?: string) {
    if (!assetId) return
    setBusy(assetId, true)
    try {
      const res = await adminFetch<{ data: Record<string, unknown> }>(`/media/asset/${assetId}/keep`, { method: 'POST' })
      // Object-brief offers record the keep on their row; fill messages on imgState.
      if (offerField !== undefined) {
        setMessages(m => m.map((msg, i) => (
          i === idx && msg.role === 'assistant' && msg.images?.[offerField]
            ? { ...msg, images: { ...msg.images, [offerField]: { ...msg.images[offerField]!, kept: true } } }
            : msg
        )))
      } else {
        markImgState(idx, 'kept')
      }
      // Now a real library asset — let the host surface it (gallery/picker select it).
      onImageKept?.(res?.data ?? { id: assetId })
    } catch {
      toast.error('Could not add to media - try again')
    } finally { setBusy(assetId, false) }
  }
  async function removeImage(idx: number, assetId: string) {
    if (!assetId) return
    setBusy(assetId, true)
    try {
      await adminFetch(`/media/asset/${assetId}`, { method: 'DELETE' })
      markImgState(idx, 'removed')
      onImageRemoved?.(assetId)
    } catch {
      toast.error('Could not remove - try again')
    } finally { setBusy(assetId, false) }
  }

  function applyFill(idx: number) {
    const msg = messages[idx]
    if (!msg || msg.role !== 'assistant-fill' || msg.applied) return
    if (msg.field.fieldType === 'form') {
      onFormGenerated?.((msg.value ?? {}) as Record<string, unknown>)
      setMessages(m => m.map((x, i) => (i === idx && x.role === 'assistant-fill' ? { ...x, applied: true } : x)))
      toast.success('Form updated - review and save when ready')
      return
    }
    if (msg.panel) {
      onApplyPanel(msg.panel.extensionId, (msg.value ?? {}) as Record<string, unknown>)
    } else {
      onApplyField(msg.field.name, msg.value)
      // Applying a generated image into a field is an explicit "keep" — so it
      // survives the reaper even before the object is saved (which references it).
      const appliedImageId = msg.field.fieldType === 'media' ? (msg.value as { id?: string })?.id : undefined
      if (appliedImageId) void keepImage(idx, appliedImageId)
    }
    setMessages(m => m.map((x, i) => (i === idx && x.role === 'assistant-fill' ? { ...x, applied: true } : x)))
    toast.success(`${msg.field.label} updated in the draft`)
  }

  function fmtAt(at?: string): string {
    if (!at) return ''
    const d = new Date(at)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  /** Starts a fresh thread — the current one stays in the list. */
  function newChat() {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    sessionStorage.removeItem(pendingChatKey(workspaceId, typeName))
    setActiveChatId(newChatId())
    setMessages([])
    setThreadsOpen(false)
  }

  async function switchThread(id: string) {
    if (id === activeChatId || !objectId) return
    if (persistTimer.current) clearTimeout(persistTimer.current)
    try {
      const r = await adminFetch<{ data: { messages: unknown[] } }>(
        `/admin/ai/chats/${typeName}/${objectId}/${encodeURIComponent(id)}`)
      setActiveChatId(id)
      setMessages(deserializeChat(r.data.messages))
      setThreadsOpen(false)
    } catch {
      toast.error('Could not open that chat')
    }
  }

  async function deleteThread(id: string) {
    if (!objectId) return
    await adminFetch(`/admin/ai/chats/${typeName}/${objectId}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    setThreads(list => list.filter(t => t.id !== id))
    if (id === activeChatId) {
      if (persistTimer.current) clearTimeout(persistTimer.current)
      setActiveChatId(newChatId())
      setMessages([])
    }
  }

  const activeThreadTitle = threads.find(t => t.id === activeChatId)?.title ?? 'New chat'

  const activeProvider = providers.find(p => p.name === providerChoice)

  if (!open) return null

  if (minimized) {
    return (
      <button
        type="button"
        title="Open Gen AI"
        onClick={() => setMinimized(false)}
        className="fixed bottom-20 right-6 z-40 flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all cursor-pointer"
      >
        <IconSparkles className="w-5 h-5" />
        {messages.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-surface text-accent-fg text-[9px] font-bold flex items-center justify-center border border-accent/30">
            {messages.length}
          </span>
        )}
      </button>
    )
  }

  return (
    <aside
      className="fixed top-14 bottom-4 right-4 z-40 w-[400px] bg-surface border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      style={{ transform: `translate(${drag.x}px, ${drag.y}px)` }}
    >
      {/* Header */}
      <div className="shrink-0 border-b border-border cursor-grab active:cursor-grabbing select-none" onPointerDown={startDrag}>
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 shadow-sm">
              <IconSparkles className="w-4 h-4 text-white" />
            </span>
            <div className="leading-tight min-w-0">
              <p className="text-sm font-semibold text-fg">Gen AI</p>
              {objectId && threads.length > 0 ? (
                <button
                  type="button"
                  title="Chats on this object"
                  onClick={() => setThreadsOpen(o => !o)}
                  className="flex items-center gap-0.5 max-w-[220px] text-[10px] text-fg-subtle hover:text-accent-fg cursor-pointer"
                >
                  <span className="truncate">{activeThreadTitle}</span>
                  <IconChevronDown className={`w-3 h-3 shrink-0 transition-transform ${threadsOpen ? 'rotate-180' : ''}`} />
                </button>
              ) : (
                <p className="text-[10px] text-fg-subtle">by Tangen · history kept 30 days per object</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button type="button" title="New chat" onClick={newChat} className="p-1.5 rounded-md text-fg-subtle hover:text-accent-fg hover:bg-accent-muted cursor-pointer">
                <IconPlus className="w-3.5 h-3.5" />
              </button>
            )}
            <button type="button" title="Minimize" onClick={() => setMinimized(true)} className="p-1.5 rounded-md text-fg-subtle hover:text-fg-muted hover:bg-surface-sunken cursor-pointer">
              <span className="block w-3.5 border-t-2 border-current rounded" />
            </button>
            <button type="button" title="Close" onClick={onClose} className="p-1.5 rounded-md text-fg-subtle hover:text-fg-muted hover:bg-surface-sunken cursor-pointer">
              <IconX className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Pickers */}
        <div className="flex items-center gap-1.5 px-4 pb-2.5">
          <select
            value={providerChoice}
            onChange={(e) => { setProviderChoice(e.currentTarget.value); setModelChoice('') }}
            className="text-[11px] rounded-md border border-border bg-surface-sunken px-1.5 py-1 text-fg-muted focus:outline-none focus-visible:border-focus-border max-w-[110px]"
            title="AI provider"
          >
            {providers.filter(p => !imageMode || (p.imageModels?.length ?? 0) > 0).map(p => (
              <option key={p.name} value={p.name}>{PROVIDER_LABELS[p.name] ?? p.name}</option>
            ))}
          </select>
          <select
            value={modelChoice}
            onChange={(e) => setModelChoice(e.currentTarget.value)}
            className="text-[11px] rounded-md border border-border bg-surface-sunken px-1.5 py-1 text-fg-muted focus:outline-none focus-visible:border-focus-border flex-1 min-w-0"
            title="Model"
          >
            <option value="">Default model</option>
            {((imageMode ? activeProvider?.imageModels : activeProvider?.models) ?? []).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {profiles.length > 1 && (
            <select
              value={profileChoice}
              onChange={(e) => setProfileChoice(e.currentTarget.value)}
              className="text-[11px] rounded-md border border-accent/30 bg-accent-muted px-1.5 py-1 text-accent-fg focus:outline-none focus-visible:border-focus-border max-w-[110px]"
              title="Guideline profile"
            >
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Thread picker */}
      {threadsOpen && (
        <div className="absolute left-3 right-3 top-[52px] z-10 rounded-xl border border-border bg-surface shadow-xl overflow-hidden">
          <button
            type="button"
            onClick={newChat}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-accent-fg hover:bg-accent-muted cursor-pointer border-b border-border"
          >
            <IconPlus className="w-3.5 h-3.5" /> New chat
          </button>
          <div className="max-h-56 overflow-y-auto">
            {threads.map(thread => (
              <div
                key={thread.id}
                className={`group flex items-center gap-2 px-3 py-2 hover:bg-surface-sunken cursor-pointer ${thread.id === activeChatId ? 'bg-accent-muted/60' : ''}`}
                onClick={() => switchThread(thread.id)}
              >
                <div className="flex-1 min-w-0">
                  <p className={`text-xs truncate ${thread.id === activeChatId ? 'text-accent-fg font-medium' : 'text-fg'}`}>{thread.title}</p>
                  <p className="text-[10px] text-fg-subtle">{fmtAt(thread.updatedAt)}</p>
                </div>
                <button
                  type="button"
                  title="Delete chat"
                  onClick={(e) => { e.stopPropagation(); deleteThread(thread.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-fg-faint hover:text-danger-fg hover:bg-danger-muted cursor-pointer"
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-surface-sunken/40">
        {messages.length === 0 && historyLoaded && (
          <div className="pt-8 text-center px-4">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-100 to-violet-100 mb-3">
              <IconSparkles className="w-5 h-5 text-accent" />
            </span>
            {libraryMode ? (
              <>
                <p className="text-sm font-medium text-fg mb-1">Generate images with Gen AI</p>
                <p className="text-xs text-fg-subtle leading-relaxed">
                  Describe the image - subject, style, colors, mood. Every result is saved
                  to the library with its prompt kept for reuse.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-fg mb-1">Draft this {typeName} with Gen AI</p>
                <p className="text-xs text-fg-subtle leading-relaxed">
                  Describe what it should contain and I&apos;ll fill every field - relations map to real
                  objects. Tag a field with its ✨ to work on just that field. You review everything
                  before it touches the draft.
                </p>
              </>
            )}
          </div>
        )}

        {messages.map((msg, idx) => {
          if (msg.role === 'user') {
            return (
              <div key={idx} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-strong text-white px-3.5 py-2 text-sm whitespace-pre-wrap shadow-sm">
                  {msg.text}
                </div>
              </div>
            )
          }
          if (msg.role === 'error') {
            return (
              <Callout key={idx} variant="danger">{msg.text}</Callout>
            )
          }
          if (msg.role === 'assistant-fill') {
            return (
              <div key={idx} className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
                <div className="px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">{msg.field.label}</p>
                    {msg.at && <span className="text-[10px] text-fg-faint">{fmtAt(msg.at)}</span>}
                  </div>
                  {msg.panel ? (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {msg.panel.fields.map(f => {
                        const v = (msg.value as Record<string, unknown>)?.[f.name]
                        if (v === undefined) return null
                        return (
                          <div key={f.name} className="text-sm">
                            <span className="font-medium text-fg">{f.label}: </span>
                            <span className="text-fg whitespace-pre-wrap">{previewValue(v)}</span>
                          </div>
                        )
                      })}
                    </div>
                  ) : msg.streaming ? (
                    // Live token stream - raw text as it arrives (richtext shows
                    // its markdown here; the final message renders the real value)
                    <div className="text-sm text-fg whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {String(msg.value ?? '')}
                      <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle rounded-sm bg-accent animate-pulse" />
                    </div>
                  ) : msg.field.fieldType === 'form' ? (
                    <FormDefinitionPreview definition={msg.value as Record<string, unknown>} />
                  ) : msg.imgState === 'removed' ? (
                    // The asset is deleted — don't render a broken thumbnail.
                    <div className="text-xs text-fg-faint italic py-4 text-center">Image removed</div>
                  ) : (
                    <div className="text-sm text-fg max-h-48 overflow-y-auto">
                      <ValuePreview
                        value={msg.value}
                        fieldType={fieldByName.get(msg.field.name)?.fieldType ?? msg.field.fieldType}
                        config={fieldByName.get(msg.field.name)?.config}
                      />
                    </div>
                  )}
                </div>
                <div className="px-3 py-2 border-t border-border flex items-center justify-between">
                  {msg.usage ? (
                    <span className="text-[10px] text-fg-faint tabular-nums">↑{fmtTokens(msg.usage.inputTokens)} ↓{fmtTokens(msg.usage.outputTokens)} tokens</span>
                  ) : <span />}
                  {msg.field.name === '__library' ? (() => {
                    // Library mode (gallery / media picker): the image is an UNKEPT draft.
                    // Add to Media keeps it; Remove deletes it now; else the reaper sweeps it.
                    // The decision (msg.imgState) is persisted, so reopening the chat shows
                    // the outcome — not the buttons again.
                    const id = (msg.value as { id?: string })?.id ?? ''
                    if (msg.imgState === 'removed') return <span className="text-xs text-fg-faint">Removed</span>
                    if (msg.imgState === 'kept') return <span className="text-xs font-medium text-success-fg">Added to media ✓</span>
                    const busy = busyImages.has(id)
                    return (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => removeImage(idx, id)}
                          disabled={busy}
                          className="text-xs text-fg-muted hover:text-danger-fg disabled:opacity-50"
                        >
                          Remove
                        </button>
                        <Button size="sm" onClick={() => keepImage(idx, id)} isLoading={busy}>
                          Add to media
                        </Button>
                      </div>
                    )
                  })() : msg.streaming ? (
                    <span className="text-xs text-fg-subtle">Writing…</span>
                  ) : msg.applied ? (
                    <span className="text-xs font-medium text-success-fg">Applied ✓</span>
                  ) : (
                    <Button size="sm" onClick={() => applyFill(idx)}>
                      {msg.field.fieldType === 'form' ? 'Apply to the form' : msg.panel ? `Apply to ${msg.field.label}` : 'Apply to the field'}
                    </Button>
                  )}
                </div>
              </div>
            )
          }

          if (msg.role === 'assistant-draft') {
            // Progressive reveal while /admin/ai/generate streams - the same
            // row layout as the preview card, but accept controls are disabled
            // until the terminal done event replaces this with the real card.
            const draftEntries = Object.entries(msg.fields)
            return (
              <div key={idx} className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
                <div className="px-3 py-2 space-y-2 max-h-[45vh] overflow-y-auto">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-fg">
                      <IconSparkles className={`w-3 h-3 ${msg.streaming ? 'animate-pulse' : ''}`} />
                      {msg.stopped ? 'Stopped' : msg.phase === 'parsing' ? 'Finalizing' : 'Drafting'}
                    </span>
                    {msg.at && <span className="text-[10px] text-fg-faint">{fmtAt(msg.at)}</span>}
                  </div>
                  {msg.streaming && !draftHasContent(msg) && (
                    <div className="flex items-center gap-2 text-sm text-fg-subtle">
                      <span className="inline-block w-1.5 h-3.5 rounded-sm bg-accent animate-pulse" />
                      <span>Writing the draft…</span>
                    </div>
                  )}
                  {msg.title && (
                    <label className="flex items-start gap-2 text-sm opacity-80">
                      <input type="checkbox" disabled checked className="mt-1 rounded border-border-strong" />
                      <span><span className="font-medium text-fg">Title</span> - {msg.title}</span>
                    </label>
                  )}
                  {draftEntries.map(([name, fv]) => (
                    <label key={name} className="flex items-start gap-2 text-sm border-t border-border pt-2 opacity-80">
                      <input type="checkbox" disabled checked className="mt-1 rounded border-border-strong" />
                      <span className="min-w-0">
                        <span className="font-medium text-fg">{fieldByName.get(name)?.label ?? name}</span>
                        <span className="block text-fg max-h-32 overflow-y-auto">
                          <ValuePreview
                            value={fv.value}
                            fieldType={fieldByName.get(name)?.fieldType}
                            config={fieldByName.get(name)?.config}
                          />
                        </span>
                      </span>
                    </label>
                  ))}
                  {Object.entries(msg.images ?? {}).map(([name, offer]) => (
                    <label key={`img:${name}`} className="flex items-start gap-2 text-sm border-t border-border pt-2 opacity-80">
                      <input type="checkbox" disabled checked className="mt-1 rounded border-border-strong" />
                      <span className="min-w-0">
                        <span className="font-medium text-fg">{fieldByName.get(name)?.label ?? name}</span>
                        <span className="block text-[11px] text-fg-subtle">{offer.prompt}</span>
                        {!msg.stopped && (
                          <span className="block text-[11px] text-fg-subtle italic">Image generates after the draft completes</span>
                        )}
                      </span>
                    </label>
                  ))}
                  {msg.creates.length > 0 && (
                    <Callout variant="warning" title="New objects to be created">
                      {msg.creates.map(c => (
                        <p key={c.index} className="text-xs">
                          <span className="font-medium">{c.title}</span> ({c.type} → {c.forField})
                        </p>
                      ))}
                    </Callout>
                  )}
                </div>
                <div className="px-3 py-2 border-t border-border">
                  <span className="text-xs text-fg-subtle">
                    {msg.stopped ? 'Stopped - nothing applied' : 'You review and apply once the draft is complete'}
                  </span>
                </div>
              </div>
            )
          }

          const { preview } = msg
          const fieldEntries = Object.entries(preview.fields)
          const hasAcceptedImage = Object.values(msg.images ?? {}).some(o => o.status === 'done' && o.accepted !== false && o.value)
          return (
            <div key={idx} className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
              <div className="px-3 py-2 space-y-2 max-h-[45vh] overflow-y-auto">
                {msg.at && (
                  <p className="text-[10px] text-fg-faint text-right -mb-1">{fmtAt(msg.at)}</p>
                )}
                {preview.title && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={msg.applied}
                      checked={msg.acceptTitle}
                      onChange={() => patchMessage(idx, m => ({ ...m, acceptTitle: !m.acceptTitle }))}
                      className="mt-1 rounded border-border-strong"
                    />
                    <span><span className="font-medium text-fg">Title</span> - {preview.title}</span>
                  </label>
                )}

                {fieldEntries.map(([name, fv]) => {
                  const current = previewValue(values[name])
                  return (
                    <label key={name} className="flex items-start gap-2 text-sm border-t border-border pt-2">
                      <input
                        type="checkbox"
                        disabled={msg.applied}
                        checked={msg.acceptedFields.has(name)}
                        onChange={() => patchMessage(idx, m => {
                          const next = new Set(m.acceptedFields)
                          if (next.has(name)) next.delete(name); else next.add(name)
                          return { ...m, acceptedFields: next }
                        })}
                        className="mt-1 rounded border-border-strong"
                      />
                      <span className="min-w-0">
                        <span className="font-medium text-fg">{fieldByName.get(name)?.label ?? name}</span>
                        <span className="block text-fg max-h-32 overflow-y-auto">
                          {fv.display ?? (
                            <ValuePreview
                              value={fv.value}
                              fieldType={fieldByName.get(name)?.fieldType}
                              config={fieldByName.get(name)?.config}
                            />
                          )}
                        </span>
                        {current !== '-' && !msg.applied && (
                          <span className="block text-[11px] text-fg-subtle truncate">was: {current}</span>
                        )}
                      </span>
                    </label>
                  )
                })}

                {Object.entries(msg.images ?? {}).map(([name, offer]) => (
                  <div key={`img:${name}`} className="flex items-start gap-2 text-sm border-t border-border pt-2">
                    <input
                      type="checkbox"
                      disabled={msg.applied || offer.status !== 'done'}
                      checked={offer.status === 'done' && offer.accepted !== false}
                      onChange={() => msg.at && patchOfferAt(msg.at, name, o => ({ ...o, accepted: o.accepted === false }))}
                      className="mt-1 rounded border-border-strong"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-fg">{fieldByName.get(name)?.label ?? name}</span>
                      <span className="block text-[11px] text-fg-subtle">{offer.prompt}</span>
                      {offer.status === 'generating' && (
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-fg-subtle">
                          <IconSparkles className="w-3 h-3 animate-pulse text-accent" />
                          Generating image…
                        </span>
                      )}
                      {offer.status === 'done' && offer.value && (
                        <span className="block mt-1 max-h-48 overflow-y-auto">
                          <ValuePreview value={offer.value} fieldType="media" />
                        </span>
                      )}
                      {offer.status === 'failed' && !msg.applied && (
                        <span className="mt-1 flex items-center gap-2 text-xs">
                          <span className="text-danger-fg truncate">{offer.error ?? 'Image generation failed'}</span>
                          {/rejected|safety/i.test(offer.error ?? '') && (
                            <span className="block text-[11px] text-fg-subtle not-italic">
                              Providers refuse trademarked characters and real people - re-run the brief asking for an original scene instead.
                            </span>
                          )}
                          {msg.at && (
                            <button
                              type="button"
                              onClick={() => generateOfferImage(msg.at!, name, offer.prompt)}
                              className="shrink-0 font-medium text-accent-fg hover:underline cursor-pointer"
                            >
                              Retry
                            </button>
                          )}
                        </span>
                      )}
                      {offer.status === 'pending' && !msg.applied && (
                        imageCapable && msg.at ? (
                          <button
                            type="button"
                            onClick={() => generateOfferImage(msg.at!, name, offer.prompt)}
                            className="mt-1 text-xs font-medium text-accent-fg hover:underline cursor-pointer"
                          >
                            Generate image
                          </button>
                        ) : (
                          <span className="block mt-1 text-[11px] text-fg-subtle italic">
                            No image provider available - the prompt is saved with this card
                          </span>
                        )
                      )}
                    </span>
                  </div>
                ))}

                {preview.toCreate.length > 0 && (
                  <Callout variant="warning" title="New objects to be created">
                    {preview.toCreate.map((c, i) => (
                      <label key={i} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          disabled={msg.applied}
                          checked={msg.acceptedCreates.has(i)}
                          onChange={() => patchMessage(idx, m => {
                            const next = new Set(m.acceptedCreates)
                            if (next.has(i)) next.delete(i); else next.add(i)
                            return { ...m, acceptedCreates: next }
                          })}
                          className="rounded border-warning/40"
                        />
                        <span><span className="font-medium">{c.title}</span> ({c.type} → {c.forField})</span>
                      </label>
                    ))}
                  </Callout>
                )}

                {preview.unresolved.length > 0 && (
                  <p className="text-[11px] text-fg-subtle">
                    Couldn&apos;t resolve: {preview.unresolved.map(u => `${u.field} ("${String(u.suggestion)}")`).join(', ')}
                  </p>
                )}
              </div>

              <div className="px-3 py-2 border-t border-border flex items-center justify-between">
                {msg.usage ? (
                  <span className="text-[10px] text-fg-faint tabular-nums">↑{fmtTokens(msg.usage.inputTokens)} ↓{fmtTokens(msg.usage.outputTokens)} tokens</span>
                ) : <span />}
                {msg.applied ? (
                  <span className="text-xs font-medium text-success-fg">Applied ✓</span>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => apply(idx)}
                    disabled={applyingIdx !== null || (msg.acceptedFields.size === 0 && msg.acceptedCreates.size === 0 && !msg.acceptTitle && !hasAcceptedImage)}
                  >
                    {applyingIdx === idx ? 'Applying…' : 'Apply to draft'}
                  </Button>
                )}
              </div>
            </div>
          )
        })}

        {/* Streaming replies show real tokens - the staged status is only for atomic calls */}
        {loading && !streamingLive && <GeneratingStatus />}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 shrink-0 bg-surface">
        {tag && (
          <div className="mb-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-muted border border-accent/30 px-2.5 py-1 text-xs font-medium text-accent-fg">
              <IconSparkles className="w-3 h-3" />
              {tag.label}
              <button
                type="button"
                title="Remove field tag"
                onClick={() => setTag(null)}
                className="text-accent hover:text-accent-fg cursor-pointer"
              >
                <IconX className="w-3 h-3" />
              </button>
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            placeholder={imageMode ? (tag ? `Describe the image for ${tag.label}…` : 'Describe the image…') : tag ? `Instruction for ${tag.label}…` : messages.length === 0 ? 'Describe what to write…' : 'Refine or add more…'}
            rows={2}
            className="flex-1 resize-none border border-border rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25"
          />
          {streamingLive || imageQueueActive ? (
            // Stop aborts the live stream AND cancels queued image generations
            // (an in-flight image finishes; its thumbnail stays reviewable)
            <Button size="sm" onClick={() => { streamAbort.current?.abort(); imgQueueCancel.current = true }}>Stop</Button>
          ) : (
            <Button size="sm" onClick={send} disabled={loading || !input.trim()}>Send</Button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-fg-subtle">
          <span className="flex items-center gap-2 min-w-0">
            <span className="truncate">AI can make mistakes - review before applying. Drafts only, never publishes.</span>
            {imageCapable && !imageMode && (
              <button
                type="button"
                onClick={() => setAutoImages(v => { saveAutoImagesPref(!v); return !v })}
                title={autoImages
                  ? 'Offered images generate automatically after a brief (uses image API credits). Click to switch to manual per-image buttons.'
                  : 'Image prompts are suggested for free; images only generate when you click Generate on a card. Click to auto-generate them instead.'}
                className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium transition-colors cursor-pointer ${
                  autoImages
                    ? 'border-accent/30 bg-accent-muted text-accent-fg'
                    : 'border-border text-fg-subtle hover:border-border-strong'
                }`}
              >
                Auto images: {autoImages ? 'on' : 'off'}
              </button>
            )}
          </span>
          {(sessionUsage.input > 0 || sessionUsage.output > 0) && (
            <span className="tabular-nums shrink-0 ml-2">↑{fmtTokens(sessionUsage.input)} ↓{fmtTokens(sessionUsage.output)}</span>
          )}
        </div>
      </div>
    </aside>
  )
}

/** Compact structural summary of an AI-generated form definition. */
function FormDefinitionPreview({ definition }: { definition: Record<string, unknown> }) {
  const fields = (definition.fields ?? []) as Array<Record<string, unknown>>
  const steps = (definition.steps ?? []) as Array<Record<string, unknown>>
  const notifications = ((definition.settings as any)?.notifications ?? []) as Array<Record<string, unknown>>
  return (
    <div className="space-y-1.5 max-h-56 overflow-y-auto text-sm">
      {steps.length > 0 && (
        <p className="text-xs text-fg-muted">
          {steps.length} steps: {steps.map((s: any) => s.title || s.id).join(' → ')}
        </p>
      )}
      {fields.map((f: any) => (
        <div key={f.id} className="flex items-center gap-1.5 text-[13px]">
          <span className="text-fg-subtle text-[11px] w-20 shrink-0">{f.type}</span>
          <span className="text-fg truncate">{f.label}</span>
          {f.required && <span className="text-danger text-[11px]">required</span>}
          {f.showIf && <span className="text-warning text-[11px]">conditional</span>}
          {f.stepId && steps.length > 0 && (
            <span className="text-fg-faint text-[11px] ml-auto">{(steps.find((s: any) => s.id === f.stepId) as any)?.title ?? f.stepId}</span>
          )}
        </div>
      ))}
      {notifications.length > 0 && (
        <p className="text-xs text-fg-muted">Notifies: {notifications.map((n: any) => n.to).join(', ')}</p>
      )}
    </div>
  )
}
