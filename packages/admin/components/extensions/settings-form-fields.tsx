/**
 * File Name: settings-form-fields.tsx
 * Purpose: The generated settings form's controls (Extension Kernel K7.2):
 *          one control per descriptor kind from a typed manifest `settings`
 *          definition, drawn from the descriptors the API answers, never
 *          from extension code. A secret is a password field that never
 *          shows its value (the API answers `{ set }`); a connection is a
 *          picker over the workspace's connections of that connector. Pure
 *          over its props, so it renders on the server in a test.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Checkbox, Select, SelectItem, MultiSelect } from '@tangen/ui'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useContentTypes, type ContentTypeItem } from '@/lib/use-content-types'
import { ConnectionPicker, ResourcePicker } from '@/components/fields/connection-picker'
import { DatePicker } from '@/components/ui/date-picker'

export interface SettingsFieldDescriptor {
  key: string
  kind: 'boolean' | 'number' | 'string' | 'select' | 'secret' | 'connection' | 'resource' | 'date' | 'list'
  label?: string
  description?: string
  optional?: boolean
  default?: unknown
  min?: number
  max?: number
  integer?: boolean
  minLength?: number
  maxLength?: number
  pattern?: string
  options?: string[]
  /** A list whose options are the workspace's content types (E.7). */
  optionsFrom?: 'content-types'
  /** A grant the installation must hold for the field to take effect (E.15). */
  requires?: string
  /** Served to websites through the SDK (E.18). */
  public?: boolean
  connector?: string
  /** Connectors B3: capabilities a connection field needs, and what a resource field reads. */
  capabilities?: string[]
  resource?: string
  dependsOn?: string
  parent?: string
}

export interface ConnectionOption { id: string; connectorId: string; label: string }

/** `scoreThreshold` → `Score threshold` when the descriptor carries no label. */
export function fieldLabel(field: Pick<SettingsFieldDescriptor, 'key' | 'label'>): string {
  if (field.label) return field.label
  return field.key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())
}

const isSet = (v: unknown) => Boolean(v && typeof v === 'object' && (v as { set?: boolean }).set)

/** The choices a select or connection field offers; a connection field lists the workspace's connections of its connector. */
export function selectOptions(field: SettingsFieldDescriptor, connections: ConnectionOption[] = [], contentTypes: Pick<ContentTypeItem, 'name' | 'label'>[] = []): Array<{ value: string; label: string }> {
  if (field.kind === 'list' && field.optionsFrom === 'content-types') return contentTypes.map((t) => ({ value: t.name, label: t.label }))
  if (field.kind === 'select' || field.kind === 'list') return (field.options ?? []).map((o) => ({ value: o, label: o }))
  if (field.kind === 'connection') return connections.filter((c) => !field.connector || c.connectorId === field.connector).map((c) => ({ value: c.id, label: c.label }))
  return []
}

/** The extension id the API's unavailable-message names (`tangen extension upgrade <id> ...`). */
function extensionIdOf(message: string): string {
  const m = /tangen extension upgrade (\S+)/.exec(message)
  return m?.[1] ?? '<extension>'
}

