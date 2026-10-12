/**
 * File Name: executor.ts
 * Purpose: The execution engine - walks the COMPILED graph from the
 *          trigger: conditions/switches pick an outlet, transforms emit
 *          templated objects, actions run through the registry, wait
 *          pauses with resume state (node id + prior outputs - the queue
 *          holds the delay, nothing sleeps). Guards: 500-node execution
 *          budget, stop-on-error (the queue retries). v1 linear flows
 *          migrate transparently on the way in.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { AnyFlowDef, FlowScope, StepLogEntry, FlowCondition } from './types'
import { migrateFlow } from './migrate'
import { compileFlow, nodeById, type CompileOpts } from './compile'
import { evaluateConditions } from './conditions'
import { resolveDeep, resolveTemplate } from './template'
import { runAction, type ActionCtx } from './actions'
import { classifyFailure, FlowActionError, FLOW_ERROR_CODES, type FlowFailure } from './failure'
import { nextDelaySeconds, parseRetryPolicy, shouldRetry } from './retry'

const NODE_BUDGET = 500
/** Active-execution wall-clock budget (excludes waits - those pause + resume). */
const TIME_BUDGET_MS = 30_000
/** Max iterations a `for each` loop runs - safety cap against runaway loops. */
const LOOP_MAX = 20
/**
 * How long ONE action may take before it is cut off (Phase 9B, Unit 17).
 *
 * The run's 30-second budget is checked BETWEEN nodes, which an action that
 * never returns never reaches - so `http`'s own 15-second signal protected
 * only `http`, and a contributed action was bounded by nothing at all. A node
 * may shorten this; it may not remove it.
 */
export const ACTION_TIMEOUT_MS = 20_000

/**
 * Runs one action under a bound, and TELLS it to stop when the bound is hit.
 *
 * Cooperative, deliberately: an action is given an AbortSignal and a chance to
 * honour it. Whether an external operation that has already left the process
 * actually stops is not something this can claim, and it does not.
 */
