/**
 * File Name: realtime-counter.ts
 * Purpose: The server half of the Kitchen Sink realtime showcase - a
 *          counter in extension data that every tick bumps and publishes on
 *          the extension's declared `counter` channel.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Realtime R4 (docs/realtime.md "For an extension").
 *          The pattern to copy: the manifest declares the channel, the
 *          server publishes ids and counters through `ctx.realtime.publish`
 *          (never documents), and the panel refetches canonical state from
 *          a read route when the envelope arrives. The seam is optional on
 *          the ctx, so a host without realtime still counts and the panel
 *          still reads; only the push is missing there.
 */
import type { ExtensionServerCtx } from '@tangen/cms'

/** The channel the manifest declares; clients subscribe to `ext:kitchen-sink:counter`. */
export const COUNTER_CHANNEL = 'counter'
/** The envelope type a tick publishes. */
export const TICK_TYPE = 'sink.tick'
/** Where the counter lives in extension data. */
export const COUNTER_KEY = '__counter__'

interface CounterRow { value: number; lastBy: string | null; updatedAt: string }

/** The current counter (0 before the first tick). */
export async function readCounter(ctx: ExtensionServerCtx): Promise<{ value: number; lastBy: string | null }> {
  const row = (await ctx.store.get(COUNTER_KEY)) as Partial<CounterRow> | undefined
  return { value: Number(row?.value ?? 0), lastBy: row?.lastBy ?? null }
}

/**
 * Bumps the counter, stores it, publishes the new value on the declared
 * channel and returns the value with the envelope id (null on a host with
 * no realtime seam).
 * @param ctx - The extension ctx (store + realtime).
 * @param by - The acting member id, for the envelope and the row.
 */
export async function tickCounter(ctx: ExtensionServerCtx, by: string | null): Promise<{ value: number; publishedId: string | null }> {
  const current = await readCounter(ctx)
  const value = current.value + 1
  const row: CounterRow = { value, lastBy: by, updatedAt: new Date().toISOString() }
  await ctx.store.put(COUNTER_KEY, row as unknown as Record<string, unknown>)
  if (!ctx.realtime) return { value, publishedId: null }
  const envelope = (await ctx.realtime.publish({ channel: COUNTER_CHANNEL, type: TICK_TYPE, data: { value, by } })) as { id?: string } | null
  return { value, publishedId: envelope?.id ?? null }
}
