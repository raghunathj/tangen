/**
 * File Name: realtime.tsx
 * Purpose: The Kitchen Sink Realtime page - the panel that moves: it
 *          subscribes to the extension's declared channel through the kit,
 *          refetches the counter when a tick arrives, and offers the button
 *          that makes the server publish one.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Realtime R4 (docs/realtime.md "For an extension").
 *          Three things to copy: `useRealtime(topic, handler, {})`
 *          from @/kit (the admin's binding of @tangen/realtime-admin, one
 *          connection per environment), a handler that REFETCHES rather
 *          than trusting the envelope as state (realtime signals, it does
 *          not replicate), and `useRealtimeStatus()` for the Live badge.
 *          Open the page in two tabs and click Tick in one: the other
 *          moves, through whatever fan-out Core runs. No em dashes.
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AdminPage, Button, Card, Callout, Text, adminFetch, useRealtime, useRealtimeStatus } from '@/kit'
import { Example, ExampleStack, useSinkCrumbs } from './example'

const TOPIC = 'ext:kitchen-sink:counter'

interface Counter { value: number; lastBy: string | null }

/** Realtime: a declared channel, a server publish, a panel that refetches on the event. */
export function SinkRealtimePage() {
  const [counter, setCounter] = useState<Counter>({ value: 0, lastBy: null })
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const [ticking, setTicking] = useState(false)
  const status = useRealtimeStatus()

  const load = useCallback(async () => {
    const res = await adminFetch<{ data: Counter }>('/admin/ext/kitchen-sink/counter')
    setCounter(res.data)
  }, [])

  useEffect(() => { void load() }, [load])

  // The envelope says "it changed" (value, by); the page refetches canonical
  // state. onResync runs when the server could not replay a gap: refetch too.
  useRealtime<{ value: number; by: string | null }>(TOPIC, (event) => {
    setLastEvent(`${event.type} #${event.id} (value ${event.data.value})`)
    void load()
  }, { onResync: () => void load() })

  const tick = async () => {
    setTicking(true)
    try { await adminFetch('/admin/ext/kitchen-sink/tick', { method: 'POST' }) } finally { setTicking(false) }
  }

  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Realtime')}>
      <ExampleStack>
        <Example
          title="A panel that moves"
          description="The server publishes on a channel the manifest declares; this page subscribes through the kit and refetches. Open it in a second tab and click Tick here."
          code={`// tangen.extension.ts - declare the channel (any member may subscribe; add capability to gate it)
realtime: { channels: [{ name: 'counter' }] }

// src/server.ts - publish from any handler, task or event (ids and counters, never documents)
await ctx.realtime.publish({ channel: 'counter', type: 'sink.tick', data: { value, by } })

// the page - subscribe through the kit, refetch on the event
import { useRealtime, useRealtimeStatus } from '@/kit'
useRealtime('ext:kitchen-sink:counter', () => load(), { onResync: () => load() })
const status = useRealtimeStatus()   // 'open' when live`}
        >
          <Card>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Text className="text-xs uppercase tracking-wide text-fg-muted">Counter</Text>
                <p className="text-4xl font-semibold tabular-nums" data-testid="sink-counter">{counter.value}</p>
                <Text className="text-xs text-fg-muted">
                  {counter.lastBy ? `last tick by ${counter.lastBy}` : 'no ticks yet'}
                </Text>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`text-xs rounded-full px-2 py-0.5 border ${status === 'open' ? 'border-success/40 bg-success-muted text-success-fg' : 'border-border-strong bg-surface-sunken text-fg-muted'}`}>
                  {status === 'open' ? 'Live' : `Realtime ${status}`}
                </span>
                <Button onClick={tick} disabled={ticking}>{ticking ? 'Ticking' : 'Tick'}</Button>
              </div>
            </div>
          </Card>
          <Callout variant="info" title="What arrived" icon={null}>
            <Text className="text-sm font-mono break-all">{lastEvent ?? 'nothing yet: click Tick, or tick from another tab'}</Text>
          </Callout>
        </Example>

        <Example
          title="From a flow"
          description="The Flows extension's Realtime notify action publishes through another extension's channel by naming it. A flow can tick this counter's screen without code."
          code={`// Flows canvas: Realtime notify
{ extension: 'kitchen-sink', channel: 'counter', type: 'sink.tick', data: { value: 0 } }
// The envelope also carries flowId and flowName, so a screen can say which automation spoke.`}
        >
          <Text className="text-sm text-fg-muted">
            Declaring the channel is the whole contract: the server publishes, any subscriber the capability admits hears it, and an undeclared channel is refused on both sides.
          </Text>
        </Example>
      </ExampleStack>
    </AdminPage>
  )
}
