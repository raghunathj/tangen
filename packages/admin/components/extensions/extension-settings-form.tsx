/**
 * File Name: extension-settings-form.tsx
 * Purpose: The generated settings section for an extension with typed
 *          manifest settings (Extension Kernel K7.1 + K7.2). Reads
 *          `GET /admin/ext/<id>/settings` (redacted values, descriptors,
 *          version) and the workspace's connections for the pickers, keeps
 *          a draft of what the member changed, and saves the draft as a
 *          patch with `POST` - so an untouched secret is kept, a cleared
 *          one is sent as null. Field errors from the API land under their
 *          controls. Core contributes this to the settings-sections slot.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useState } from 'react'
import { Callout, toast } from '@tangen/ui'
import { Button } from '@/components/ui/button'
import { SettingsSection } from '@/components/settings/settings-section'
import { adminFetch, ApiError } from '@/lib/api'
import { usePageHeaderActions } from '@/lib/page-header'
import { SettingsFormFields, type SettingsFieldDescriptor } from './settings-form-fields'

interface SettingsRead { values: Record<string, unknown>; fields: SettingsFieldDescriptor[]; version: number; unavailable?: Record<string, { grant: string; message: string }> }

/** The member route core serves the generated settings from (server-routes dispatch, K7.1) - the ADMIN mount, never the public one. */
export const extensionSettingsPath = (extensionId: string) => `/admin/ext/${extensionId}/settings`

/**
 * The generated settings form. `actions: 'section'` (the extension overview
 * page) draws Save in the section header; `actions: 'header'` (Settings →
 * Extensions → <id>, E.17) puts Save in the page header like every other
 * settings page and draws the fields as a plain section.
 */
export function ExtensionSettingsForm({ extensionId, title, description, actions = 'section' }: { extensionId: string; title?: string; description?: string; actions?: 'section' | 'header' }) {
  const [read, setRead] = useState<SettingsRead | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await adminFetch<SettingsRead>(extensionSettingsPath(extensionId))
      setRead(r); setDraft({})
      // The connection list used to be fetched here, from a path that does not
      // exist (`/workspaces/:id/connections`, missing the `/admin` segment) -
      // swallowed by a catch, so every connection picker in an extension's
      // settings had silently shown "No connection configured yet" since it
      // shipped. B3's ConnectionPicker owns that read now: the right route,
      // the picker permission, and the platform's own state derivation.
    } catch (e) {
      setError((e as Error).message)
    }
  }, [extensionId])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!read) return
    setSaving(true); setFieldErrors({}); setError(null)
    try {
      const r = await adminFetch<SettingsRead>(extensionSettingsPath(extensionId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
      setRead(r); setDraft({})
      toast.success('Settings saved')
    } catch (e) {
      const fe = e instanceof ApiError ? (e as ApiError & { fieldErrors?: Record<string, string> }).fieldErrors : undefined
      if (fe) setFieldErrors(fe)
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const dirty = Object.keys(draft).length > 0
  const saveButton = <Button size={actions === 'header' ? 'sm' : 'xs'} disabled={!read || !dirty} isLoading={saving} onClick={() => { void save() }}>Save</Button>
  // Header mode: the page header carries Save (the standard for a settings page); the hook must run on every render.
  usePageHeaderActions(actions === 'header' ? saveButton : null, [actions, read, dirty, saving])
  if (!read) return error ? <Callout variant="danger" title="Could not load settings">{error}</Callout> : null
  if (actions === 'header') {
    return (
      <div className="space-y-4">
        {error && <Callout variant="danger">{error}</Callout>}
        <SettingsSection plain title={title ?? 'Settings'} description={description}>
          <SettingsFormFields
            fields={read.fields}
            values={{ ...read.values, ...draft }}
            unavailable={read.unavailable ?? {}}
            fieldErrors={fieldErrors}
            disabled={saving}
            onChange={(key, value) => setDraft((d) => {
              const next = { ...d }
              if (value === undefined) delete next[key]; else next[key] = value
              return next
            })}
          />
        </SettingsSection>
      </div>
    )
  }
  return (
    <SettingsSection
      title={title ?? 'Settings'}
      description={description}
      actions={saveButton}
    >
      {error && <div className="mb-4"><Callout variant="danger">{error}</Callout></div>}
      <SettingsFormFields
        fields={read.fields}
        values={{ ...read.values, ...draft }}
        unavailable={read.unavailable ?? {}}
        fieldErrors={fieldErrors}
        disabled={saving}
        onChange={(key, value) => setDraft((d) => {
          const next = { ...d }
          if (value === undefined) delete next[key]; else next[key] = value
          return next
        })}
      />
    </SettingsSection>
  )
}
