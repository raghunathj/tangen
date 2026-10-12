/**
 * File Name: identity-sheet.tsx
 * Purpose: Create or edit a service or agent identity (framework kernel K8):
 *          name, kind, description, status, its grants (the same editor an
 *          API key uses) and its capabilities (the roles catalogue). A key
 *          minted for the identity is only a credential; what is set here
 *          is what the identity may do.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription,
  Button, Input, Textarea, Select, SelectItem, Checkbox, ChoiceRow, Label, adminFetch, Text,
} from '@/kit'
import { PermissionsEditor, type TypeDef } from '@/components/api-keys/permissions-editor'
import {
  buildPermissions, permissionsToState, fetchKeyResources,
  type PermissionsFormState, type RouteResourceGroup, type FeatureResource,
} from '@/lib/api-keys'
import type { Identity, IdentityKind } from '@tangen/types'

export interface CapabilityOption { id: string; label: string; description?: string; source?: 'core' | 'extension'; extensionId?: string }

export const KIND_LABEL: Record<IdentityKind, string> = { agent: 'AI agent', service: 'Service' }

export function IdentitySheet({ open, onOpenChange, identity, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The identity being edited; null creates one. */
  identity: Identity | null
  onSaved: (saved: Identity) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<IdentityKind>('agent')
  const [description, setDescription] = useState('')
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [state, setState] = useState<PermissionsFormState>(() => permissionsToState({}))
  const [types, setTypes] = useState<TypeDef[]>([])
  const [groups, setGroups] = useState<RouteResourceGroup[]>([])
  const [features, setFeatures] = useState<FeatureResource[]>([])
  const [catalog, setCatalog] = useState<CapabilityOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(identity?.name ?? '')
    setKind(identity?.kind ?? 'agent')
    setDescription(identity?.description ?? '')
    setCapabilities(identity?.capabilities ?? [])
    setState(permissionsToState(identity?.permissions ?? {}))
    setError(null)
  }, [open, identity])

  useEffect(() => {
    if (!open) return
    adminFetch<{ data: TypeDef[] }>('/types').then((r) => setTypes(r.data)).catch(() => {})
    adminFetch<{ data: CapabilityOption[] }>('/admin/capabilities').then((r) => setCatalog(r.data ?? [])).catch(() => {})
    fetchKeyResources()
      .then(({ groups, features }) => { setGroups(groups); setFeatures(features) })
      .catch(() => {})
  }, [open])

  function toggleCapability(id: string, on: boolean) {
    setCapabilities((prev) => (on ? Array.from(new Set([...prev, id])) : prev.filter((c) => c !== id)))
  }

  async function save() {
    if (!name.trim()) { setError('A name is required'); return }
    setSaving(true); setError(null)
    try {
      const body = { name: name.trim(), kind, description: description.trim() || null, permissions: buildPermissions(state), capabilities }
      const res = identity
        ? await adminFetch<{ data: Identity }>(`/admin/identities/${identity.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await adminFetch<{ data: Identity }>('/admin/identities', { method: 'POST', body: JSON.stringify(body) })
      onSaved(res.data)
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message || 'Could not save the identity')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{identity ? `Edit ${identity.name}` : 'New identity'}</SheetTitle>
          <SheetDescription className="mt-0.5">
            An identity holds authority of its own. API keys minted for it are credentials: everything done with them is checked against, and attributed to, the identity.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="identity-name">Name</Label>
                <Input id="identity-name" value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} placeholder="e.g. Content writer agent" />
              </div>
              <div>
                <Label htmlFor="identity-kind">Kind</Label>
                <Select id="identity-kind" value={kind} onValueChange={(v) => setKind(v as IdentityKind)} disabled={!!identity}>
                  <SelectItem value="agent">{KIND_LABEL.agent}</SelectItem>
                  <SelectItem value="service">{KIND_LABEL.service}</SelectItem>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="identity-description">Description</Label>
              <Textarea id="identity-description" value={description} onChange={(e) => setDescription((e.target as HTMLTextAreaElement).value)} rows={2} placeholder="What it is for, and who to ask about it" />
            </div>

            <div>
              <Text variant="strong">Capabilities</Text>
              <Text variant="help" className="mb-2">Management rights, in the member model: what the identity may manage beyond content.</Text>
              <div className="space-y-2">
                {catalog.map((c) => (
                  <ChoiceRow
                    key={c.id}
                    htmlFor={`cap-${c.id}`}
                    control={<Checkbox id={`cap-${c.id}`} checked={capabilities.includes(c.id)} onCheckedChange={(v) => toggleCapability(c.id, v === true)} />}
                    label={c.label}
                    help={c.description ?? c.id}
                  />
                ))}
                {catalog.length === 0 && <Text variant="help">No capabilities to offer here.</Text>}
              </div>
            </div>

            <div>
              <Text variant="strong">Grants</Text>
              <Text variant="help" className="mb-2">Content, media and route access, in the key model: what a credential of this identity can reach.</Text>
              <PermissionsEditor state={state} onChange={setState} types={types} features={features} groups={groups} />
            </div>

            {error && <p className="text-xs text-danger-fg">{error}</p>}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving' : identity ? 'Save changes' : 'Create identity'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
