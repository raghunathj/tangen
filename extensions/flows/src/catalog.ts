/**
 * File Name: catalog.ts
 * Purpose: Merges the trigger/action catalog the builder and executor
 *          see: platform built-ins ∪ site helpers (flows entry options)
 *          ∪ every extension's flowTriggers/flowActions. Capability
 *          filtering happens per member at the catalog route; execution
 *          re-checks (defense in depth).
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/types'
import type { FlowTriggerContribution, FlowActionContribution, FlowPresetContribution, FlowHelpers } from './contract'
import { TRIGGER_TYPES } from './server'
import { FLOWS_CONTRIBUTED_ACTIONS } from './realtime-action'

const PLATFORM_LABELS: Record<string, string> = {
  'object.created': 'Content created', 'object.updated': 'Content updated',
  'object.published': 'Content published', 'object.unpublished': 'Content unpublished',
  'object.deleted': 'Content deleted', 'object.scheduled': 'Content scheduled',
  'media.uploaded': 'Media uploaded', 'member.invited': 'Member invited',
  'member.created': 'Member created', 'member.updated': 'Member updated',
  'form.submitted': 'Form submitted',
  'site_user.registered': 'Site user registered', 'site_user.login': 'Site user logged in',
}

export interface FlowCatalog {
  triggers: FlowTriggerContribution[]
  actions: Array<Omit<FlowActionContribution, 'handler'> & { contributor?: string }>
}

/** One executable contributed action: definition + who contributed it + (for
 *  extension contributors) the lazy builder for THEIR ctx - the executor runs
 *  the handler with the contributor's store/identity, not flows'. */
export interface ContributedAction {
  def: FlowActionContribution
  contributor: string
  ctx?: () => ExtensionServerCtx | Promise<ExtensionServerCtx>
}

/** Contributed action handlers keyed by name (executor lookup). */
export function contributedActions(ctx: ExtensionServerCtx): Map<string, ContributedAction> {
  const map = new Map<string, ContributedAction>()
  // Flows' own contributions (Realtime R4: realtime_publish) run with the
  // flows ctx, like site helpers; a site helper of the same name wins.
  for (const a of FLOWS_CONTRIBUTED_ACTIONS) map.set(a.name, { def: a, contributor: 'flows' })
  const site = (ctx.options ?? {}) as FlowHelpers
  for (const a of site.actions ?? []) map.set(a.name, { def: a, contributor: 'site' })
  // K2.1: the contribution registry knows the point, its grant and every
  // contributor's ctx; the registry() walk stays for a host that predates it.
  if (ctx.contributions) {
    for (const c of ctx.contributions<FlowActionContribution>('flow.actions@1', { except: ctx.extensionId })) {
      map.set(c.item.name, { def: c.item, contributor: c.extensionId, ctx: c.ctx })
    }
    return map
  }
  for (const { id, server, ctx: ctxFor } of ctx.registry?.() ?? []) {
    if (id === ctx.extensionId) continue
    for (const a of ((server as { flowActions?: FlowActionContribution[] }).flowActions ?? [])) {
      map.set(a.name, { def: a, contributor: id, ctx: ctxFor })
    }
  }
  return map
}

export function buildCatalog(ctx: ExtensionServerCtx, can?: (cap: string) => boolean): FlowCatalog {
  const triggers: FlowTriggerContribution[] = TRIGGER_TYPES.map((type) => ({ type, label: PLATFORM_LABELS[type] ?? type }))
  // Schedule is a first-class trigger, not an event-bus type (fired by the
  // extension's own durable schedule chain), so it's added here, not to TRIGGER_TYPES.
  triggers.push({ type: 'schedule', label: 'On a schedule', description: 'Run on a recurring schedule (hourly / daily / weekly)' })
  triggers.push({ type: 'manual', label: 'Manual / Run now', description: 'Runs only when you click Run now or call the run API' })
  triggers.push({ type: 'webhook', label: 'Inbound webhook', description: 'Runs when an external service POSTs to this flow’s signed URL' })
  const site = (ctx.options ?? {}) as FlowHelpers
  triggers.push(...(site.triggers ?? []))
  if (ctx.contributions) {
    triggers.push(...ctx.contributions<FlowTriggerContribution>('flow.triggers@1', { except: ctx.extensionId }).map((c) => c.item))
  } else {
    for (const { id, server } of ctx.registry?.() ?? []) {
      if (id === ctx.extensionId) continue
      triggers.push(...(((server as { flowTriggers?: FlowTriggerContribution[] }).flowTriggers) ?? []))
    }
  }
  const actions = [...contributedActions(ctx).entries()].map(([name, { def, contributor }]) => ({
    name, label: def.label, description: def.description, capability: def.capability,
    configFields: def.configFields, output: def.output, contributor,
  }))
  const visible = <T extends { capability?: string }>(x: T) => !x.capability || !can || can(x.capability)
  return { triggers: triggers.filter(visible), actions: actions.filter(visible) }
}

/** One contributed preset: the definition plus who contributed it (D1). */
export interface ContributedPreset {
  def: FlowPresetContribution
  contributor: string
}

/**
 * The presets available here, keyed by id (plan-connectors D1). Same shape of
 * read as the actions: site helpers first, then every active contributor of
 * `flow.presets@1`, whose own grant the registry has already checked.
 *
 * A preset has no handler, so no contributor ctx is lent: `build` is pure and
 * runs inside the create request, and the flow it returns executes under the
 * ordinary action rules afterwards.
 */
export function contributedPresets(ctx: ExtensionServerCtx): Map<string, ContributedPreset> {
  const map = new Map<string, ContributedPreset>()
  const site = (ctx.options ?? {}) as FlowHelpers
  for (const p of site.presets ?? []) map.set(p.id, { def: p, contributor: 'site' })
  if (ctx.contributions) {
    for (const c of ctx.contributions<FlowPresetContribution>('flow.presets@1', { except: ctx.extensionId })) {
      map.set(c.item.id, { def: c.item, contributor: c.extensionId })
    }
    return map
  }
  for (const { id, server } of ctx.registry?.() ?? []) {
    if (id === ctx.extensionId) continue
    for (const p of ((server as { flowPresets?: FlowPresetContribution[] }).flowPresets ?? [])) {
      map.set(p.id, { def: p, contributor: id })
    }
  }
  return map
}

/**
 * What a host may render: the presets for ITS trigger and scope kind, minus
 * `build` (a function does not cross an HTTP boundary) and minus any the
 * member may not use.
 */
export function presetsFor(
  ctx: ExtensionServerCtx,
  where: { trigger?: string; scope?: string },
  can?: (cap: string) => boolean,
): Array<Omit<FlowPresetContribution, 'build'> & { contributor: string }> {
  return [...contributedPresets(ctx).values()]
    .filter(({ def }) => !where.trigger || def.appliesTo.trigger === where.trigger)
    .filter(({ def }) => !where.scope || def.appliesTo.scope === where.scope)
    .filter(({ def }) => !def.capability || !can || can(def.capability))
    .map(({ def, contributor }) => ({
      id: def.id, label: def.label, description: def.description, icon: def.icon,
      ...(def.brand ? { brand: def.brand } : {}),
      capability: def.capability, appliesTo: def.appliesTo, configFields: def.configFields,
      contributor,
    }))
}