async function runBounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  nodeId: string,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new FlowActionError(
        FLOW_ERROR_CODES.TIMEOUT,
        `The action on node ${nodeId} did not finish within ${Math.round(timeoutMs / 1000)}s and was stopped.`,
        { retryable: 'retryable' },
      ))
    }, timeoutMs)
  })
  try {
    return await Promise.race([work(controller.signal), bound])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface FlowRunResult {
  /**
   * `waiting` parks on a Wait node; `waiting_retry` parks on a FAILED action
   * whose policy allows another attempt. Both hand the remainder back to the
   * caller as state - nothing sleeps in the worker (Phase 9B, Unit 9).
   */
  status: 'completed' | 'skipped' | 'error' | 'waiting' | 'waiting_retry'
  log: StepLogEntry[]
  ms: number
  /** Node ids in execution order (the taken path - canvas highlights this). */
  path: string[]
  /** Set when status is 'waiting' - resume from this node. */
  resumeNodeId?: string
  delaySeconds?: number
  /** Step outputs so far, in execution order ({{steps.N.…}} scope). */
  priorSteps?: Array<Record<string, unknown>>
  /** Same outputs keyed by node id ({{steps.<id>.output.…}} scope). */
  priorStepsById?: Record<string, { output: unknown }>
  /** The flow's "output" - the last executed step's output (what a parent
   *  "Run flow" step receives). {} when the flow produced no step output. */
  output?: unknown
  /** The typed, redacted failure that ended (or paused) the run. */
  failure?: FlowFailure
  /** Set with `waiting_retry`: which attempt the resumed segment will be. */
  nextAttempt?: number
}

export interface ExecuteOpts extends CompileOpts {
  /** Resume a waiting run at this node. */
  resumeNodeId?: string
  priorSteps?: Array<Record<string, unknown>>
  priorStepsById?: Record<string, { output: unknown }>
  /** Test runs fast-forward Wait nodes instead of parking the run. */
  testMode?: boolean
  /** Simulate write-actions (http/email/content/label/contributed) instead of executing them. */
  dryRun?: boolean
  /**
   * Which attempt the RESUMED node is on, counting from 1. Carried by the
   * queue across the backoff, so an attempt count survives a restart.
   */
  attempt?: number
  /** The execution this run belongs to - the stable half of an idempotency key. */
  executionId?: string
  /** Injected for deterministic jitter in tests. */
  random?: () => number
}

function waitSeconds(config: Record<string, unknown>): number {
  const minutes = Number(config.minutes ?? 0)
  const hours = Number(config.hours ?? 0)
  const days = Number(config.days ?? 0)
  return Math.max(60, Math.round(minutes * 60 + hours * 3600 + days * 86400))
}

export async function executeFlow(
  anyDef: AnyFlowDef,
  trigger: Record<string, unknown>,
  ctx: ActionCtx,
  opts: ExecuteOpts = {},
): Promise<FlowRunResult> {
  const started = performance.now()
  // Actions (and sub-flows via ctx.runFlow) read these off the ctx.
  if (opts.dryRun || opts.testMode) ctx = { ...ctx, dryRun: opts.dryRun || ctx.dryRun, testMode: opts.testMode || ctx.testMode }
  const def = migrateFlow(anyDef)
  const done = (r: Omit<FlowRunResult, 'ms'>): FlowRunResult => ({ ...r, ms: Math.round(performance.now() - started) })

  const compiled = compileFlow(def, { extraActions: opts.extraActions })
  if (!compiled.plan) {
    return done({
      status: 'error', path: [],
      log: [{ step: '-', action: 'compile', ok: false, ms: 0, error: compiled.errors.join(' ') }],
    })
  }
  const { out, triggerId } = compiled.plan

  const scope: FlowScope = {
    trigger,
    steps: [...(opts.priorSteps ?? [])],
    stepsById: { ...(opts.priorStepsById ?? {}) },
  }
  // Record a node's output both positionally (shim) and by id (stable refs).
  // The last recorded output is the flow's `output` (what a parent Run-flow gets).
  let lastOutput: unknown = scope.steps.length ? scope.steps[scope.steps.length - 1] : {}
  const record = (id: string, output: unknown) => {
    const out = (output ?? {}) as Record<string, unknown>
    scope.steps.push(out)
    scope.stepsById![id] = { output: out }
    lastOutput = out
  }
  const log: StepLogEntry[] = []
  const path: string[] = []
  let actionsRan = opts.resumeNodeId != null   // resumed runs already did work

  const next = (id: string, outlet = ''): string | undefined => out[id]?.[outlet]

  let current: string | undefined = opts.resumeNodeId ?? triggerId
  let budget = NODE_BUDGET

  while (current) {
    if (--budget < 0) {
      log.push({ step: current, action: 'guard', ok: false, ms: 0, error: `Node execution budget (${NODE_BUDGET}) exceeded.` })
      return done({ status: 'error', log, path })
    }
    if (performance.now() - started > TIME_BUDGET_MS) {
      log.push({ step: current, action: 'guard', ok: false, ms: 0, error: `Execution time budget (${TIME_BUDGET_MS / 1000}s) exceeded.` })
      return done({ status: 'error', log, path })
    }
    const node = nodeById(def, current)
    if (!node) break
    path.push(node.id)

    switch (node.kind) {
      case 'trigger':
        current = next(node.id)
        break

      case 'condition': {
        const holds = evaluateConditions((node.data.conditions ?? []) as FlowCondition[], scope)
        log.push({ step: node.id, action: 'condition', ok: true, ms: 0, output: { result: holds ? 'yes' : 'no' } })
        current = next(node.id, holds ? 'yes' : 'no')
        break
      }

      case 'switch': {
        const value = String(resolveTemplate(`{{${String(node.data.path)}}}`, scope) ?? '')
        const cases = (node.data.cases ?? []) as string[]
        const outlet = cases.includes(value) ? `case:${value}` : 'default'
        log.push({ step: node.id, action: 'switch', ok: true, ms: 0, output: { value, outlet } })
        current = next(node.id, outlet)
        break
      }

      case 'transform': {
        const output = resolveDeep((node.data.output ?? {}) as Record<string, unknown>, scope)
        record(node.id, output)
        log.push({ step: node.id, action: 'transform', ok: true, ms: 0, output })
        current = next(node.id)
        break
      }

      case 'wait': {
        const delaySeconds = waitSeconds(node.data)
        record(node.id, { waited: delaySeconds })
        if (opts.testMode) {
          // Tests can't be parked and resumed - skip the delay and keep going.
          log.push({ step: node.id, action: 'wait', ok: true, ms: 0, output: { delaySeconds, skippedInTest: true } })
          current = next(node.id)
          break
        }
        log.push({ step: node.id, action: 'wait', ok: true, ms: 0, output: { delaySeconds } })
        const resumeNodeId = next(node.id)
        if (!resumeNodeId) return done({ status: 'completed', log, path, output: lastOutput })
        return done({ status: 'waiting', log, path, resumeNodeId, delaySeconds, priorSteps: scope.steps, priorStepsById: scope.stepsById })
      }

      case 'loop': {
        const items = resolveTemplate(`{{${String(node.data.path)}}}`, scope)
        const all = Array.isArray(items) ? items : []
        const cap = Math.min(Number(node.data.limit) || LOOP_MAX, LOOP_MAX)
        const list = all.slice(0, cap)
        const truncated = all.length > list.length
        log.push({ step: node.id, action: 'loop', ok: true, ms: 0, output: { items: list.length, ...(truncated ? { truncatedFrom: all.length } : {}) } })
        const bodyStart = next(node.id, 'body')
        for (let i = 0; i < list.length; i++) {
          // Body chains run with {{item}}/{{itemIndex}} in scope, sequentially
          let bodyCurrent = bodyStart
          const bodyScope: FlowScope = { ...scope, item: list[i], itemIndex: i }
          while (bodyCurrent) {
            if (--budget < 0) {
              log.push({ step: bodyCurrent, action: 'guard', ok: false, ms: 0, error: `Node execution budget (${NODE_BUDGET}) exceeded.` })
              return done({ status: 'error', log, path })
            }
            if (performance.now() - started > TIME_BUDGET_MS) {
              log.push({ step: bodyCurrent, action: 'guard', ok: false, ms: 0, error: `Execution time budget (${TIME_BUDGET_MS / 1000}s) exceeded.` })
              return done({ status: 'error', log, path })
            }
            const bodyNode = nodeById(def, bodyCurrent)
            if (!bodyNode || bodyNode.kind !== 'action') break   // loop bodies are action chains (v2 scope)
            const t0 = performance.now()
            const step = { action: String(bodyNode.data.action), config: (bodyNode.data.config ?? {}) as Record<string, unknown> }
            path.push(bodyNode.id)
            try {
              const output = await runAction(step, bodyScope, ctx)
              const bodyOut = (output ?? {}) as Record<string, unknown>
              bodyScope.steps = [...bodyScope.steps, bodyOut]
              bodyScope.stepsById![bodyNode.id] = { output: bodyOut }   // shared map; last iteration wins for outside refs
              log.push({ step: `${bodyNode.id}[${i}]`, action: step.action, ok: true, ms: Math.round(performance.now() - t0), output })
              actionsRan = true
            } catch (err) {
              log.push({ step: `${bodyNode.id}[${i}]`, action: step.action, ok: false, ms: Math.round(performance.now() - t0), error: (err as Error).message })
              return done({ status: 'error', log, path })
            }
            bodyCurrent = next(bodyNode.id)
          }
        }
        record(node.id, { items: list.length })
        current = next(node.id, 'done')
        break
      }

      case 'action': {
        const t0 = performance.now()
        const step = { action: String(node.data.action), config: (node.data.config ?? {}) as Record<string, unknown> }
        // Which attempt this is. The FIRST node of a resumed-for-retry segment
        // carries the number the queue held across the backoff; every other
        // node in that segment starts at 1 again, because it has not run yet.
        const attempt = node.id === opts.resumeNodeId ? Math.max(1, opts.attempt ?? 1) : 1
        const { policy } = parseRetryPolicy(node.data.retry ?? node.data)
        // Stable across retries by design (Phase 9B, Unit 10): a provider that
        // deduplicates on this key does not do the work twice.
        const actionCtx: ActionCtx = opts.executionId
          ? { ...ctx, idempotencyKey: `${opts.executionId}:${node.id}`, attempt }
          : { ...ctx, attempt }

        // A node may shorten the bound; `0` and anything unusable fall back to
        // the default rather than meaning "no timeout".
        const declared = Number(node.data.timeoutMs)
        const timeoutMs = Number.isFinite(declared) && declared > 0 ? Math.min(declared, ACTION_TIMEOUT_MS) : ACTION_TIMEOUT_MS

        try {
          const output = await runBounded(
            (signal) => runAction(step, scope, { ...actionCtx, signal }),
            timeoutMs, node.id,
          )
          record(node.id, output)
          log.push({ step: node.id, action: step.action, ok: true, ms: Math.round(performance.now() - t0), attempt, output })
          actionsRan = true
          current = next(node.id)
          break
        } catch (err) {
          const failure = classifyFailure(err, { nodeId: node.id, attempt })
          log.push({
            step: node.id, action: step.action, ok: false, attempt,
            ms: Math.round(performance.now() - t0), error: failure.message, failure,
          })

          // 1. the policy decides, 2. the error branch, 3. the run fails.
          if (shouldRetry(policy, failure, attempt)) {
            return done({
              status: 'waiting_retry', log, path, failure,
              resumeNodeId: node.id,
              nextAttempt: attempt + 1,
              delaySeconds: nextDelaySeconds(policy, attempt, opts.random),
              priorSteps: scope.steps, priorStepsById: scope.stepsById,
            })
          }

          const handled = next(node.id, 'error')
          if (handled) {
            // The branch sees the SAFE failure - no stack, no provider detail.
            record(node.id, { error: failure.message, failure })
            current = handled
            break
          }
          return done({ status: 'error', log, path, failure })
        }
      }
    }
  }

  // A run where routing ended before any action executed is a visible skip
  return done({ status: actionsRan ? 'completed' : 'skipped', log, path, output: lastOutput })
}
