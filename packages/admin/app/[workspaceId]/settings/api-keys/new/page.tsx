

import { useEffect, useState } from 'react'
import { Callout } from '@tangen/ui'
import { usePageHeader } from '@/lib/page-header'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { IconCheck, IconCopy, IconKey } from '@tangen/icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SettingsSection } from '@/components/settings/settings-section'
import { Input } from '@/components/ui/input'
import { adminFetch } from '@/lib/api'
import { useAuthStore } from '@/lib/auth'
import {
  buildPermissions, fetchKeyResources, PERMISSION_RESOURCES,
  type PermissionsFormState } from '@/lib/api-keys'
import type { RouteResourceGroup, FeatureResource } from '@tangen/types'
import { PermissionsEditor, isFullAccessState, type TypeDef } from '@/components/api-keys/permissions-editor'
import { DatePicker } from '@/components/ui/date-picker'

const EMPTY_STATE: PermissionsFormState = {
  globalActions: {}, typeOverrides: [], extensionOverrides: {}, customRoutes: {}, resourceOverrides: {},
}

// ── Presets — pre-fill only, everything stays editable ───────────────────────

interface Preset {
  id: string
  label: string
  description: string
  build: (groups: RouteResourceGroup[], features: FeatureResource[]) => PermissionsFormState
}

const PRESETS: Preset[] = [
  {
    id: 'read-only',
    label: 'Read-only content',
    description: 'Published objects, media, search, and globals',
    build: () => ({
      ...EMPTY_STATE,
      globalActions: { objects: ['read'], media: ['read'], search: ['read'], globals: ['read'] },
    }),
  },
  {
    id: 'forms',
    label: 'Forms submissions',
    description: 'Read form schemas and submit entries',
    build: () => ({
      ...EMPTY_STATE,
      globalActions: { forms: ['read', 'submit'] },
    }),
  },
  {
    id: 'full',
    label: 'Full access',
    description: 'Every action on every resource',
    build: (groups, features) => ({
      ...EMPTY_STATE,
      globalActions: Object.fromEntries([
        // Toolbar stays an explicit opt-in - Full Access does not include it.
        ...PERMISSION_RESOURCES.filter((r) => r.id !== 'toolbar').map((r) => [r.id, [...r.actions]] as const),
        // An extension's scope (Forms, say) rides globalActions under its id.
        ...features.filter((f) => f.extensionId).map((f) => [f.id, [...f.actions]] as const),
      ]),
      customRoutes: Object.fromEntries(
        [...features.filter((f) => !f.extensionId), ...groups].map((g) => [g.id, [...g.actions]]),
      ),
    }),
  },
]

// ── Raw key reveal ────────────────────────────────────────────────────────────

