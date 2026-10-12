/**
 * File Name: server.ts
 * Purpose: The Variants server entry - variant siblings (create + lineage),
 *          A/B experiments (store records, member CRUD, a key-auth read for
 *          frontends), and timed takeovers (draft snapshot, delayed
 *          apply/revert tasks on the durable queue, cancel with instant
 *          revert). Everything rides the generic extension surface.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Writes go through ctx.tangen, so content hooks RUN -
 *          a review extension's publish gate composes with takeovers: a
 *          refused publish marks the takeover 'blocked' (reason recorded),
 *          it never crashes the worker. UI copy avoids em dashes.
 */
import { defineExtensionServer } from '@tangen/cms'
import type { ExtensionServerCtx, TangenLocalClient } from '@tangen/types'
import {
  LINEAGE_PREFIX, EXPERIMENT_PREFIX, TAKEOVER_PREFIX,
  APPLY_TASK, REVERT_TASK, LABEL_VARIANT_BASE, labelVariantOf,
  variantLetter, variantTitle, variantSlugCandidate,
  copyableFieldValues, validateTakeoverWindow,
  type LineageRecord, type ExperimentRecord, type TakeoverRecord,
} from './shared'

const newId = (prefix: string) => `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
const nowISO = () => new Date().toISOString()

/**
 * HTTP-status-aware error the platform's error middleware serialises with the
 * right status (duck-typed RequestError - extensions cannot import api internals).
 */
function httpError(status: number, message: string, code = 'VARIANTS_ERROR'): Error {
  const e = new Error(message) as Error & { statusCode: number; code: string }
  e.name = 'RequestError'
  e.statusCode = status
  e.code = code
  return e
}

function requireTangen(ctx: ExtensionServerCtx): TangenLocalClient {
  if (!ctx.tangen) throw httpError(500, 'The Variants extension needs the content client (ctx.tangen), which is unavailable in this runtime.')
  return ctx.tangen
}

/** Read an object of any type, translating a missing row into a clean 404. */
async function findOr404(t: TangenLocalClient, typeName: string, id: string, label: string): Promise<Record<string, unknown>> {
  try {
    const { data } = await t.objects(typeName as never).find(id)
    return data as Record<string, unknown>
  } catch {
    throw httpError(404, `${label} "${id}" was not found in type "${typeName}".`, 'NOT_FOUND')
  }
}

async function listRecords<T>(ctx: ExtensionServerCtx, prefix: string): Promise<T[]> {
  return (await ctx.store.list(prefix)).map((r) => r.data as T)
}

const memberEmit = (ctx: ExtensionServerCtx, name: string, payload: Record<string, unknown>, memberId?: string) =>
  ctx.emit?.(name, payload, { actorId: memberId ?? null, actorType: memberId ? 'member' : null })

/** Write `values` onto `objectId` and publish it (content hooks run on both). */
async function applyValuesAndPublish(t: TangenLocalClient, typeName: string, objectId: string, values: Record<string, unknown>): Promise<void> {
  if (Object.keys(values).length > 0) {
    await t.objects(typeName as never).update(objectId, values as never)
  }
  await t.objects(typeName as never).publish(objectId)
}

export default defineExtensionServer({
  // ── Webhook triggers (admin picker entries for our emitted events) ────────
  webhookTriggers: [
    { name: 'variant-created', label: 'Variant created', payloadFields: [
      { path: 'payload.typeName', label: 'Type' }, { path: 'payload.baseObjectId', label: 'Base object' }, { path: 'payload.variantId', label: 'Variant object' },
    ] },
    { name: 'experiment-started', label: 'Experiment started' },
    { name: 'experiment-stopped', label: 'Experiment stopped' },
    { name: 'takeover-scheduled', label: 'Takeover scheduled' },
    { name: 'takeover-applied', label: 'Takeover applied' },
    { name: 'takeover-reverted', label: 'Takeover reverted' },
    { name: 'takeover-blocked', label: 'Takeover blocked' },
    { name: 'takeover-cancelled', label: 'Takeover cancelled' },
  ],

  adminRoutes: [
    // ── B1: create a variant sibling ─────────────────────────────────────
    {
      method: 'POST', path: 'create-variant', capability: 'manage:variants',
      handler: async (req, ctx) => {
        const { typeName, objectId } = (req.body ?? {}) as { typeName?: string; objectId?: string }
        if (!typeName || !objectId) throw httpError(422, 'typeName and objectId are required.')
        const t = requireTangen(ctx)
        const base = await findOr404(t, typeName, objectId, 'Base object')
        if (await ctx.store.get(`${LINEAGE_PREFIX}${objectId}`)) {
          throw httpError(422, 'This object is itself a variant. Create further variants from its base object.')
        }

        const siblings = (await listRecords<LineageRecord>(ctx, LINEAGE_PREFIX))
          .filter((r) => r.baseObjectId === objectId)
        const letter = variantLetter(siblings.length + 1)
        const title = variantTitle(String(base.title ?? 'Untitled'), letter)

        // Copy the draft field values only - variants always start as drafts.
        const values = copyableFieldValues(base)
        const created = await t.objects(typeName as never).create({ title, values: values as never })
        const variantId = String((created.data as { id: string }).id)

        // Suffixed unique slug: probe -variant-<letter>, then -2, -3, ...
        let slug = ''
        for (let attempt = 1; attempt <= 25; attempt++) {
          const candidate = variantSlugCandidate(String(base.slug ?? ''), letter, attempt, String(base.title ?? 'variant'))
          const taken = await t.objects(typeName as never).findBySlug(candidate).then(() => true).catch(() => false)
          if (!taken) { slug = candidate; break }
        }
        if (slug) await t.objects(typeName as never).update(variantId, { slug } as never)

        await t.labels.add(`content:${typeName}`, variantId, [labelVariantOf(objectId)])
        await t.labels.add(`content:${typeName}`, objectId, [LABEL_VARIANT_BASE])

        const record: LineageRecord = {
          variantId, baseObjectId: objectId, typeName,
          createdBy: req.memberId, createdAt: nowISO(),
        }
        await ctx.store.put(`${LINEAGE_PREFIX}${variantId}`, { ...record })
        memberEmit(ctx, 'variant-created', { typeName, baseObjectId: objectId, variantId }, req.memberId)
        ctx.log(`variant ${variantId} created from ${typeName}/${objectId}`)
        return { data: { ...record, title, slug } }
      },
    },

    // ── B1: lineage for the editor panel ─────────────────────────────────
    {
      method: 'GET', path: 'object/:objectId', capability: 'manage:variants',
      handler: async (req, ctx) => {
        const objectId = req.params.objectId
        const own = await ctx.store.get(`${LINEAGE_PREFIX}${objectId}`) as unknown as LineageRecord | undefined
        if (own) {
          return { data: { role: 'variant', baseObjectId: own.baseObjectId, typeName: own.typeName, createdAt: own.createdAt } }
        }
        const variants = (await listRecords<LineageRecord>(ctx, LINEAGE_PREFIX))
          .filter((r) => r.baseObjectId === objectId)
        const t = ctx.tangen
        const enriched = await Promise.all(variants.map(async (v): Promise<Record<string, unknown>> => {
          if (!t) return { ...v }
          try {
            const { data } = await t.objects(v.typeName as never).find(v.variantId)
            const row = data as Record<string, unknown>
            return { ...v, title: row.title, slug: row.slug, status: row.status }
          } catch { return { ...v } }
        }))
        return { data: { role: variants.length > 0 ? 'base' : 'none', variants: enriched } }
      },
    },

    // ── B2: experiments (member CRUD) ────────────────────────────────────
    {
      method: 'GET', path: 'experiments', capability: 'manage:variants',
      handler: async (_req, ctx) => {
        const rows = await ctx.store.list(EXPERIMENT_PREFIX, { orderByDataKey: 'startedAt', desc: true })
        return { data: rows.map((r) => r.data as unknown as ExperimentRecord) }
      },
    },
    {
      method: 'POST', path: 'experiments/start', capability: 'manage:variants',
      handler: async (req, ctx) => {
        const b = (req.body ?? {}) as { typeName?: string; baseObjectId?: string; variantObjectId?: string; split?: number }
        const { typeName, baseObjectId, variantObjectId } = b
        if (!typeName || !baseObjectId || !variantObjectId) {
          throw httpError(422, 'typeName, baseObjectId and variantObjectId are required.')
        }
        if (baseObjectId === variantObjectId) throw httpError(422, 'The base and the variant must be different objects.')
        const split = Number(b.split)
        if (!Number.isInteger(split) || split < 0 || split > 100) {
          throw httpError(422, 'split must be an integer between 0 and 100 (the percentage of visitors who see the variant).')
        }

        const running = (await listRecords<ExperimentRecord>(ctx, EXPERIMENT_PREFIX))
          .filter((e) => e.status === 'running' && e.baseObjectId === baseObjectId)
        if (running.length > 0) {
          throw httpError(422, 'An experiment is already running for this base object. Stop it before starting another.')
        }

        // Both sides must be live: frontends fetch each side through the
        // normal published read path.
        const t = requireTangen(ctx)
        for (const [label, id] of [['base', baseObjectId], ['variant', variantObjectId]] as const) {
          const row = await findOr404(t, typeName, id, label === 'base' ? 'Base object' : 'Variant object')
          if (row.status !== 'published') {
            throw httpError(422, `Both objects must be published before starting an experiment. The ${label} object is ${String(row.status ?? 'draft')}.`)
          }
        }

        const record: ExperimentRecord = {
          experimentId: newId('exp'), typeName, baseObjectId, variantObjectId,
          split, status: 'running', startedAt: nowISO(), createdBy: req.memberId,
        }
        await ctx.store.put(`${EXPERIMENT_PREFIX}${record.experimentId}`, record as unknown as Record<string, unknown>)
        memberEmit(ctx, 'experiment-started', { experimentId: record.experimentId, typeName, baseObjectId, variantObjectId, split }, req.memberId)
        return { data: record }
      },
    },
    {
      method: 'POST', path: 'experiments/:id/stop', capability: 'manage:variants',
      handler: async (req, ctx) => {
        const key = `${EXPERIMENT_PREFIX}${req.params.id}`
        const rec = await ctx.store.get(key) as unknown as ExperimentRecord | undefined
        if (!rec) throw httpError(404, `Experiment "${req.params.id}" was not found.`, 'NOT_FOUND')
        if (rec.status !== 'running') throw httpError(422, 'This experiment is not running.')
        const stopped: ExperimentRecord = { ...rec, status: 'stopped', stoppedAt: nowISO() }
        await ctx.store.put(key, stopped as unknown as Record<string, unknown>)
        memberEmit(ctx, 'experiment-stopped', { experimentId: rec.experimentId }, req.memberId)
        return { data: stopped }
      },
    },

    // ── B2: the frontend read (API key auth, running experiments only) ───
    {
      method: 'GET', path: 'experiments', auth: 'key',
      handler: async (req, ctx) => {
        if (ctx.tangen) {
          const rl = await ctx.tangen.rateLimit(`variants:experiments:${req.apiKeyId}`, 120, 60)
          if (!rl.allowed) throw httpError(429, 'Rate limit exceeded. Try again shortly.', 'RATE_LIMITED')
        }
        const running = (await listRecords<ExperimentRecord>(ctx, EXPERIMENT_PREFIX))
          .filter((e) => e.status === 'running')
        // Public shape only - no admin metadata (createdBy, timestamps).
        return {
          data: running.map((e) => ({
            experimentId: e.experimentId, typeName: e.typeName,
            baseObjectId: e.baseObjectId, variantObjectId: e.variantObjectId, split: e.split,
          })),
        }
      },
    },

    // ── B4: timed takeovers ──────────────────────────────────────────────
    {
      method: 'GET', path: 'takeovers', capability: 'manage:variants',
      handler: async (_req, ctx) => {
        const rows = await ctx.store.list(TAKEOVER_PREFIX, { orderByDataKey: 'createdAt', desc: true })
        return { data: rows.map((r) => r.data as unknown as TakeoverRecord) }
      },
    },
    {
      method: 'POST', path: 'takeovers', capability: 'manage:variants',
      handler: async (req, ctx) => {
        const b = (req.body ?? {}) as { typeName?: string; objectId?: string; variantObjectId?: string; startAt?: string; endAt?: string }
        const { typeName, objectId, variantObjectId, startAt, endAt } = b
        if (!typeName || !objectId || !variantObjectId || !startAt || !endAt) {
          throw httpError(422, 'typeName, objectId, variantObjectId, startAt and endAt are required.')
        }
        if (objectId === variantObjectId) throw httpError(422, 'The target and the variant must be different objects.')
        const win = validateTakeoverWindow(startAt, endAt)
        if (win.error) throw httpError(422, win.error)

        const t = requireTangen(ctx)
        const target = await findOr404(t, typeName, objectId, 'Target object')
        await findOr404(t, typeName, variantObjectId, 'Variant object')

        // Snapshot the target's CURRENT DRAFT values - the revert restores these.
        const record: TakeoverRecord = {
          takeoverId: newId('tko'), typeName, objectId, variantObjectId,
          startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(),
          status: 'scheduled',
          snapshot: { title: target.title as string | undefined, values: copyableFieldValues(target) },
          createdBy: req.memberId, createdAt: nowISO(),
        }
        await ctx.store.put(`${TAKEOVER_PREFIX}${record.takeoverId}`, record as unknown as Record<string, unknown>)
        await ctx.enqueue(APPLY_TASK, { takeoverId: record.takeoverId }, { delaySeconds: win.startDelaySeconds })
        await ctx.enqueue(REVERT_TASK, { takeoverId: record.takeoverId }, { delaySeconds: win.endDelaySeconds })
        memberEmit(ctx, 'takeover-scheduled', { takeoverId: record.takeoverId, typeName, objectId, variantObjectId, startAt: record.startAt, endAt: record.endAt }, req.memberId)
        return { data: record }
      },
    },
    {
      method: 'POST', path: 'takeovers/:id/cancel', capability: 'manage:variants',
      handler: async (req, ctx) => {
        const key = `${TAKEOVER_PREFIX}${req.params.id}`
        const rec = await ctx.store.get(key) as unknown as TakeoverRecord | undefined
        if (!rec) throw httpError(404, `Takeover "${req.params.id}" was not found.`, 'NOT_FOUND')

        if (rec.status === 'scheduled') {
          const cancelled: TakeoverRecord = { ...rec, status: 'cancelled', cancelledAt: nowISO() }
          await ctx.store.put(key, cancelled as unknown as Record<string, unknown>)
          memberEmit(ctx, 'takeover-cancelled', { takeoverId: rec.takeoverId }, req.memberId)
          return { data: cancelled }
        }
        if (rec.status === 'active') {
          // Cancelling a live takeover reverts immediately.
          const t = requireTangen(ctx)
          try {
            await applyValuesAndPublish(t, rec.typeName, rec.objectId, rec.snapshot.values)
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e)
            await ctx.store.put(key, { ...rec, status: 'blocked', reason } as unknown as Record<string, unknown>)
            memberEmit(ctx, 'takeover-blocked', { takeoverId: rec.takeoverId, phase: 'cancel-revert', reason }, req.memberId)
            throw httpError(422, `Could not revert the takeover: ${reason}`)
          }
          const cancelled: TakeoverRecord = { ...rec, status: 'cancelled', cancelledAt: nowISO(), revertedAt: nowISO() }
          await ctx.store.put(key, cancelled as unknown as Record<string, unknown>)
          memberEmit(ctx, 'takeover-reverted', { takeoverId: rec.takeoverId, via: 'cancel' }, req.memberId)
          memberEmit(ctx, 'takeover-cancelled', { takeoverId: rec.takeoverId }, req.memberId)
          return { data: cancelled }
        }
        throw httpError(422, 'Only scheduled or active takeovers can be cancelled.')
      },
    },
  ],

  // ── B4: the delayed apply/revert pair (durable queue) ─────────────────────
  tasks: [
    {
      name: 'apply-takeover',
      description: 'Applies a scheduled takeover: writes the variant values onto the target and publishes it',
      handler: async (payload, ctx) => {
        const { takeoverId } = (payload ?? {}) as { takeoverId?: string }
        if (!takeoverId) return
        const key = `${TAKEOVER_PREFIX}${takeoverId}`
        const rec = await ctx.store.get(key) as unknown as TakeoverRecord | undefined
        // Cancelled / blocked / already handled: silently stand down.
        if (!rec || rec.status !== 'scheduled') return
        try {
          const t = requireTangen(ctx)
          const { data } = await t.objects(rec.typeName as never).find(rec.variantObjectId)
          const values = copyableFieldValues(data as Record<string, unknown>)
          await applyValuesAndPublish(t, rec.typeName, rec.objectId, values)
          await ctx.store.put(key, { ...rec, status: 'active', appliedAt: nowISO() } as unknown as Record<string, unknown>)
          ctx.emit?.('takeover-applied', { takeoverId, typeName: rec.typeName, objectId: rec.objectId, variantObjectId: rec.variantObjectId })
          ctx.log(`takeover ${takeoverId} applied to ${rec.typeName}/${rec.objectId}`)
        } catch (e) {
          // A refused publish (e.g. a review gate) must surface in the record,
          // never crash the worker or retry into the same wall.
          const reason = e instanceof Error ? e.message : String(e)
          await ctx.store.put(key, { ...rec, status: 'blocked', reason } as unknown as Record<string, unknown>)
          ctx.emit?.('takeover-blocked', { takeoverId, phase: 'apply', reason })
          ctx.log(`takeover ${takeoverId} blocked at apply: ${reason}`)
        }
      },
    },
    {
      name: 'revert-takeover',
      description: 'Ends a takeover: restores the snapshotted values onto the target and publishes it',
      handler: async (payload, ctx) => {
        const { takeoverId } = (payload ?? {}) as { takeoverId?: string }
        if (!takeoverId) return
        const key = `${TAKEOVER_PREFIX}${takeoverId}`
        const rec = await ctx.store.get(key) as unknown as TakeoverRecord | undefined
        // Only an ACTIVE takeover has anything to revert (blocked applies never
        // changed the target; cancelled ones already reverted).
        if (!rec || rec.status !== 'active') return
        try {
          const t = requireTangen(ctx)
          await applyValuesAndPublish(t, rec.typeName, rec.objectId, rec.snapshot.values)
          await ctx.store.put(key, { ...rec, status: 'done', revertedAt: nowISO() } as unknown as Record<string, unknown>)
          ctx.emit?.('takeover-reverted', { takeoverId, typeName: rec.typeName, objectId: rec.objectId })
          ctx.log(`takeover ${takeoverId} reverted on ${rec.typeName}/${rec.objectId}`)
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e)
          await ctx.store.put(key, { ...rec, status: 'blocked', reason } as unknown as Record<string, unknown>)
          ctx.emit?.('takeover-blocked', { takeoverId, phase: 'revert', reason })
          ctx.log(`takeover ${takeoverId} blocked at revert: ${reason}`)
        }
      },
    },
  ],

  onInstall: async ({ workspaceId}) => {
    console.log(`[variants] installed into ${workspaceId}`)
  },
  onUninstall: async ({ workspaceId}) => {
    // Lineage/experiment/takeover records stay in extension data per platform
    // convention; content objects are never deleted by an uninstall.
    console.log(`[variants] uninstalled from ${workspaceId}`)
  },
})
