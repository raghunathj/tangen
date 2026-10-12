/**
 * File Name: registry.ts
 * Purpose: The one runtime capability registry (closure plan Phase 3). A
 *          capability is REGISTERED (known, with its metadata and
 *          dependencies - nothing runs), MOUNTED (its HTTP surface attached,
 *          recorded here by the composer), STARTED (its workers, timers,
 *          subscribers and connections begin, only when it is available and
 *          its runtime service is required), STOPPED (no new background
 *          work; loops end) and DISPOSED (every handle it owns released).
 *          The registry records each state, so boot, health, shutdown, the
 *          composition tests and a later Admin descriptor read one truth.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Tangen-owned, no HTTP framework types: mounting is a
 *          fact the composer reports, not something the registry does.
 *          `register` calls NO handler - that is the invariant the test
 *          proves. `start` evaluates availability (can it run here?) and
 *          requirement (is its service wanted, from configuration and
 *          persisted demand?) in dependency order; `dispose` stops and
 *          releases in reverse order under a per-capability deadline, so a
 *          broken worker cannot hold a deployment, and is safe to repeat.
 *          A capability marked `strict` (explicitly required by
 *          configuration) refuses the boot when it is unavailable; every
 *          other unavailable capability is recorded with a display-safe
 *          reason and skipped.
 */

export type CapabilityKind = 'core' | 'optional' | 'demand' | 'extension'

export type Availability = { available: true } | { available: false; reason: string }

export interface CapabilityDefinition {
  /** Stable id, unique in the process. */
  id: string
  label: string
  kind: CapabilityKind
  /** Capabilities that must be started before this one and disposed after it. */
  dependsOn?: readonly string[]
  /**
   * Can this capability run in this process (its native module loads, its
   * server extension exists, its transport is configured)? Never throws;
   * the reason is written for an operator and carries no secret or driver
   * text. Default: available.
   */
  availability?: () => Availability | Promise<Availability>
  /**
   * Is its runtime service wanted - from configuration, an installed
   * capability, or persisted demand (a scheduled row, a cron entry)?
   * Evaluated at START; false means nothing starts. Default: yes.
   */
  required?: () => boolean | Promise<boolean>
  /** Explicitly required by configuration: unavailable refuses the boot instead of being skipped. */
  strict?: boolean
  start?: () => void | Promise<void>
  stop?: () => void | Promise<void>
  dispose?: () => void | Promise<void>
}

export type CapabilityPhase = 'registered' | 'started' | 'stopped' | 'disposed'

export interface CapabilityState {
  id: string
  label: string
  kind: CapabilityKind
  dependsOn: readonly string[]
  /** Evaluated at START; null before. */
  availability: Availability | null
  /** The composer attached its HTTP surface. */
  mounted: boolean
  /** Selection switched it off (a lean composition), so it neither mounts nor starts. */
  enabled: boolean
  /** START found its service wanted; null before START or when not evaluated. */
  required: boolean | null
  phase: CapabilityPhase
  /** The last lifecycle failure, display-safe. */
  error: string | null
}

export interface StartReport {
  started: string[]
  skipped: Array<{ id: string; because: 'disabled' | 'unavailable' | 'not-required' | 'dependency' }>
  failed: Array<{ id: string; error: string }>
}

export interface DisposeReport {
  disposed: string[]
  failed: Array<{ id: string; error: string }>
  timedOut: string[]
  durationMs: number
}

const DEFAULT_DEADLINE_MS = 5_000

function describeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