function RawKeyReveal({ rawKey, onDone }: { rawKey: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(rawKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // The section card (2026-09-08): what happened above, the key and its one
  // action in the header row, the caveat under the key, the way out below.
  return (
    <div className="space-y-3">
      <SettingsSection
        title="API key created"
        description="Copy this key now - it will not be shown again."
        summary={(
          <>
            <div className="flex min-w-0 items-center gap-2.5">
              <IconKey className="size-4 text-success-fg" aria-hidden />
              <span className="text-sm font-medium text-fg">Your new key</span>
              <Badge variant="success">Shown once</Badge>
            </div>
            <Button size="sm" variant="secondary" onClick={copy}>
              {copied ? <IconCheck className="size-3.5 mr-1.5 text-success-fg" /> : <IconCopy className="size-3.5 mr-1.5" />}
              {copied ? 'Copied' : 'Copy key'}
            </Button>
          </>
        )}
      >
        <code className="block w-full rounded-lg border border-border bg-surface-sunken px-3 py-2.5 font-mono text-xs text-fg break-all whitespace-pre-wrap" data-testid="raw-api-key">{rawKey}</code>
        <p className="mt-2 text-xs text-warning-fg">Store this key securely. It cannot be recovered.</p>
      </SettingsSection>
      <Button variant="secondary" size="sm" onClick={onDone}>Done - go to key list</Button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewApiKeyPage() {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  // K8: a key minted for an identity is its credential and carries no grants of its own.
  const [search] = useSearchParams()
  const identityId = search.get('identity')
  const identityName = search.get('name')

  const [label, setLabel] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [state, setState] = useState<PermissionsFormState>(EMPTY_STATE)
  const [preset, setPreset] = useState<string | null>(null)
  const [types, setTypes] = useState<TypeDef[]>([])
  const [groups, setGroups] = useState<RouteResourceGroup[]>([])
  const [features, setFeatures] = useState<FeatureResource[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawKey, setRawKey] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    adminFetch<{ data: TypeDef[] }>('/types')
      .then((r) => setTypes(r.data))
      .catch(() => {/* non-critical */})
    fetchKeyResources()
      .then(({ groups, features }) => { setGroups(groups); setFeatures(features) })
      .catch(() => {/* non-critical */})
  }, [accessToken])

  function applyPreset(p: Preset) {
    setPreset(p.id)
    setState(p.build(groups, features))
  }

  async function handleSubmit() {
    if (!label.trim()) { setError('Label is required'); return }
    setSaving(true); setError(null)
    try {
      const res = await adminFetch<{ key: string }>(
        '/api-keys',
        {
          method: 'POST',
          body: JSON.stringify({
            label: label.trim(),
            ...(identityId ? { identityId } : { permissions: buildPermissions(state) }),
            ...(expiresAt ? { expiresAt } : {}),
          }),
        },
      )
      setRawKey(res.key)
    } catch (e: any) {
      setError(e.message ?? 'Failed to create key')
    } finally {
      setSaving(false)
    }
  }

  // The header owns the crumbs (Settings / API Manager / New key) and the
  // Create key action (2026-09-08) - no back link, no second title.
  usePageHeader({
    icon: <IconKey />,
    breadcrumbs: [
      { label: 'Settings', href: `/${params.workspaceId}/settings` },
      { label: 'API Manager', href: `/${params.workspaceId}/settings/api-keys` },
      { label: rawKey ? 'Key created' : 'New key' },
    ],
    description: 'The key is shown once - copy it before closing.',
    actions: rawKey ? undefined : (
      <Button variant="primary" size="sm" isLoading={saving} onClick={handleSubmit}>Create key</Button>
    ),
  }, [params.workspaceId, rawKey, saving, label, expiresAt, state, preset, identityId])

  return (
    <div>
      {rawKey ? (
        <RawKeyReveal
          rawKey={rawKey}
          onDone={() => navigate(`/${params.workspaceId}/settings/api-keys`)}
        />
      ) : (
        <div className="space-y-6">
          {/* Label + expiry */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-fg mb-1">
                Label <span className="text-danger-fg">*</span>
              </label>
              <Input
                value={label}
                onChange={(e) => setLabel((e.target as HTMLInputElement).value)}
                placeholder="e.g. Production deploy key"
                inputClassName="h-9 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg mb-1">Expires (optional)</label>
              <DatePicker
                size="md"
                value={expiresAt || undefined}
                onChange={(v) => setExpiresAt(v ?? '')}
                placeholder="Never expires"
                minDate={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
              />
            </div>
          </div>

          {identityId ? (
            <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3">
              <p className="text-sm font-medium text-fg">A credential of {identityName ?? identityId}</p>
              <p className="text-xs text-fg-muted mt-0.5">This key carries no grants of its own: whatever is done with it is checked against, and attributed to, that identity. Edit the identity to change what it may do.</p>
            </div>
          ) : (<>
          {/* Presets */}
          <div>
            <p className="text-xs font-medium text-fg mb-2">Start from a preset</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={clsx(
                    'rounded-xl border p-3 text-left transition-colors cursor-pointer',
                    preset === p.id
                      ? 'border-accent bg-accent-muted ring-1 ring-focus/25'
                      : 'border-border bg-surface hover:border-border-strong',
                  )}
                >
                  <p className={clsx('text-sm font-medium', preset === p.id ? 'text-accent-fg' : 'text-fg')}>
                    {p.label}
                  </p>
                  <p className="text-xs text-fg-subtle mt-0.5">{p.description}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-fg-subtle mt-1.5">Presets only pre-fill the checkboxes - adjust anything below.</p>
          </div>

          {/* Permissions */}
          <div>
            <p className="text-xs font-medium text-fg mb-3">Permissions</p>
            <PermissionsEditor
              state={state}
              onChange={(next) => { setState(next); setPreset(null) }}
              types={types}
              features={features}
              groups={groups}
            />
          </div>

          </>)}

          {error && <p className="text-xs text-danger-fg">{error}</p>}

          {!identityId && isFullAccessState(state, features, groups) && (
            <Callout variant="warning" title="This key grants every permission">
                <p>
                Anyone holding it can read, write, publish, and delete everything in this
                environment. Share it only with fully trusted systems - prefer a narrower
                key wherever possible.
              </p>
            </Callout>
          )}

        </div>
      )}
    </div>
  )
}