export function SettingsFormFields({ fields, values, onChange, connections = [], fieldErrors = {}, disabled, unavailable = {} }: {
  fields: SettingsFieldDescriptor[]
  /** The API's redacted values: a secret is `{ set }`; a draft secret the member typed is a string. */
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  connections?: ConnectionOption[]
  fieldErrors?: Record<string, string>
  disabled?: boolean
  /** Fields unavailable because a grant they require is not held: the API's `unavailable` (E.15). */
  unavailable?: Record<string, { grant: string; message: string }>
}) {
  // E.7: a list whose options are the workspace's content types reads them here, once per form.
  const contentTypes = useContentTypes()
  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const id = `ext-setting-${f.key}`
        const v = values[f.key]
        const error = fieldErrors[f.key]
        const label = fieldLabel(f)
        const gated = Boolean(unavailable[f.key])
        const control = (() => {
          switch (f.kind) {
            case 'boolean':
              return (
                <label className="inline-flex items-center gap-2 text-sm text-fg" htmlFor={id}>
                  <Checkbox id={id} checked={Boolean(v)} disabled={disabled || gated} onCheckedChange={(checked) => onChange(f.key, checked === true)} />
                  <span>{label}</span>
                </label>
              )
            case 'number':
              return <Input id={id} type="number" value={typeof v === 'number' ? String(v) : ''} min={f.min} max={f.max} step={f.integer ? 1 : 'any'} disabled={disabled || gated} onChange={(e) => onChange(f.key, e.target.value === '' ? null : Number(e.target.value))} />
            case 'string':
              return <Input id={id} type="text" value={typeof v === 'string' ? v : ''} maxLength={f.maxLength} minLength={f.minLength} pattern={f.pattern} disabled={disabled || gated} onChange={(e) => onChange(f.key, e.target.value === '' ? null : e.target.value)} />
            case 'date':
              // `settings.date()` validates 'YYYY-MM-DD' (extension-settings.ts)
              // - exactly DatePicker's own value shape, so no conversion here.
              // DatePicker takes no `id` prop (it renders a button, not an
              // input), so the label above is unassociated for this one kind.
              return <DatePicker value={typeof v === 'string' ? v : undefined} size="md" disabled={disabled || gated} onChange={(next) => onChange(f.key, next ?? null)} />
            case 'select':
              return (
                <Select id={id} value={typeof v === 'string' ? v : undefined} disabled={disabled || gated} placeholder={f.optional ? 'Not set' : 'Choose'} onValueChange={(value) => onChange(f.key, value)}>
                  {selectOptions(f).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </Select>
              )
            case 'connection': {
              // B3: the kit picker, so this form, a Flows node and anything a
              // site developer builds show the same control and the same
              // reason when an integration is unavailable. `connections` is
              // still honoured as a fallback for a host that passes them.
              if (f.connector && connections.length === 0) {
                return (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <ConnectionPicker id={id} provider={f.connector} value={typeof v === 'string' ? v : null} capabilities={f.capabilities} disabled={disabled || gated} onChange={(next) => onChange(f.key, next)} />
                    </div>
                  </div>
                )
              }
              const options = selectOptions(f, connections)
              return (
                <div className="flex items-center gap-2">
                  <Select id={id} value={typeof v === 'string' ? v : undefined} disabled={disabled || options.length === 0} placeholder={options.length ? 'Choose a connection' : 'No connection configured yet'} onValueChange={(value) => onChange(f.key, value)} onClear={() => onChange(f.key, null)}>
                    {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </Select>
                </div>
              )
            }
            case 'resource': {
              /**
               * B3's third surface, which was never wired: `ResourcePicker`
               * was imported here and never used, so a `settings.resource()`
               * field rendered as a TEXT BOX and an operator typed a
               * provider's id by hand (found declaring SEO's Search Console
               * property, 2026-09-20).
               *
               * The connection it is read through, and the parent it hangs
               * off, are sibling FIELDS - named by `dependsOn` and `parent` -
               * so choosing a connection above changes what this lists.
               */
              const connectionId = f.dependsOn && typeof values[f.dependsOn] === 'string' ? (values[f.dependsOn] as string) : null
              const parentId = f.parent && typeof values[f.parent] === 'string' ? (values[f.parent] as string) : null
              if (!f.resource) return <Input id={id} value={typeof v === 'string' ? v : ''} disabled onChange={() => {}} />
              return (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <ResourcePicker
                      id={id}
                      type={f.resource}
                      connectionId={connectionId}
                      label={label}
                      disabled={disabled || gated}
                      {...(f.parent ? {
                        parent: parentId,
                        // Name the field an operator has to fill first, not
                        // the word "parent".
                        parentLabel: fields.find((x) => x.key === f.parent)?.label?.toLowerCase(),
                      } : {})}
                      value={typeof v === 'string' ? v : null}
                      onChange={(next) => onChange(f.key, next)}
                    />
                  </div>
                </div>
              )
            }
            case 'list':
              return (
                <MultiSelect id={id} options={selectOptions(f, connections, contentTypes)} value={Array.isArray(v) ? (v as string[]) : []} disabled={disabled || gated} placeholder="Pick" onChange={(next) => onChange(f.key, next)} />
              )
            case 'secret':
              return (
                <div className="flex items-center gap-2">
                  <Input id={id} type="password" autoComplete="new-password" placeholder={isSet(v) ? 'Set (enter a new value to replace)' : 'Not set'} value={typeof v === 'string' ? v : ''} disabled={disabled || gated} onChange={(e) => onChange(f.key, e.target.value === '' ? undefined : e.target.value)} />
                </div>
              )
          }
        })()
        return (
          <div key={f.key}>
            {f.kind !== 'boolean' && <label className="mb-1 block text-xs font-medium text-fg" htmlFor={id}>{label}{f.optional ? '' : ' *'}{f.public && <span className="ml-2 rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[10px] font-normal text-fg-subtle">Visible to websites</span>}</label>}
            {control}
            {f.description && <p className="mt-1 text-xs text-fg-subtle">{f.description}</p>}
            {gated && (
              <p className="mt-1 text-xs text-warning-fg" data-unavailable={f.key}>
                Unavailable: this setting needs the {unavailable[f.key]!.grant} permission, which this installation was not granted. A developer can approve it with <code className="font-mono">tangen extension upgrade {extensionIdOf(unavailable[f.key]!.message)} --approve-optional {unavailable[f.key]!.grant}</code>.
              </p>
            )}
            {error && <p className="mt-1 text-xs text-danger-fg">{error}</p>}
          </div>
        )
      })}
    </div>
  )
}