async function withDeadline<T>(work: () => T | Promise<T>, ms: number, what: string): Promise<{ ok: true; value: T } | { ok: false; timedOut: boolean; error: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<{ ok: false; timedOut: true; error: string }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true, error: `${what} did not finish within ${ms} ms` }), ms)
  })
  try {
    const result = await Promise.race([
      Promise.resolve().then(work).then((value) => ({ ok: true as const, value })).catch((e) => ({ ok: false as const, timedOut: false, error: describeError(e) })),
      deadline,
    ])
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export class RuntimeRegistry {
  private defs = new Map<string, CapabilityDefinition>()
  private states = new Map<string, CapabilityState>()
  private order: string[] = []
  private disposing: Promise<DisposeReport> | null = null

  /** Records the capability. Calls nothing on it. */
  register(def: CapabilityDefinition): void {
    if (this.defs.has(def.id)) throw new Error(`capability "${def.id}" is already registered`)
    this.defs.set(def.id, def)
    this.states.set(def.id, {
      id: def.id, label: def.label, kind: def.kind, dependsOn: def.dependsOn ?? [],
      availability: null, mounted: false, enabled: true, required: null, phase: 'registered', error: null,
    })
    this.order.push(def.id)
  }

  has(id: string): boolean { return this.defs.has(id) }

  /** The composer reports that the capability's HTTP surface is attached. */
  markMounted(id: string): void { this.must(id).mounted = true }

  /** A composition switched the capability off: it neither mounts nor starts. */
  setEnabled(id: string, enabled: boolean): void { this.must(id).enabled = enabled }

  state(id: string): CapabilityState { return { ...this.must(id) } }

  /**
   * A capability's availability, evaluated once on demand (an extension's
   * `requires.capabilities` asks before START has run the sweep). Null when
   * no such capability exists in this process; a capability switched off by
   * the composition is unavailable with that reason.
   */
  async availabilityOf(id: string): Promise<Availability | null> {
    const def = this.defs.get(id)
    const st = this.states.get(id)
    if (!def || !st) return null
    if (!st.enabled) return { available: false, reason: 'not part of this server composition' }
    if (st.availability) return st.availability
    try {
      st.availability = def.availability ? await def.availability() : { available: true }
    } catch (e) {
      st.availability = { available: false, reason: `availability check failed: ${describeError(e)}` }
    }
    return st.availability
  }

  /** Every capability, in registration order - the snapshot a descriptor or a health page reads. */
  snapshot(): CapabilityState[] { return this.order.map((id) => ({ ...this.states.get(id)! })) }

  /** Ids in dependency order (a dependency before its dependants), registration order otherwise. */
  startOrder(): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const visit = (id: string, trail: string[]) => {
      if (seen.has(id)) return
      if (trail.includes(id)) throw new Error(`capability dependency cycle: ${[...trail, id].join(' -> ')}`)
      const def = this.defs.get(id)
      if (!def) throw new Error(`capability "${trail[trail.length - 1]}" depends on unknown "${id}"`)
      for (const dep of def.dependsOn ?? []) visit(dep, [...trail, id])
      seen.add(id)
      out.push(id)
    }
    for (const id of this.order) visit(id, [])
    return out
  }

  /**
   * Starts every enabled, available, required capability whose dependencies
   * started, in dependency order. Idempotent: a started capability is left
   * alone. A strict capability that is unavailable throws before anything
   * else is touched.
   */
  async start(): Promise<StartReport> {
    const report: StartReport = { started: [], skipped: [], failed: [] }
    const order = this.startOrder()
    // Availability first, for every capability, so a strict refusal happens
    // before any worker exists.
    for (const id of order) {
      const def = this.defs.get(id)!
      const st = this.states.get(id)!
      if (st.phase === 'started' || st.phase === 'disposed') continue
      if (!st.enabled) continue
      try {
        st.availability = def.availability ? await def.availability() : { available: true }
      } catch (e) {
        st.availability = { available: false, reason: `availability check failed: ${describeError(e)}` }
      }
      if (!st.availability.available && def.strict) {
        throw new Error(`capability "${id}" is required by configuration but unavailable: ${st.availability.reason}`)
      }
    }
    for (const id of order) {
      const def = this.defs.get(id)!
      const st = this.states.get(id)!
      if (st.phase === 'started') continue
      if (st.phase === 'disposed') continue
      if (!st.enabled) { report.skipped.push({ id, because: 'disabled' }); continue }
      if (st.availability && !st.availability.available) { report.skipped.push({ id, because: 'unavailable' }); continue }
      const depsUp = (def.dependsOn ?? []).every((d) => this.states.get(d)?.phase === 'started')
      if (!depsUp) { report.skipped.push({ id, because: 'dependency' }); continue }
      try {
        st.required = def.required ? await def.required() : true
      } catch (e) {
        st.required = false
        st.error = `requirement check failed: ${describeError(e)}`
      }
      if (!st.required) { report.skipped.push({ id, because: 'not-required' }); continue }
      try {
        if (def.start) await def.start()
        st.phase = 'started'
        st.error = null
        report.started.push(id)
      } catch (e) {
        st.error = describeError(e)
        report.failed.push({ id, error: st.error })
      }
    }
    return report
  }

  /**
   * Starts one registered capability on demand - a route that just created
   * persisted demand (a scheduled row) calls this so the service wakes
   * without waiting for a boot. Re-evaluates availability and requirement;
   * no-op when the id is unknown to this process, disabled, disposed,
   * already started, or its dependencies are down.
   */
  async ensureStarted(id: string): Promise<boolean> {
    const def = this.defs.get(id)
    const st = this.states.get(id)
    if (!def || !st) return false
    if (st.phase === 'started') return true
    if (!st.enabled || st.phase === 'disposed' || this.disposing) return false
    if (!(def.dependsOn ?? []).every((d) => this.states.get(d)?.phase === 'started')) return false
    try {
      st.availability = def.availability ? await def.availability() : { available: true }
      if (!st.availability.available) return false
      st.required = def.required ? await def.required() : true
      if (!st.required) return false
      if (def.start) await def.start()
      st.phase = 'started'
      st.error = null
      return true
    } catch (e) {
      st.error = describeError(e)
      return false
    }
  }

  /** Stops every started capability, dependants before dependencies. Idempotent. */
  async stop(deadlineMs = DEFAULT_DEADLINE_MS): Promise<void> {
    for (const id of [...this.startOrder()].reverse()) {
      const st = this.states.get(id)!
      if (st.phase !== 'started') continue
      const def = this.defs.get(id)!
      const r = await withDeadline(() => def.stop?.(), deadlineMs, `stop of "${id}"`)
      st.phase = 'stopped'
      if (!r.ok) st.error = r.error
    }
  }

  /**
   * Stops what is started, then disposes every capability in reverse
   * dependency order, each under the deadline. Safe to call repeatedly and
   * concurrently: a second call joins the first.
   */
  dispose(deadlineMs = DEFAULT_DEADLINE_MS): Promise<DisposeReport> {
    if (this.disposing) return this.disposing
    this.disposing = (async () => {
      const t0 = performance.now()
      const report: DisposeReport = { disposed: [], failed: [], timedOut: [], durationMs: 0 }
      await this.stop(deadlineMs)
      for (const id of [...this.startOrder()].reverse()) {
        const st = this.states.get(id)!
        const def = this.defs.get(id)!
        if (st.phase === 'disposed' || st.phase === 'registered') { if (st.phase === 'registered') st.phase = 'disposed'; continue }
        const r = await withDeadline(() => def.dispose?.(), deadlineMs, `dispose of "${id}"`)
        st.phase = 'disposed'
        if (r.ok) report.disposed.push(id)
        else if (r.timedOut) { report.timedOut.push(id); st.error = r.error }
        else { report.failed.push({ id, error: r.error }); st.error = r.error }
      }
      report.durationMs = Math.round((performance.now() - t0) * 10) / 10
      return report
    })()
    return this.disposing
  }

  /** Test seam: a registry that forgot everything (the process registry is rebuilt per test). */
  reset(): void {
    this.defs.clear(); this.states.clear(); this.order = []; this.disposing = null
  }

  private must(id: string): CapabilityState {
    const st = this.states.get(id)
    if (!st) throw new Error(`capability "${id}" is not registered`)
    return st
  }
}

/** The process registry. Boot registers into it; shutdown disposes it. */
export const runtimeRegistry = new RuntimeRegistry()
