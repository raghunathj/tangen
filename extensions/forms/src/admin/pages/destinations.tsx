/**
 * File Name: destinations.tsx
 * Purpose: A form's Destinations (tasks/plan-connectors.md D2): where its
 *          submissions go besides the inbox - a Google Sheet today, whatever a
 *          connector pack offers tomorrow.
 *
 *          Forms adds no executor for this. Each destination IS a flow, built
 *          by a preset (D1) and owned by Flows: the run history, the retries,
 *          the failures and the logs stay in the one place an operator already
 *          looks for them, and opening a destination opens the flow builder.
 *          Nothing here mentions Google, and Forms stores nothing about a
 *          destination - deleting the flow removes it.
 *
 *          Decision Q4: when Flows is absent the tab STAYS and explains
 *          itself. A hidden tab teaches an operator nothing, and Forms must
 *          never grow a fallback executor to cover the gap (invariants 14
 *          and 15).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconPlus, IconTrash, IconGitBranch } from '@tangen/icons'
import {
  Badge, Button, Callout, ConfigFields, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
  DynamicIcon, EmptyState, FormSection, Panel, PanelRow, Text, adminFetch, formFieldTokens, missingConfigFields, toast, useCan, useConfirm,
  type ConfigFieldSpec, type TokenOption,
} from '@/kit'

import { destinationsUnavailable, UNAVAILABLE_COPY, type DestinationsUnavailable } from '../destinations-state'

const FLOWS = '/admin/ext/flows'

/** A preset as the Flows route hands it over: everything but `build`. */
interface Preset {
  id: string
  label: string
  description?: string
  icon?: string
  /** The provider's own mark, inline, as its connector declares it. */
  brand?: { icon?: string; color?: string }
  contributor: string
  configFields?: ConfigFieldSpec[]
}

/**
 * The provider's mark where there is one, its glyph where there is not - so a
 * destination reads as Google or Slack rather than as a grey square (the user,
 * 2026-09-19). An `<img>`, because a browser runs no script in one.
 */
function PresetMark({ preset, size = 16 }: { preset?: Preset; size?: number }) {
  if (preset?.brand?.icon) {
    return <img src={preset.brand.icon} alt="" width={size} height={size} className="shrink-0 rounded-[3px]" />
  }
  return <DynamicIcon name={preset?.icon ?? 'IconGitBranch'} className="shrink-0" style={{ width: size, height: size }} />
}

/** A flow a preset built for this form. */
interface DestinationFlow {
  id: string
  name: string
  enabled: boolean
  runnable?: boolean
  broken?: string | null
  source?: { extensionId: string; presetId: string; scope: string }
  lastRun?: { status?: string; startedAt?: string } | null
}

// Why the tab may have nothing to offer lives next door, pure and typed
// (destinations-state.ts), so the rule can be stated and tested.

const RUN_TONE: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  completed: 'success', error: 'error', waiting: 'warning', waiting_retry: 'warning',
}

