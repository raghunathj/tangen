/**
 * File Name: shutdown.ts
 * Purpose: The one process shutdown path (closure plan Phase 3, Unit 7).
 *          SIGTERM and SIGINT, or a direct call, run `dispose()` exactly
 *          once, in a deliberate order, under a bounded deadline, and
 *          report what was released; the process is never told to exit -
 *          it exits because nothing Tangen owns keeps it alive.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Order: (1) the HTTP server stops accepting new
 *          connections, in-flight requests finish; (2) the registry STOPs
 *          every started capability (scheduler, workers, realtime -
 *          dependants first) so no new background work is created;
 *          (3) the registry DISPOSEs (queues, the Redis client, presence,
 *          subscriptions); (4) SSE streams are closed and the schema-cache
 *          LISTEN released; (5) the database pool ends; (6) remaining HTTP
 *          connections are force-closed. The API holds no push or migration
 *          lock (those are the CLI's, released with its own process). A
 *          second signal during shutdown exits immediately - the operator's
 *          escape hatch, not the mechanism. The whole run is bounded by
 *          `deadlineMs` (default 15 s); a step past its own deadline is
 *          reported, not waited for.
 */
import { getLogger } from '@tangen/logging'
import type { RuntimeRegistry, DisposeReport } from './registry'

const logger = getLogger(['tangen', 'api', 'shutdown'])

export interface ShutdownDeps {
  registry: RuntimeRegistry
  /** The listening server (Elysia): stop(false) drains, stop(true) closes what is left. */
  server?: { stop: (closeActiveConnections?: boolean) => Promise<unknown> | unknown } | null
  /** Closes the SSE streams this process serves; returns how many. */
  closeSse?: () => number
  /** Releases the schema-cache LISTEN. */
  stopSchemaListener?: () => Promise<void>
  /** Ends the database pool. */
  closeDb?: () => Promise<void>
  /** Whole-shutdown deadline; each step gets the remainder, capped per step. Default 15 s. */
  deadlineMs?: number
  /** Per-capability deadline for the registry. Default 5 s. */
  stepDeadlineMs?: number
}

export interface ShutdownReport {
  reason: string
  steps: Array<{ step: string; ok: boolean; ms: number; detail?: string }>
  registry: DisposeReport | null
  durationMs: number
  /** True when the whole run finished inside the deadline. */
  complete: boolean
}

export interface ProcessShutdown {
  /** Runs the shutdown once; later calls return the same promise. */
  dispose(reason?: string): Promise<ShutdownReport>
  /** Installs SIGTERM/SIGINT handlers; returns the uninstaller. */
  installSignalHandlers(): () => void
  /** True once a shutdown has begun. */
  started(): boolean
}

async function timed(step: string, deadlineMs: number, work: () => unknown | Promise<unknown>): Promise<ShutdownReport['steps'][number]> {
  const t0 = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<{ timedOut: true }>((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), Math.max(1, deadlineMs)) })
  try {
    const result = await Promise.race([Promise.resolve().then(work).then((v) => ({ v, timedOut: false as const })), guard])
    const ms = Math.round((performance.now() - t0) * 10) / 10
    if ('timedOut' in result && result.timedOut) return { step, ok: false, ms, detail: `did not finish within ${deadlineMs} ms` }
    const v = (result as { v: unknown }).v
    return { step, ok: true, ms, ...(typeof v === 'number' ? { detail: `${v}` } : {}) }
  } catch (e) {
    return { step, ok: false, ms: Math.round((performance.now() - t0) * 10) / 10, detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Builds the process shutdown for these resources. */
export function createShutdown(deps: ShutdownDeps): ProcessShutdown {
  const deadlineMs = deps.deadlineMs ?? 15_000
  const stepDeadlineMs = deps.stepDeadlineMs ?? 5_000
  let running: Promise<ShutdownReport> | null = null

  const dispose = (reason = 'dispose'): Promise<ShutdownReport> => {
    if (running) return running
    running = (async () => {
      const t0 = performance.now()
      const left = () => Math.max(1, deadlineMs - (performance.now() - t0))
      const steps: ShutdownReport['steps'] = []
      logger.info(`shutdown: ${reason}`)
      // 1. No new connections; in-flight requests finish on their own.
      if (deps.server) steps.push(await timed('http.stop-accepting', Math.min(stepDeadlineMs, left()), () => deps.server!.stop(false)))
      // 2 + 3. Every started capability stops (no new background work), then releases what it owns.
      let registry: DisposeReport | null = null
      const disposeStep = await timed('registry.dispose', left(), async () => { registry = await deps.registry.dispose(stepDeadlineMs) })
      steps.push(disposeStep)
      // 4. Streams and the schema LISTEN this process holds.
      if (deps.closeSse) steps.push(await timed('sse.close', Math.min(stepDeadlineMs, left()), () => deps.closeSse!()))
      if (deps.stopSchemaListener) steps.push(await timed('schema-listener.stop', Math.min(stepDeadlineMs, left()), () => deps.stopSchemaListener!()))
      // 5. The pool. Nothing Tangen owns talks to the database after this.
      if (deps.closeDb) steps.push(await timed('db.end', Math.min(stepDeadlineMs, left()), () => deps.closeDb!()))
      // 6. Whatever connection is still open is closed; the server is gone.
      //    Elysia drops its Bun server on the first stop, so only a server
      //    that is still there is asked again.
      //    (`server` becomes null on that first stop: null, not absent, so a
      //    plain `??` would ask a stopped server again and log "isn't running".)
      const holder = deps.server as { server?: unknown } | null | undefined
      const stillListening = !!holder && (holder.server === undefined ? true : Boolean(holder.server))
      if (deps.server && stillListening) steps.push(await timed('http.close', Math.min(stepDeadlineMs, left()), () => deps.server!.stop(true)))
      const durationMs = Math.round((performance.now() - t0) * 10) / 10
      const complete = durationMs <= deadlineMs && steps.every((s) => s.ok)
      const report: ShutdownReport = { reason, steps, registry, durationMs, complete }
      for (const s of steps) if (!s.ok) logger.warn(`shutdown step ${s.step} failed: ${s.detail}`)
      logger.info(`shutdown ${complete ? 'complete' : 'finished with failures'} in ${durationMs} ms`)
      return report
    })()
    return running
  }

  return {
    dispose,
    started: () => running !== null,
    installSignalHandlers() {
      let signals = 0
      const on = (signal: NodeJS.Signals) => {
        signals++
        if (signals > 1) {
          // The operator asked twice: stop waiting. This is the escape hatch, not the shutdown.
          logger.warn(`second ${signal} during shutdown: exiting now`)
          process.exit(1)
        }
        // The process exits when nothing keeps it alive; a clean shutdown sets 0.
        void dispose(signal).then((r) => { process.exitCode = r.complete ? 0 : 1 })
      }
      const term = () => on('SIGTERM')
      const int = () => on('SIGINT')
      process.on('SIGTERM', term)
      process.on('SIGINT', int)
      return () => { process.off('SIGTERM', term); process.off('SIGINT', int) }
    },
  }
}
