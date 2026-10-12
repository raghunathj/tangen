/**
 * File Name: config-fields.tsx
 * Purpose: The form for DECLARED config fields - what a contributed flow node
 *          asks for, and what a flow preset asks for before it builds
 *          (plan-connectors B3 and D1). One component, because the same six
 *          kinds are now rendered in three places (the Flows builder, an
 *          extension's settings form, a host's "add a destination" dialog) and
 *          an operator should meet the same control each time: the connection
 *          picker that explains an unauthorized connection, the resource
 *          picker that names the field to fill first, a real date picker.
 *
 *          `json` is the one kind a caller may draw itself (`jsonEditor`): the
 *          Flows builder has a syntax-highlighted editor and should keep it,
 *          while a small dialog is better served by the plain area here.
 *
 * Author: Raghunath J
 * License: MIT
 */
import * as React from 'react'
import { Label, Textarea } from '@tangen/ui'
import { Input } from '@/components/ui/input'
import { ConnectionPicker, ResourcePicker } from '@/components/fields/connection-picker'
import { DatePicker } from '@/components/ui/date-picker'
import { TokenInput } from '@/kit/token-input'
import type { TokenOption } from '@/lib/token-suggest'

/** One declared field. The shape is the contract's, so no mapping is needed. */
export interface ConfigFieldSpec {
  key: string
  label: string
  kind?: 'text' | 'number' | 'json' | 'connection' | 'resource' | 'date'
  /** `connection` and `resource`: the provider (`google`). */
  connector?: string
  /** `connection`: what the step will do with it, so an unauthorized connection says so here. */
  capabilities?: string[]
  /** `resource`: the connector's resource type (`spreadsheet`). */
  resource?: string
  /** `resource`: the key of the `connection` field it is read through. */
  dependsOn?: string
  /** `resource`: the key of the field that supplies its parent. */
  parent?: string
}

export interface ConfigFieldsProps {
  fields: readonly ConfigFieldSpec[]
  /** The config as stored: ids for the pickers, never labels. */
  value: Record<string, unknown>
  onChange: (key: string, next: unknown) => void
  disabled?: boolean
  /**
   * What the run will resolve here (`{{trigger.…}}`). Given these, a text or
   * mapping field offers them as they are typed and carries the browse button;
   * without them it is a plain field.
   */
  tokens?: readonly TokenOption[]
  /** Draw the `json` kind yourself (the Flows builder's code editor). */
  jsonEditor?: (props: { label: string; value: unknown; onChange: (next: unknown) => void }) => React.ReactNode
}

/** A JSON value in a plain area: parsed as it is typed, and honest when it is not valid yet. */
function JsonArea({ label, value, onChange, disabled, tokens }: {
  label: string; value: unknown; onChange: (next: unknown) => void; disabled?: boolean; tokens?: readonly TokenOption[]
}) {
  const [text, setText] = React.useState(() => JSON.stringify(value ?? {}, null, 2))
  const [bad, setBad] = React.useState(false)
  const edit = (next: string) => {
    setText(next)
    try { onChange(JSON.parse(next)); setBad(false) } catch { setBad(true) }
  }
  // A mapping is the field most likely to need a token, so it gets the same
  // offers a text field does - the value it composes is still JSON.
  if (tokens && tokens.length > 0) {
    return (
      <div className="space-y-1">
        <TokenInput label={label} value={text} onChange={edit} tokens={tokens} disabled={disabled} multiline mono />
        {bad && <p className="text-ui-xs text-danger-fg">Not valid JSON yet.</p>}
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Textarea
        rows={4}
        className="font-mono text-ui-xs"
        value={text}
        disabled={disabled}
        onChange={(e) => edit(e.currentTarget.value)}
      />
      {bad && <p className="text-ui-xs text-danger-fg">Not valid JSON yet.</p>}
    </div>
  )
}

/** The declared fields, in the order they were declared. */
export function ConfigFields({ fields, value, onChange, disabled, tokens, jsonEditor }: ConfigFieldsProps) {
  return (
    <div className="space-y-3">
      {fields.map((f) => {
        const current = value[f.key]
        const asString = typeof current === 'string' ? current : null

        if (f.kind === 'json') {
          return (
            <React.Fragment key={f.key}>
              {jsonEditor
                ? jsonEditor({ label: f.label, value: current, onChange: (next) => onChange(f.key, next) })
                : <JsonArea label={f.label} value={current} disabled={disabled} tokens={tokens} onChange={(next) => onChange(f.key, next)} />}
            </React.Fragment>
          )
        }

        if (f.kind === 'connection' && f.connector) {
          return (
            <div key={f.key} className="space-y-1">
              <Label>{f.label}</Label>
              <ConnectionPicker
                provider={f.connector}
                capabilities={f.capabilities}
                value={asString}
                disabled={disabled}
                onChange={(next) => onChange(f.key, next)}
              />
            </div>
          )
        }

        if (f.kind === 'resource' && f.resource) {
          const connectionId = f.dependsOn && typeof value[f.dependsOn] === 'string' ? (value[f.dependsOn] as string) : null
          const parentId = f.parent && typeof value[f.parent] === 'string' ? (value[f.parent] as string) : null
          return (
            <div key={f.key} className="space-y-1">
              <Label>{f.label}</Label>
              <ResourcePicker
                type={f.resource}
                connectionId={connectionId}
                label={f.label}
                disabled={disabled}
                {...(f.parent ? {
                  parent: parentId,
                  // Name the field an operator has to fill first, rather than
                  // the word "parent".
                  parentLabel: fields.find((x) => x.key === f.parent)?.label.toLowerCase(),
                } : {})}
                value={asString}
                onChange={(next) => onChange(f.key, next)}
              />
            </div>
          )
        }

        if (f.kind === 'date') {
          return (
            <div key={f.key} className="space-y-1">
              <Label>{f.label}</Label>
              <DatePicker
                value={asString ?? undefined}
                disabled={disabled}
                onChange={(next) => onChange(f.key, next ?? '')}
                placeholder="Pick a date"
              />
            </div>
          )
        }

        // A text field may carry data from the run; a number cannot, so it
        // stays a number input rather than pretending to take a token.
        if (f.kind !== 'number' && tokens && tokens.length > 0) {
          return (
            <TokenInput
              key={f.key}
              label={f.label}
              value={current === undefined || current === null ? '' : String(current)}
              tokens={tokens}
              disabled={disabled}
              onChange={(next) => onChange(f.key, next)}
            />
          )
        }

        return (
          <Input
            key={f.key}
            label={f.label}
            type={f.kind === 'number' ? 'number' : 'text'}
            value={current === undefined || current === null ? '' : String(current)}
            disabled={disabled}
            onChange={(e) => onChange(f.key, f.kind === 'number' ? Number(e.currentTarget.value) : e.currentTarget.value)}
          />
        )
      })}
    </div>
  )
}

/**
 * Which declared fields have no value yet. A host uses it to keep "Add" and
 * "Save" disabled until a step could actually run - a destination created
 * without its spreadsheet would fail at the first submission instead.
 *
 * Only the kinds that identify something are required: a `json` mapping or a
 * text default may legitimately be left empty.
 */
export function missingConfigFields(fields: readonly ConfigFieldSpec[], value: Record<string, unknown>): ConfigFieldSpec[] {
  const identifying = new Set(['connection', 'resource'])
  return fields.filter((f) => identifying.has(f.kind ?? 'text')).filter((f) => {
    const v = value[f.key]
    return typeof v !== 'string' || v.trim() === ''
  })
}