function when(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

export function DestinationsSectionPage({ formId, workspaceId, formName, fields }: {
  formId: string
  workspaceId: string
  formName: string
  /** This form's own fields: what a destination's mapping may reference. */
  fields: ReadonlyArray<{ name: string; label?: string }>
}) {
  const { hasCapability } = useCan()
  const { confirm, confirmDialog } = useConfirm()
  const navigate = useNavigate()
  const canManage = hasCapability('manage:flows' as never)
  const scope = `form:${formId}`

  const [presets, setPresets] = useState<Preset[] | null>(null)
  const [flows, setFlows] = useState<DestinationFlow[] | null>(null)
  const [unavailable, setUnavailable] = useState<DestinationsUnavailable | null>(null)
  const [adding, setAdding] = useState<Preset | null>(null)

  /**
   * What a mapping may reference. The form's own fields come first, because
   * that is what an operator is here to send; the trigger's identifiers follow.
   * The paths are the ones Forms hydrates onto the trigger, so what is offered
   * is what a run resolves.
   */
  const tokens = useMemo<TokenOption[]>(() => [
    ...formFieldTokens(fields),
    { token: '{{trigger.payload.formId}}', label: 'Form id', group: 'This submission' },
    { token: '{{trigger.submission.id}}', label: 'Submission id', group: 'This submission' },
    { token: '{{trigger.submission.createdAt}}', label: 'Submitted at', group: 'This submission' },
  ], [fields])

  const load = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([
        adminFetch<{ data: Preset[] }>(`${FLOWS}/presets?trigger=form.submitted&scope=form`),
        adminFetch<{ data: DestinationFlow[] }>(`${FLOWS}/flows?scope=${encodeURIComponent(scope)}`),
      ])
      setPresets(p.data ?? [])
      setFlows(f.data ?? [])
      setUnavailable(null)
    } catch (e) {
      // 404 covers every way Flows can be missing here (absent, uninstalled,
      // disabled, routes not mounted - core makes them indistinguishable on
      // purpose); 403 is a member who may not read flows; anything else is
      // not diagnosed, only reported.
      setUnavailable(destinationsUnavailable(e))
      setPresets([])
      setFlows([])
    }
  }, [scope])

  useEffect(() => { void load() }, [load])

  const remove = async (flow: DestinationFlow) => {
    const ok = await confirm({
      title: 'Remove this destination?',
      message: `The flow "${flow.name}" is deleted, so new submissions stop going there. Its run history is kept.`,
      confirmLabel: 'Remove',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await adminFetch(`${FLOWS}/flows/${flow.id}`, { method: 'DELETE' })
      toast.success('Destination removed')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const loading = presets === null || flows === null

  return (
    <FormSection
      title="Destinations"
      description="Where this form's submissions go besides the inbox. Each destination is a flow, so every run, retry and failure is recorded in Flows."
    >
      {unavailable && (() => {
        const copy = UNAVAILABLE_COPY[unavailable]
        return (
          <EmptyState
            align="start"
            icon={<IconGitBranch />}
            title={copy.title}
            description={copy.description}
            action={
              copy.action === 'extensions'
                ? <Button size="xs" variant="secondary" onClick={() => window.location.assign(`/${workspaceId}/settings/extensions`)}>Extensions</Button>
                : copy.action === 'retry'
                  ? <Button size="xs" variant="secondary" onClick={() => void load()}>Try again</Button>
                  : undefined
            }
          />
        )
      })()}

      {!unavailable && !loading && flows!.length === 0 && presets!.length === 0 && (
        <EmptyState
          align="start"
          icon={<IconGitBranch />}
          title="No destinations are available yet"
          description="A connector pack offers these. Installing one - Google, for instance - adds its destinations here without any change to this form."
          action={<Button size="xs" variant="secondary" onClick={() => window.location.assign(`/${workspaceId}/settings/connections`)}>Connections</Button>}
        />
      )}

      {!unavailable && !loading && flows!.length > 0 && (
        <Panel rows>
          {flows!.map((flow) => (
            <PanelRow
              key={flow.id}
              icon={<PresetMark preset={presets!.find((p) => p.id === flow.source?.presetId)} size={18} />}
              label={flow.name}
              description={
                flow.broken
                  ? flow.broken
                  : flow.lastRun?.status
                    ? `Last run ${flow.lastRun.status} ${when(flow.lastRun.startedAt)}`.trim()
                    : 'No runs yet'
              }
              action={
                <div className="flex items-center gap-2">
                  {flow.broken
                    ? <Badge variant="error">Broken</Badge>
                    : flow.lastRun?.status
                      ? <Badge variant={RUN_TONE[flow.lastRun.status] ?? 'neutral'}>{flow.lastRun.status}</Badge>
                      : <Badge variant="neutral">{flow.enabled ? 'On' : 'Off'}</Badge>}
                  <Button
                    size="xs" variant="secondary" className="gap-1"
                    title="Open this destination in Flows"
                    onClick={() => navigate(`/${workspaceId}/extensions/flows/${flow.id}`)}
                  >
                    <IconGitBranch className="size-3.5" /> Open in Flows
                  </Button>
                  {canManage && (
                    <Button size="xs" variant="ghost" aria-label={`Remove ${flow.name}`} onClick={() => void remove(flow)}>
                      <IconTrash className="size-3.5" />
                    </Button>
                  )}
                </div>
              }
            />
          ))}
        </Panel>
      )}

      {!unavailable && !loading && presets!.length > 0 && (
        <div className="space-y-2">
          <Text variant="help">Add a destination</Text>
          {/* One per row, full width: these are choices with sentences on them,
              not a toolbar, and they read as a list of what is possible (the
              user, 2026-09-19). */}
          <div className="flex flex-col gap-2">
            {presets!.map((preset) => (
              <Button
                key={preset.id} size="sm" variant="secondary" disabled={!canManage}
                className="w-full justify-start gap-2"
                onClick={() => setAdding(preset)}
              >
                <PresetMark preset={preset} size={18} />
                <span className="min-w-0 flex-1 truncate text-left">{preset.label}</span>
                <IconPlus className="size-3.5 shrink-0 opacity-60" />
              </Button>
            ))}
          </div>
          {!canManage && <Text variant="help">Adding one creates a flow, which needs the Flows permission.</Text>}
        </div>
      )}

      {confirmDialog}
      {adding && (
        <AddDestinationDialog
          preset={adding}
          formName={formName}
          tokens={tokens}
          scope={{ kind: 'form', id: formId }}
          onClose={() => setAdding(null)}
          onAdded={async () => { setAdding(null); await load() }}
        />
      )}
    </FormSection>
  )
}

/** The operator's answers to a preset's declared fields, then one create call. */
function AddDestinationDialog({ preset, formName, tokens, scope, onClose, onAdded }: {
  preset: Preset
  formName: string
  tokens: readonly TokenOption[]
  scope: { kind: string; id: string }
  onClose: () => void
  onAdded: () => void | Promise<void>
}) {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fields = useMemo(() => preset.configFields ?? [], [preset])
  const missing = missingConfigFields(fields, config)

  const add = async () => {
    setSaving(true)
    setError(null)
    try {
      await adminFetch(`${FLOWS}/flows`, {
        method: 'POST',
        body: JSON.stringify({
          // The preset builds the graph; Flows owns it from here.
          preset: { id: preset.id, scope, config },
          // A destination an operator just added should be live, and the
          // create route refuses to enable one this environment cannot run.
          enabled: true,
          name: `${preset.label}: ${formName}`.slice(0, 120),
        }),
      })
      toast.success('Destination added')
      await onAdded()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <PresetMark preset={preset} size={18} />
              {preset.label}
            </span>
          </DialogTitle>
          {preset.description && <DialogDescription>{preset.description}</DialogDescription>}
        </DialogHeader>
        {error && <Callout variant="danger" compact title="Could not add this destination">{error}</Callout>}
        {fields.length === 0
          ? <Text variant="help">This destination needs no configuration.</Text>
          : <ConfigFields fields={fields} value={config} tokens={tokens} onChange={(key, next) => setConfig((c) => ({ ...c, [key]: next }))} disabled={saving} />}
        <DialogFooter>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" isLoading={saving} disabled={missing.length > 0} onClick={() => void add()}>
            {missing.length > 0 ? `Choose ${missing[0]!.label.toLowerCase()}` : 'Add destination'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
