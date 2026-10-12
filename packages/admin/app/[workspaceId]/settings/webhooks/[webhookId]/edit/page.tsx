

import { useEffect, useState } from 'react'
import { Callout } from '@tangen/ui'
import { useParams, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { IconArrowLeft, IconCheck } from '@tangen/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { adminFetch } from '@/lib/api'
import { BUILT_IN_WEBHOOK_EVENTS, unknownWebhookEvents, orphanEventLabel, type WebhookTriggerCatalogEntry } from '@tangen/types'

interface TypeDef { name: string; label?: string }

// ── Checkbox row ──────────────────────────────────────────────────────────────

function CheckRow({
  checked, onChange, label, description, badge,
}: { checked: boolean; onChange: () => void; label: string; description?: string; badge?: string }) {
  return (
    <label className={clsx(
      'relative flex items-start gap-3 rounded-lg border px-3.5 py-3 cursor-pointer transition-colors select-none',
      checked
        ? 'border-accent/30 bg-accent-muted text-accent-fg'
        : 'border-border bg-surface text-fg hover:bg-surface-sunken',
    )}>
      <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
      <span className={clsx(
        'mt-0.5 size-4 shrink-0 rounded flex items-center justify-center',
        checked ? 'bg-accent-strong' : 'border border-border-strong bg-surface',
      )}>
        {checked && <IconCheck className="size-3 text-white" />}
      </span>
      <span className="min-w-0">
        <span className="text-sm font-medium">
          {label}
          {badge && (
            <span className="ml-2 align-middle rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface-sunken border border-border text-fg-muted uppercase tracking-wide">
              {badge}
            </span>
          )}
        </span>
        {description && <span className="block text-xs text-fg-subtle mt-0.5">{description}</span>}
      </span>
    </label>
  )
}

/** The badge text for a custom trigger — 'Custom' for site, the extension id otherwise. */
function triggerBadge(t: WebhookTriggerCatalogEntry): string | undefined {
  if (!t.custom) return undefined
  return t.contributor === 'site' ? 'Custom' : t.contributor
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EditWebhookPage() {
  const params = useParams<{ workspaceId: string; webhookId: string }>()
  const navigate = useNavigate()
  const { workspaceId, webhookId } = params

  const [loadError, setLoadError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [events, setEvents] = useState<string[]>(BUILT_IN_WEBHOOK_EVENTS.map((e) => e.event))
  const [triggers, setTriggers] = useState<WebhookTriggerCatalogEntry[]>([...BUILT_IN_WEBHOOK_EVENTS])
  const [scopeAll, setScopeAll] = useState(true)
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [types, setTypes] = useState<TypeDef[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const builtInTriggers = triggers.filter((t) => !t.custom)
  const customTriggers = triggers.filter((t) => t.custom)
  // Events this webhook subscribes to that are no longer registered (extension
  // removed/disabled, or a site trigger deleted) — shown so they can be cleaned up.
  const orphanEvents = unknownWebhookEvents(events, triggers)

  useEffect(() => {
    Promise.all([
      adminFetch<any>(`/webhooks/${webhookId}`),
      adminFetch<{ data: TypeDef[] }>('/types').catch(() => ({ data: [] })),
      adminFetch<{ data: WebhookTriggerCatalogEntry[] }>('/webhooks/triggers').catch(() => ({ data: [] })),
    ]).then(([hook, typesRes, triggersRes]) => {
      setLabel(hook.label ?? '')
      setUrl(hook.url ?? '')
      setEvents(Array.isArray(hook.events) ? hook.events : BUILT_IN_WEBHOOK_EVENTS.map((e) => e.event))
      const typeNames: string[] = Array.isArray(hook.typeNames) ? hook.typeNames : []
      setScopeAll(typeNames.length === 0)
      setSelectedTypes(typeNames)
      setTypes(typesRes.data)
      if (triggersRes.data?.length) setTriggers(triggersRes.data)
      setLoaded(true)
    }).catch((e: any) => {
      setLoadError(e.message ?? 'Failed to load webhook')
    })
  }, [webhookId])

  function toggleEvent(value: string) {
    setEvents((prev) => prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value])
  }

  function toggleType(name: string) {
    setSelectedTypes((prev) => prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name])
  }

  async function handleSubmit() {
    if (!label.trim()) { setError('Label is required'); return }
    if (!url.trim()) { setError('URL is required'); return }
    if (events.length === 0) { setError('Select at least one event'); return }
    if (!scopeAll && selectedTypes.length === 0) { setError('Select at least one object type'); return }

    setSaving(true); setError(null)
    try {
      await adminFetch(`/webhooks/${webhookId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          label: label.trim(),
          url: url.trim(),
          events,
          typeNames: scopeAll ? [] : selectedTypes,
          ...(secret.trim() ? { secret: secret.trim() } : {}),
        }),
      })
      navigate(`/${workspaceId}/settings/webhooks`)
    } catch (e: any) {
      setError(e.message ?? 'Failed to update webhook')
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="p-8 max-w-2xl">
        <Callout variant="danger">{loadError}</Callout>
      </div>
    )
  }

  if (!loaded) {
    return <div className="p-8 text-sm text-fg-subtle">Loading…</div>
  }

  return (
    <div className="p-8 max-w-2xl">
      <button
        onClick={() => navigate(`/${workspaceId}/settings/webhooks`)}
        className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg mb-6 transition-colors"
      >
        <IconArrowLeft className="size-4" />
        Back to Webhooks
      </button>

      <h1 className="text-lg font-semibold text-fg mb-1">Edit webhook</h1>
      <p className="text-sm text-fg-muted mb-8">
        Update the endpoint, events, or scope for this webhook. The signing secret field is empty - enter a new value only if you want to change it.
      </p>

      <div className="space-y-8">

        {/* ── Endpoint ── */}
        <section>
          <h2 className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-3">Endpoint</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-fg mb-1">
                Label <span className="text-danger-fg">*</span>
              </label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Notify Vercel on publish"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg mb-1">
                URL <span className="text-danger-fg">*</span>
              </label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                type="url"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg mb-1">
                Signing secret <span className="font-normal text-fg-subtle">(leave blank to keep existing)</span>
              </label>
              <Input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Enter new secret to replace the current one"
                type="password"
              />
            </div>
          </div>
        </section>

        {/* ── Events ── */}
        <section>
          <h2 className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-3">Events</h2>
          <div className="space-y-1.5">
            {builtInTriggers.map((ev) => (
              <CheckRow
                key={ev.event}
                checked={events.includes(ev.event)}
                onChange={() => toggleEvent(ev.event)}
                label={ev.label}
                description={ev.description}
              />
            ))}
          </div>
          {customTriggers.length > 0 && (
            <>
              <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wider mt-4 mb-3">Custom triggers</h3>
              <div className="space-y-1.5">
                {customTriggers.map((ev) => (
                  <CheckRow
                    key={ev.event}
                    checked={events.includes(ev.event)}
                    onChange={() => toggleEvent(ev.event)}
                    label={ev.label}
                    description={ev.description}
                    badge={triggerBadge(ev)}
                  />
                ))}
              </div>
            </>
          )}
          {orphanEvents.length > 0 && (
            <>
              <h3 className="text-xs font-semibold text-warning-fg uppercase tracking-wider mt-4 mb-1.5">Unavailable triggers</h3>
              <p className="text-xs text-fg-subtle mb-3">
                Still subscribed, but no longer registered - the extension was removed/disabled, or the
                trigger was deleted from code. It won't fire until it's registered again. Uncheck to unsubscribe.
              </p>
              <div className="space-y-1.5">
                {orphanEvents.map((ev) => (
                  <CheckRow
                    key={ev}
                    checked={events.includes(ev)}
                    onChange={() => toggleEvent(ev)}
                    label={orphanEventLabel(ev)}
                    description={ev}
                    badge="Unavailable"
                  />
                ))}
              </div>
            </>
          )}
          <button
            onClick={() => {
              // Select/deselect the known catalog triggers; orphaned subscriptions
              // are preserved either way (clean them up by unchecking their rows).
              const allKnownSelected = triggers.every((t) => events.includes(t.event))
              setEvents(allKnownSelected
                ? events.filter((e) => !triggers.some((t) => t.event === e))
                : [...new Set([...events, ...triggers.map((t) => t.event)])])
            }}
            className="mt-2 text-xs text-accent-fg hover:text-accent-fg font-medium transition-colors"
          >
            {triggers.every((t) => events.includes(t.event)) ? 'Deselect all' : 'Select all'}
          </button>
        </section>

        {/* ── Scope ── */}
        <section>
          <h2 className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1">Trigger for</h2>
          <p className="text-xs text-fg-subtle mb-3">
            Limit this webhook to specific object types, or fire it for everything.
          </p>

          <div className="space-y-1.5 mb-3">
            <label className={clsx(
              'flex items-center gap-3 rounded-lg border px-3.5 py-3 cursor-pointer transition-colors select-none',
              scopeAll ? 'border-accent/30 bg-accent-muted' : 'border-border bg-surface hover:bg-surface-sunken',
            )}>
              <input
                type="radio"
                className="sr-only"
                checked={scopeAll}
                onChange={() => setScopeAll(true)}
              />
              <span className={clsx(
                'size-4 shrink-0 rounded-full border-2 flex items-center justify-center',
                scopeAll ? 'border-accent' : 'border-border-strong',
              )}>
                {scopeAll && <span className="size-2 rounded-full bg-accent-strong" />}
              </span>
              <span>
                <span className="text-sm font-medium text-fg">All object types</span>
                <span className="block text-xs text-fg-subtle mt-0.5">Fire for every type in this environment</span>
              </span>
            </label>

            <label className={clsx(
              'flex items-center gap-3 rounded-lg border px-3.5 py-3 cursor-pointer transition-colors select-none',
              !scopeAll ? 'border-accent/30 bg-accent-muted' : 'border-border bg-surface hover:bg-surface-sunken',
            )}>
              <input
                type="radio"
                className="sr-only"
                checked={!scopeAll}
                onChange={() => setScopeAll(false)}
              />
              <span className={clsx(
                'size-4 shrink-0 rounded-full border-2 flex items-center justify-center',
                !scopeAll ? 'border-accent' : 'border-border-strong',
              )}>
                {!scopeAll && <span className="size-2 rounded-full bg-accent-strong" />}
              </span>
              <span>
                <span className="text-sm font-medium text-fg">Specific types only</span>
                <span className="block text-xs text-fg-subtle mt-0.5">Choose which object types trigger this webhook</span>
              </span>
            </label>
          </div>

          {!scopeAll && (
            <div className="space-y-1.5 mt-1.5">
              {types.length === 0 && (
                <p className="text-xs text-fg-subtle py-2">No object types found in this environment.</p>
              )}
              {types.map((t) => (
                <CheckRow
                  key={t.name}
                  checked={selectedTypes.includes(t.name)}
                  onChange={() => toggleType(t.name)}
                  label={t.label ?? t.name}
                />
              ))}
            </div>
          )}
        </section>

        {error && <p className="text-xs text-danger-fg">{error}</p>}

        <div className="flex items-center gap-2 pt-2">
          <Button variant="primary" size="sm" isLoading={saving} onClick={handleSubmit}>
            Save changes
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(`/${workspaceId}/settings/webhooks`)}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
