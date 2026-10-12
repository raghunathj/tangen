/**
 * File Name: realtime-action.ts
 * Purpose: The `realtime_publish` flow action - an automation notifies a
 *          screen without code: publish an event on one of Flows' own
 *          realtime channels, or on a channel another installed extension
 *          declares, through the platform's `ctx.realtime.publish`.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Realtime R4 (tasks/plan-realtime.md section 4.8:
 *          "Flows gain a realtime.publish action so an automation can
 *          notify a screen without code"). Shipped as a Flows-contributed
 *          action rather than an engine built-in so the builder renders
 *          its configFields generically, the catalog lists it, and a
 *          dry run never executes it (a notification is a side effect).
 *
 *          Which channel: `channel` names one of Flows' declared channels
 *          (`notify` by default, any member may subscribe to
 *          `ext:flows:notify`); with `extension` set, the event goes out
 *          through THAT extension's ctx (the registry's lazy builder), so
 *          its manifest decides whether the channel exists and who may
 *          hear it - the same gate the extension's own server meets. The
 *          envelope carries the flow's id and name beside the author's
 *          data, so a screen can say which automation spoke.
 */
import type { ExtensionServerCtx } from '@tangen/types'
import type { FlowActionContribution, FlowActionMeta } from './contract'

/** The channel Flows declares in its manifest for this action's default. */
export const FLOWS_NOTIFY_CHANNEL = 'notify'

const asObject = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  if (typeof v === 'string' && v.trim()) {
    try { const parsed = JSON.parse(v); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed } catch { /* not JSON: ignored */ }
  }
  return {}
}

/**
 * Resolves the ctx the event publishes through: Flows' own, or the named
 * extension's (from the registry's lazy builder).
 */
async function publishingCtx(ctx: ExtensionServerCtx, extension: string): Promise<ExtensionServerCtx> {
  if (!extension || extension === ctx.extensionId) return ctx
  const entry = ctx.registry?.().find((e) => e.id === extension)
  if (!entry) throw new Error(`realtime_publish: extension '${extension}' is not loaded`)
  if (!entry.ctx) throw new Error(`realtime_publish: extension '${extension}' offers no server context to publish through`)
  return entry.ctx()
}

export const realtimePublishAction: FlowActionContribution = {
  name: 'realtime_publish',
  label: 'Realtime notify',
  description: 'Publish a realtime event so an open admin screen updates at once (its own channel, or one another extension declares).',
  configFields: [
    { key: 'channel', label: `Channel (default: ${FLOWS_NOTIFY_CHANNEL})`, kind: 'text' },
    { key: 'type', label: 'Event type (e.g. order.flagged)', kind: 'text' },
    { key: 'data', label: 'Data (JSON, ids and counters only)', kind: 'json' },
    { key: 'extension', label: 'Publish through extension (optional, default: flows)', kind: 'text' },
  ],
  output: [
    { key: 'topic', label: 'Topic clients subscribe to', type: 'string' },
    { key: 'type', label: 'Event type', type: 'string' },
    { key: 'id', label: 'Envelope id', type: 'string' },
  ],
  handler: async (config: Record<string, unknown>, ctx: ExtensionServerCtx, meta?: FlowActionMeta) => {
    const channel = String(config.channel ?? '').trim() || FLOWS_NOTIFY_CHANNEL
    const type = String(config.type ?? '').trim()
    if (!type) throw new Error('realtime_publish needs an event `type`')
    const extension = String(config.extension ?? '').trim()
    const target = await publishingCtx(ctx, extension)
    if (!target.realtime) throw new Error('realtime_publish: this Tangen host has no realtime publish seam on the extension context')
    const data = {
      ...asObject(config.data),
      ...(meta?.flowId ? { flowId: meta.flowId } : {}),
      ...(meta?.flowName ? { flowName: meta.flowName } : {}),
    }
    const envelope = await target.realtime.publish({ channel, type, data }) as { id?: string } | null
    return { topic: `ext:${target.extensionId}:${channel}`, type, id: envelope?.id ?? null }
  },
}

/** Every action Flows contributes to its own catalog (beside the engine built-ins). */
export const FLOWS_CONTRIBUTED_ACTIONS: FlowActionContribution[] = [realtimePublishAction]
