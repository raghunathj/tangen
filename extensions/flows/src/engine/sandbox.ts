/**
 * File Name: sandbox.ts
 * Purpose: The 'code' step - user JavaScript in a QuickJS WASM isolate.
 *          No network, no filesystem, no process BY CONSTRUCTION (the VM
 *          has no host bindings at all). `input` = { trigger, steps,
 *          item?, itemIndex? }; the script's return value (wrapped in a
 *          function, so `return` works) becomes the step output.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Limits - 1s interrupt budget, 32MB VM memory, 64KB
 *          JSON output. WASM module init is lazy + cached per process so
 *          flows without code steps never pay it. Every handle disposed
 *          (QuickJS asserts on leaks at runtime disposal).
 */
import type { FlowScope } from './types'

const CPU_BUDGET_MS = 1_000
const MEMORY_LIMIT = 32 * 1024 * 1024
const OUTPUT_LIMIT = 64 * 1024

type QuickJSModule = typeof import('quickjs-emscripten')
let quickjsPromise: Promise<Awaited<ReturnType<QuickJSModule['getQuickJS']>>> | null = null

async function loadQuickJS() {
  quickjsPromise ??= import('quickjs-emscripten').then((m) => m.getQuickJS())
  return quickjsPromise
}

export async function runCode(source: string, scope: FlowScope): Promise<unknown> {
  const QuickJS = await loadQuickJS()
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(MEMORY_LIMIT)
  const deadline = Date.now() + CPU_BUDGET_MS
  runtime.setInterruptHandler(() => Date.now() > deadline)
  const vm = runtime.newContext()

  try {
    const input = {
      trigger: scope.trigger,
      steps: scope.steps,
      ...(scope.item !== undefined ? { item: scope.item, itemIndex: scope.itemIndex } : {}),
    }
    // Inject input as a frozen global, then run the user source with
    // `return` semantics. JSON round-trip = nothing but data crosses in.
    const setup = vm.evalCode(`globalThis.input = Object.freeze(${JSON.stringify(input)});`)
    if (setup.error) { setup.error.dispose(); throw new Error('code step: could not inject input') }
    setup.value.dispose()

    const result = vm.evalCode(`(function () {\n${source}\n})()`)
    if (result.error) {
      const err = vm.dump(result.error) as { name?: string; message?: string; stack?: string }
      result.error.dispose()
      const line = /eval\.js:(\d+)/.exec(err.stack ?? '')?.[1]
      throw new Error(`code step ${err.name ?? 'Error'}: ${err.message ?? 'failed'}${line ? ` (line ${Number(line) - 1})` : ''}`)
    }
    // A promise can never settle here: the isolate has no host bindings, so
    // nothing can resolve one, and `vm.dump` CONSUMES a promise handle - the
    // dispose below then threw `Lifetime not alive`, a QuickJS internal that
    // told an author nothing. Refuse it by name instead.
    if (vm.typeof(result.value) === 'object') {
      const ctor = vm.getProp(result.value, 'constructor')
      let name = ''
      if (vm.typeof(ctor) === 'function') {
        const nameHandle = vm.getProp(ctor, 'name')
        name = vm.getString(nameHandle)
        nameHandle.dispose()
      }
      ctor.dispose()
      if (name === 'Promise') {
        result.value.dispose()
        throw new Error('code step cannot return a promise: the sandbox is synchronous and has nothing to await')
      }
    }
    const output = vm.dump(result.value)
    result.value.dispose()

    const size = JSON.stringify(output ?? null)?.length ?? 0
    if (size > OUTPUT_LIMIT) throw new Error(`code step output too large (${size} bytes > ${OUTPUT_LIMIT})`)
    // A step's output must be an object so downstream {{steps.<id>.output.<field>}}
    // refs work. undefined/null → {}; a primitive or array is wrapped as { value }.
    if (output === undefined || output === null) return {}
    if (typeof output !== 'object' || Array.isArray(output)) return { value: output }
    return output
  } finally {
    vm.dispose()
    runtime.dispose()
  }
}
